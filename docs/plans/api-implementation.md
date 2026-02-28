# API Implementation Plan

## Context

The engine and all shared types are complete. The API has a working Express + WebSocket server, a DB connection pool, the full Postgres schema (`matches`, `match_players`, `match_events`), and three stub REST routes. The next step is wiring everything together: REST endpoints that manage match lifecycle, WebSocket routing that runs client intents through the engine, transactional event deduplication and persistence, and presence/disconnect handling.

---

## Open Questions

These are not fully resolved by the existing design documents. Answers should be decided before or during implementation:

1. **WebSocket connection identity**: Every `ClientMessage` already carries `matchId` and `clientId`. Should the client connect to a match-specific URL (e.g., `ws://api/ws?matchId=xxx&clientId=xxx`) and be validated at upgrade time, or should the connection be anonymous and registered into the match on the first valid message? URL-based is cleaner (rejects non-players at the door, no deferred state); first-message is simpler.
- Use the URL approach, websocket should be established and validated before any match logic

2. **Countdown timer expiry**: Win-by-time requires a server-side `setTimeout` per match in countdown mode. Is this in scope for this phase, or deferred?
- in scope, but implement after core event processing and presence handling are working

3. **Alias**: `Player.alias` is nullable. Is a display name collected at create/join time (requires adding it to request bodies), or left `null` for the entire MVP?
- display name should be required and collected on home page before creating/joining a match (with a default random name pre-filled for convenience)

