# WebSocket Handler Refactor: ws/index.ts

## Context

`apps/api/src/ws/index.ts` (433 lines) has two structural problems:

1. **`processMessage` is a 195-line god function** — it parses messages, validates schemas, deduplicates events, runs engine logic, executes DB transactions, updates the registry, orchestrates broadcasts, and manages timers, all in one monolithic async function.

2. **Timer logic is scattered** — `scheduleCountdownTimer` and `expireCountdown` sit at the top of the file, inline timer scheduling appears at the bottom of `processMessage` (lines 340–362), and `abandonMatch`'s timer cancel lives at the bottom. Four concepts, four locations.

The goal is a clean 3-file split where each file has a single reason to change, `processMessage` reads as an explicit named-stage pipeline, and all timer ownership is consolidated.

---

## Proposed File Structure

```
apps/api/src/ws/
  index.ts             ← Public facade (handleUpgrade, re-export scheduleCountdownTimer)
  message-pipeline.ts  ← processMessage as a named-stage orchestration pipeline
  match-timers.ts      ← All setTimeout/clearTimeout logic: countdown + abandon
```

---

## File 1: `match-timers.ts`

**Responsibility**: Own every timer in the WebSocket layer. No other file touches `setTimeout`/`clearTimeout`.

Consolidates code currently scattered across `ws/index.ts` lines 26–37, 43–81, 340–362, 415–432, and `handleDisconnect` lines 405–412.

**Exports:**
```typescript
export function scheduleCountdownTimer(matchId: string, remainingMs: number): void
export function cancelCountdownTimer(matchId: string): void
export function scheduleAbandonTimer(matchId: string): void
export function cancelAbandonTimer(matchId: string): void
```

**Private functions** (moved verbatim from current `ws/index.ts`):
- `expireCountdown(matchId)` — timer expiry logic, DB update, STATE_UPDATE + MATCH_COMPLETED broadcast
- `abandonMatch(matchId)` — DB persist Abandoned state, evict from registry

`cancelCountdownTimer` and `cancelAbandonTimer` are new named wrappers around the existing inline `clearTimeout` calls in `processMessage` and `handleUpgrade` respectively.

---

## File 2: `message-pipeline.ts`

**Responsibility**: Accept a raw WebSocket message, run it through the validation + application + persistence + broadcast pipeline. No connection lifecycle, no timer ownership (delegates to `match-timers.ts`).

**Export:** `processMessage` only.

**Structure — the orchestrator becomes a table of contents:**
```typescript
export async function processMessage(ws, matchId, clientId, raw): Promise<void> {
  // Stage 1 — Parse JSON and validate schema
  const parsed = parseAndValidateSchema(raw);
  if (!parsed.ok) { sendTo(ws, errorFor(matchId, parsed.error)); return; }

  // Stage 2 — Verify envelope identity (matchId/clientId match this connection)
  if (!verifyEnvelopeIdentity(parsed.message, matchId, clientId)) {
    sendTo(ws, notAuthorizedError(matchId)); return;
  }

  // Stage 3 — Registry lookup (drop silently if match was evicted)
  const entry = getMatch(matchId);
  if (!entry) return;

  // Stage 4 — SYNC_STATE short-circuit (read-only, no side effects)
  if (parsed.message.type === 'SYNC_STATE') {
    sendTo(ws, { type: 'STATE_SYNC', matchId, payload: { state: entry.state } }); return;
  }

  const { message } = parsed;

  // Stage 5 — Deduplication (at-most-once per eventId per match)
  if (await isDuplicateEvent(matchId, message.eventId)) {
    sendTo(ws, duplicateEventError(matchId, message.eventId)); return;
  }

  // Stage 6 — Engine validation
  const engineCheck = validateEngineRules(entry.state, message);
  if (!engineCheck.ok) { sendTo(ws, errorFor(matchId, engineCheck.error)); return; }

  // Stage 7 — Apply event and check for win
  const ctx = buildEngineContext(message);
  const { newState, winResult } = applyAndCheckWin(entry.state, message, ctx);

  // Stage 8 — Persist (transactional: INSERT match_events + UPDATE matches)
  const caller = entry.state.players.find(p => p.clientId === clientId)!;
  await persistEventTransaction(matchId, caller, message, newState, winResult);

  // Stage 9 — Commit to in-memory registry
  commitToRegistry(matchId, newState);

  // Stage 10 — Broadcast full state snapshot
  broadcastToMatch(matchId, { type: 'STATE_UPDATE', matchId, payload: { state: newState, lastAppliedEventId: message.eventId } });

  // Stage 11 — Broadcast lifecycle events (MATCH_STARTED / MATCH_COMPLETED)
  broadcastLifecycleEvents(matchId, message, winResult);

  // Stage 12 — Reconcile countdown timers
  reconcileCountdownTimer(matchId, message, newState, winResult);
}
```