4. **Join code requirement**: `JoinMatchBodySchema` has `joinCode?: string` (optional). If a client sends `POST /matches/:id/join` with no `joinCode`, should the server accept (trusting the direct matchId link) or reject with `JOIN_CODE_INVALID`?
- accept if match has a valid, unexpired join code (i.e., allow both join code and direct link as long as join code is still valid); reject if match has no join code or expired join code (i.e., direct link doesn't work once join code expires)

5. **Rematch board**: The engine's `REMATCH` handler clears marks but keeps the same card/seed by design. Is this the intended UX, or should a rematch generate a fresh board (requiring `ctx.newCard` and a new seed)?
- this was intended behavior, but after thinking about it, generating a new board on rematch is more fun and encourages replayability; implement this by generating a new seed and board in the API layer, and passing the new card in `EngineContext` for the `REMATCH` event. also add to todos: show the board seed in the UI somewhere and allow players to set a custom seed in the lobby

6. **Server restart recovery**: Should startup hydrate the in-memory registry from Postgres (`SELECT` all `Lobby`/`InProgress` matches and reconstruct `MatchState` from `state_json`)? Required for production correctness, adds modest startup complexity.
- yes, implement startup hydration of the in-memory registry from the DB

---

## Architecture: In-Memory Match Registry

The core data structure bridging REST, WebSocket, and the engine:

```typescript
// src/match-registry.ts
interface MatchEntry {
  state: MatchState;
  sockets: Map<string, WebSocket>; // clientId → WebSocket
  abandonTimer?: NodeJS.Timeout;   // set when both players disconnect
  countdownTimer?: NodeJS.Timeout; // set when match starts in countdown mode
}

const registry = new Map<string, MatchEntry>();
```

All event processing reads and writes `entry.state`. DB persistence is a side effect after the engine mutates state. WebSocket broadcasts iterate `entry.sockets`.

---

## Phase 1: Foundational Layer

**Goal**: Infrastructure that REST and WS handlers will both depend on.

### Files

**`src/match-registry.ts`** — Create
- `getMatch(matchId)` → `MatchEntry | undefined`
- `setMatch(matchId, entry)` — upsert
- `deleteMatch(matchId)` — evict from registry
- `registerSocket(matchId, clientId, ws)` — add WS connection to match
- `removeSocket(matchId, clientId)` — remove on disconnect

**`src/middleware/client-id.ts`** — Create
- Express middleware that parses `x-client-id` header using `ClientIdHeaderSchema` (from `@bingo/shared`)
- On failure: respond `400` with `RestErrorResponse { code: 'INVALID_EVENT', message: '...' }`
- On success: attach parsed value to `res.locals.clientId`

**`src/index.ts`** — Modify (startup hydration)
- On startup: `SELECT match_id, state_json FROM matches WHERE status IN ('Lobby', 'InProgress')`
- Reconstruct each `MatchState` from `state_json` (already typed JSONB, just parse and cast)
- Call `setMatch` for each — sockets start empty (clients must reconnect)

### Seed and Join Code Generation

- **Seed**: `Math.floor(Math.random() * 2 ** 32)` — fits BIGINT, works with `generateBoard(seed)`
- **Join code**: 6-character uppercase alphanumeric — `crypto.randomBytes(3).toString('hex').toUpperCase()`
- **Join code TTL**: 30 minutes — already in schema as `join_code_expires_at`

---

## Phase 2: REST Endpoints

**Goal**: Fully functional match creation, join, and hydration. No WebSocket yet.

### Middleware

Apply `clientIdMiddleware` to the `matchRouter` (all three routes need `X-Client-Id`).

### `POST /matches` — Create Match

Request body validated with `CreateMatchBodySchema` (to be added to `@bingo/shared`):
- `alias: string` — host display name (required)
- `timerMode: TimerMode` — `'stopwatch'` or `'countdown'` (required)
- `countdownDurationMs: number` — required when `timerMode === 'countdown'`, omitted otherwise

**Timer mode semantics:**
- `stopwatch` — counts up from match start; purely informational, never ends the match on its own
- `countdown` — counts down from `countdownDurationMs`; when it reaches zero the server ends the match and evaluates win-by-time (more marked cells wins; tie = draw)

1. Validate request body with `CreateMatchBodySchema`
2. Generate `matchId` (`crypto.randomUUID()`), `playerId` (`crypto.randomUUID()`), seed, `joinCode`, expiry
3. Call `generateBoard(seed)` to get initial `BingoCard`
4. Build initial `MatchState`:
   - `status: 'Lobby'`
   - `players: [{ playerId, clientId, slot: 1, alias, connected: false }]`
   - `readyStates: {}`
   - `card`: generated board
   - `lobbySettings`: `{ timerMode, countdownDurationMs: countdownDurationMs ?? null }`
   - `timer`: `{ mode: timerMode, startedAt: null, countdownDurationMs: countdownDurationMs ?? null }`
   - `result: null`
5. **DB** (single transaction):
   - `INSERT INTO matches (match_id, status, seed, join_code, join_code_expires_at, timer_mode, countdown_duration_ms, state_json, created_at)`
   - `INSERT INTO match_players (player_id, match_id, client_id, slot, alias, connected, last_seen_at)`
6. `setMatch(matchId, { state, sockets: new Map() })`
7. Return `CreateMatchResponse { matchId, joinCode, joinUrl: \`${CLIENT_ORIGIN}/join/${joinCode}\`, state }`

> **Gap — lobby settings after creation**: There is currently no `SET_LOBBY_SETTINGS` WebSocket event. Timer mode and duration are fixed at creation time and cannot be changed in the lobby. For MVP this is acceptable; if mid-lobby settings changes are needed, a new event and schema entry must be added to `@bingo/shared`.

### `POST /matches/:id/join` — Join Match

1. Parse + validate body with `JoinMatchBodySchema`
2. Load match — from registry if present, else from DB; `404` if not found
3. Validate:
   - `status === 'Lobby'` → else `MATCH_NOT_JOINABLE`
   - `players.length < 2` → else `MATCH_FULL`
   - `clientId` not already in `players` → else `CLIENT_CONFLICT`
   - If `joinCode` provided: match stored `join_code` and `join_code_expires_at` → else `JOIN_CODE_INVALID` / `JOIN_CODE_EXPIRED`
4. Generate `playerId`, build `Player { slot: 2, alias, connected: false, ... }` (alias from request body — update `JoinMatchBodySchema` in `@bingo/shared` to add `alias: string`)
5. Update `MatchState` (pure spread — add player to `state.players`)
6. **DB** (transaction): `INSERT INTO match_players`, `UPDATE matches SET state_json`
7. `setMatch` with updated state
8. Return `JoinMatchResponse { matchId, playerId, state }`
9. Broadcast `PRESENCE_UPDATE` to any existing sockets in match

### `GET /matches/:id` — Hydrate

1. Load match from registry or DB; `404` if not found
2. Find player by `clientId` in `state.players`; `403` if not a participant
3. Return `GetMatchResponse { matchId, playerId: player.playerId, state }`

### Tests (`src/__tests__/routes.test.ts`)

Replace stub tests with functional tests using `supertest`. DB interactions should be mocked (no real Postgres in unit tests — save integration for later). Test:
- `POST /matches` returns 201 with `matchId`, `joinCode`, `state`
- `POST /matches/:id/join` returns 200, adds player to state
- `GET /matches/:id` returns 200 with correct `playerId`
- Error cases: missing header → 400, match full → 409, etc.

---

## Phase 3: WebSocket Intent Routing + Persistence

**Goal**: Clients can send intents; server validates, applies, persists, and broadcasts.

### Connection Identification

Upgrade URL: `ws://api/ws?matchId=xxx&clientId=xxx`

In `handleUpgrade` (`src/ws/index.ts`):
- Parse `matchId` and `clientId` from `req.url`
- Validate both are UUIDs; reject socket with `400` if not
- Look up match in registry; reject if not found or clientId not a player
- Call `registerSocket(matchId, clientId, ws)`
- Mark `player.connected = true`, persist, broadcast `PRESENCE_UPDATE`

### Event Processing Flow

For each validated `ClientMessage`:

```
1. Look up MatchEntry from registry (drop message if match gone)
2. SYNC_STATE → send STATE_SYNC to caller socket only; return
3. Check eventId uniqueness:
   SELECT 1 FROM match_events WHERE match_id = $1 AND event_id = $2
   If found → send ERROR { code: 'DUPLICATE_EVENT' }; return
4. validateEvent(state, event) — catch EngineError → send ERROR { code, message, rejectedEventId }; return
5. Build EngineContext { nowIso: new Date().toISOString(), newCard? }
   (newCard required for START_MATCH, RESHUFFLE_BOARD, REMATCH — call generateBoard with a fresh crypto seed)
6. newState = applyEvent(state, event, ctx)
7. result = checkWin(newState)
8. If result: set newState.status = 'Completed', newState.result = result
9. BEGIN TRANSACTION:
   INSERT INTO match_events (match_id, seq, event_id, type, payload_json, player_id, client_id, created_at)
     seq = (SELECT COALESCE(MAX(seq), 0) + 1 FROM match_events WHERE match_id = $1)
   UPDATE matches SET state_json = $1, status = $2, ... WHERE match_id = $3
   COMMIT
10. entry.state = newState
11. Broadcast STATE_UPDATE { state: newState, lastAppliedEventId: event.eventId } to all sockets
12. If event.type === 'START_MATCH': broadcast MATCH_STARTED {}
13. If result: broadcast MATCH_COMPLETED { reason, winnerId }
14. Cancel/start countdown timer as appropriate (Phase 5)
```

### Helper: `sendTo(ws, message: ServerMessage)`

Serialize and send. Drop silently if socket is closed.

### Helper: `broadcastToMatch(matchId, message: ServerMessage)`

Iterate `entry.sockets.values()`, call `sendTo` for each.

---

## Phase 4: Presence + Disconnect + Abandon

**Goal**: Player connection state is tracked; matches are cleaned up when abandoned.

### On WebSocket `close`

1. `removeSocket(matchId, clientId)`
2. Set `player.connected = false` in state (pure spread update)
3. Persist updated state to DB
4. Broadcast `PRESENCE_UPDATE { players: state.players }`
5. If all players disconnected:
   - Set `entry.abandonTimer = setTimeout(() => abandonMatch(matchId), 10 * 60 * 1000)`

### On WebSocket reconnect (new connection for same clientId)

1. `registerSocket(matchId, clientId, ws)` (overwrites old dead socket)
2. Set `player.connected = true`
3. Persist + broadcast `PRESENCE_UPDATE`
4. Clear `entry.abandonTimer` if set
5. Send `STATE_SYNC` to reconnecting socket

### `abandonMatch(matchId)`

1. Load entry from registry
2. Set `state.status = 'Abandoned'`
3. `UPDATE matches SET status = 'Abandoned', abandoned_at = NOW(), state_json = $1`
4. `deleteMatch(matchId)` — evict from registry

---

## Phase 5: Countdown Timer Expiry *(deferred if not in scope)*

**Goal**: Countdown matches auto-complete when time elapses.

### On START_MATCH (countdown mode)

```typescript
entry.countdownTimer = setTimeout(() => expireCountdown(matchId), state.timer.countdownDurationMs)
```

### `expireCountdown(matchId)`

1. Load state, verify still `InProgress`
2. Count cells per player
3. Determine winner (more cells wins; tie → `draw`)
4. Build `MatchResult { winnerId, reason: 'timer_expiry' }`
5. Update state: `status = 'Completed'`, `result = result`
6. Persist (UPDATE matches, INSERT match_events with synthetic `TIMER_EXPIRY` event or just update state)
7. Broadcast `STATE_UPDATE` + `MATCH_COMPLETED`

### Timer management

- Cancel `countdownTimer` on `BACK_TO_LOBBY`, `REMATCH`, and `abandonMatch`
- Reschedule on `REMATCH` (if countdown mode)

---

## Files to Create / Modify

| File | Action | Phase |
|---|---|---|
| `src/match-registry.ts` | Create | 1 |
| `src/middleware/client-id.ts` | Create | 1 |
| `src/index.ts` | Modify — startup hydration, WS URL routing | 1, 3 |
| `src/routes/index.ts` | Modify — implement all three REST handlers | 2 |
| `src/ws/index.ts` | Modify — full intent routing, error, broadcast | 3 |
| `src/__tests__/routes.test.ts` | Modify — functional tests with mocked DB | 2 |

---

## Verification

```bash
# Unit tests (no DB required)
npm run test --workspace=apps/api

# Local end-to-end (requires Docker Postgres)
docker-compose up -d
npm run migrate --workspace=apps/api
npm run dev:api

# Test REST with curl
curl -X POST http://localhost:3000/matches -H "X-Client-Id: $(uuidgen)" | jq

# Test WebSocket with wscat (npm i -g wscat)
wscat -c "ws://localhost:3000/ws?matchId=xxx&clientId=xxx"
```

CI: add Postgres service container to the `test-api` job in `.github/workflows/ci.yml` once integration tests are added.