**Private stage functions:**
- `parseAndValidateSchema(raw)` → `{ ok: true; message } | { ok: false; error }`
- `verifyEnvelopeIdentity(message, matchId, clientId)` → `boolean`
- `isDuplicateEvent(matchId, eventId)` → `Promise<boolean>`
- `validateEngineRules(state, message)` → `{ ok: true } | { ok: false; error }`
- `buildEngineContext(message)` → `EngineContext` — the only place `generateBoard` + `Math.random()` are called
- `applyAndCheckWin(state, message, ctx)` → `{ newState, winResult: MatchResult | null }`
- `persistEventTransaction(matchId, caller, message, newState, winResult)` → `Promise<void>` — single DB connection, BEGIN/COMMIT/ROLLBACK
- `commitToRegistry(matchId, newState)` → `void`
- `broadcastLifecycleEvents(matchId, message, winResult)` → `void`
- `reconcileCountdownTimer(matchId, message, newState, winResult)` → `void` — calls `cancelCountdownTimer` / `scheduleCountdownTimer` from `match-timers.ts`; does not touch `setTimeout` directly

---

## File 3: `index.ts` (facade)

**Responsibility**: Public API surface. Own connection lifecycle (upgrade → connected → disconnected). Re-export `scheduleCountdownTimer` for startup hydration in `apps/api/src/index.ts`.

**Exports (unchanged contract):**
```typescript
export { scheduleCountdownTimer } from './match-timers.js';
export function handleUpgrade(wss, req, socket, head): void
```

**Private helpers** (extracted from the current monolithic `handleUpgrade`):
- `validateUpgradeRequest(req, socket)` → `{ matchId, clientId } | null` — UUID validation, registry auth, HTTP 400/403 on failure
- `onClientConnected(ws, matchId, clientId)` → `Promise<void>` — register socket, cancel abandon timer, mark player connected, persist, broadcast PRESENCE_UPDATE + STATE_SYNC, attach message/close handlers
- `handleDisconnect(ws, matchId, clientId)` → `Promise<void>` — mark disconnected, reset ready state in Lobby, persist, broadcast PRESENCE_UPDATE, call `scheduleAbandonTimer` if all disconnected

`sendTo` lives here as a module-level helper (also used in `message-pipeline.ts` — small enough that either a shared util or minor duplication is fine; preferred: keep it local to each file, it's a one-liner).

---

## Dependency Graph

```
apps/api/src/index.ts
  └── ws/index.ts  ──exports──►  handleUpgrade, scheduleCountdownTimer
        ├── ws/message-pipeline.ts  (processMessage)
        │     └── ws/match-timers.ts  (cancelCountdownTimer, scheduleCountdownTimer)
        └── ws/match-timers.ts  (scheduleAbandonTimer, cancelAbandonTimer, scheduleCountdownTimer)
```

No circular dependencies. `match-timers.ts` has no upstream dependencies within `ws/`.

---

## Critical Files

| File | Role |
|---|---|
| `apps/api/src/ws/index.ts` | Source of all code being split; becomes the facade |
| `apps/api/src/ws/message-pipeline.ts` | New file |
| `apps/api/src/ws/match-timers.ts` | New file |
| `apps/api/src/__tests__/ws.test.ts` | Test surface; import paths must stay valid |
| `apps/api/src/index.ts` | Imports `handleUpgrade` + `scheduleCountdownTimer` from `ws/index.js` — contract is immovable |
| `apps/api/src/match-registry.ts` | `MatchEntry` owns `countdownTimer`/`abandonTimer` fields; all three new files depend on it |

---

## Implementation Order

Execute in this sequence to keep tests green at each step:

1. **Create `match-timers.ts`** — move `expireCountdown`, `scheduleCountdownTimer`, `abandonMatch`. Add `cancelCountdownTimer`, `cancelAbandonTimer`, `scheduleAbandonTimer`. Update `ws/index.ts` to import from it. Run tests.

2. **Create `message-pipeline.ts`** — extract `processMessage` and its private stage functions. Update `ws/index.ts` to import `processMessage`. Run tests.

3. **Refactor `ws/index.ts`** — split `handleUpgrade` body into `validateUpgradeRequest` / `onClientConnected` / `handleDisconnect`. Add `scheduleCountdownTimer` re-export. Clean up all moved code. Run tests.

---

## Verification

```bash
# Run the full WS test suite (960 lines, covers all handlers)
npm test --workspace=apps/api

# Confirm no TypeScript errors across the monorepo
npm run build --workspace=apps/api
```

The test file imports only `{ handleUpgrade, scheduleCountdownTimer }` from `ws/index.js` — both remain exported from that path after the refactor. No test file changes required.
