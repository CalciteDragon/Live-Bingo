# Engine Implementation Plan

## Context

The `packages/engine` package contains three stub functions — `validateEvent`, `applyEvent`, `checkWin` — and placeholder import tests. This is the highest-ROI implementation task in the project because all server-side match logic depends on it and it is independently testable without the API or UI.

The engine must remain IO-free, side-effect-free, and must never mutate input state or generate random numbers.

---

## Key Design Decision: EngineContext

`applyEvent` for certain events (`START_MATCH`, `RESHUFFLE_BOARD`) requires values the engine cannot generate itself — the current timestamp and the new board. These are injected by the API caller via a context parameter:

```typescript
export interface EngineContext {
  nowIso?: string;     // ISO 8601 timestamp — required for START_MATCH, RESHUFFLE_BOARD
  newCard?: BingoCard; // Pre-generated board — required for START_MATCH, RESHUFFLE_BOARD
}

export function applyEvent(state: MatchState, event: ClientMessage, ctx: EngineContext = {}): MatchState
```

The API is responsible for generating the seed (using `crypto.randomUUID()` or `Math.random()`), calling `generateBoard(seed)` to get the card, and stamping the current time — all before calling `applyEvent`. This keeps the engine pure while keeping the API thin.

---

## Timer Expiry

Timer expiry is **not** handled in the engine. It is triggered server-side (a scheduled check when countdown elapses). The API evaluates the winner by counting marked cells directly and writes the Completed state. `checkWin` does not evaluate timer expiry — only line and majority conditions.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/engine/src/goals.ts` | Create — hardcoded list of 50+ Minecraft bingo goals |
| `packages/engine/src/board.ts` | Create — `generateBoard(seed)`, seeded PRNG (mulberry32), Fisher-Yates shuffle |
| `packages/engine/src/engine.ts` | Modify — implement all three functions + `EngineError` class + `EngineContext` type |
| `packages/engine/src/index.ts` | Modify — export `generateBoard` and `EngineError` |
| `packages/engine/src/__tests__/engine.test.ts` | Modify — replace stubs with exhaustive tests |
| `packages/engine/src/__tests__/board.test.ts` | Create — tests for board generation |

---

## EngineError

```typescript
import type { WsErrorCode } from '@bingo/shared';

export class EngineError extends Error {
  constructor(public readonly code: WsErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
  }
}
```

`validateEvent` throws `EngineError`. The API catches it and sends a typed `ERROR` WebSocket message using `error.code`.

---

## generateBoard

**File:** `packages/engine/src/board.ts`

- `mulberry32(seed: number): () => number` — seeded PRNG, returns a function that yields values in `[0, 1)`
- Fisher-Yates shuffle of the goals array using the PRNG
- Take the first 25 goals; map each to a `Cell` with `index`, `goal`, `markedBy: null`
- Return `BingoCard { seed, cells }`

The goals list in `goals.ts` must have at least 25 entries. 50+ is recommended to give variety across different seeds.

---

## validateEvent Rules

Called before `applyEvent`. Throws `EngineError` on any violation.

**Caller resolution (used by all events):**
```
callerPlayer = state.players.find(p => p.clientId === event.clientId)
if (!callerPlayer) → throw EngineError('INVALID_EVENT', 'Unknown client')
```

**Per-event validation:**

| Event | Required status | Caller | Additional checks |
|---|---|---|---|
| `SYNC_STATE` | Any | Any | None — always valid |
| `SET_READY` | `Lobby` | Any | — |
| `START_MATCH` | `Lobby` | Host (slot 1) | `state.players.length === 2`; all players ready |
| `MARK_CELL` | `InProgress` | Any | `cells[cellIndex].markedBy === null` |
| `UNMARK_CELL` | `InProgress` | Any | `cells[cellIndex].markedBy === callerPlayer.playerId` |
| `RESHUFFLE_BOARD` | `InProgress` | Host (slot 1) | No cells currently marked |
| `BACK_TO_LOBBY` | `InProgress` or `Completed` | Host (slot 1) | — |
| `REMATCH` | `Completed` | Host (slot 1) | Both players connected |

**Error codes:**
- Wrong status → `INVALID_STATE`
- Non-host sending host-only event → `NOT_AUTHORIZED`
- Mark/unmark ownership violation → `INVALID_STATE`
- Player not found → `INVALID_EVENT`

---

## applyEvent State Transitions

All transitions return a new `MatchState` object. Input state is never mutated (use spread operators and array map/filter).

| Event | State changes |
|---|---|
| `SYNC_STATE` | Return state unchanged |
| `SET_READY` | `readyStates[callerPlayer.playerId] = payload.ready` |
| `START_MATCH` | `status → InProgress`; `timer.startedAt = ctx.nowIso`; `card = ctx.newCard` |
| `MARK_CELL` | `cells[cellIndex].markedBy = callerPlayer.playerId` |
| `UNMARK_CELL` | `cells[cellIndex].markedBy = null` |
| `RESHUFFLE_BOARD` | `card = ctx.newCard`; all `markedBy → null`; `timer.startedAt = ctx.nowIso` |
| `BACK_TO_LOBBY` | `status → Lobby`; all `markedBy → null`; `timer.startedAt = null`; `readyStates → {}`; `result → null` |
| `REMATCH` | `status → InProgress`; all `markedBy → null`; `timer.startedAt = ctx.nowIso`; `result → null` |

---

## checkWin

Checks line completion and majority. Returns `MatchResult | null`. Does not check timer expiry.

**Lines to check (15 total):**
- 5 rows: indices `[0-4]`, `[5-9]`, `[10-14]`, `[15-19]`, `[20-24]`
- 5 columns: indices `[0,5,10,15,20]`, `[1,6,11,16,21]`, etc.
- 2 diagonals: `[0,6,12,18,24]`, `[4,8,12,16,20]`

**Line win:** All 5 cells in a line share the same non-null `markedBy` value.

**Majority win:** A player owns ≥ 13 cells.

**Priority:** If both conditions trigger simultaneously, return `{ winnerId, reason: 'line' }`.

**No win:** Return `null`.

Only check cells with `status === 'InProgress'` — but since the caller should only invoke `checkWin` on in-progress states, this is a courtesy guard.

---

## Test Plan

### `board.test.ts`

- `generateBoard(seed)` returns exactly 25 cells
- All cell indices are unique (0–24)
- No duplicate goals within one board
- Same seed always returns the same board (determinism)
- Different seeds return different boards

### `engine.test.ts`

Helpers: factory functions for `MatchState`, `Player`, `Cell`, `ClientMessage` to reduce boilerplate.

**validateEvent:**
- `SYNC_STATE` passes in any status
- `SET_READY` passes in Lobby; throws `INVALID_STATE` in InProgress
- `START_MATCH` passes when host, 2 players, all ready; throws `NOT_AUTHORIZED` for guest; throws `INVALID_STATE` if a player is not ready or only 1 player
- `MARK_CELL` passes on unmarked cell in InProgress; throws `INVALID_STATE` on already-marked cell; throws `INVALID_STATE` in Lobby
- `UNMARK_CELL` passes when caller owns the mark; throws `INVALID_STATE` when another player owns it
- `RESHUFFLE_BOARD` passes with no marks; throws `INVALID_STATE` if any cell is marked; throws `NOT_AUTHORIZED` for guest
- `BACK_TO_LOBBY` passes from InProgress and Completed; throws `INVALID_STATE` from Lobby
- `REMATCH` passes from Completed with both connected; throws `INVALID_STATE` from InProgress
- Unknown clientId → throws `INVALID_EVENT`

**applyEvent:**
- `SET_READY` — ready state updates correctly; other ready states unchanged
- `START_MATCH` — status becomes InProgress; timer.startedAt matches ctx.nowIso; card matches ctx.newCard
- `MARK_CELL` — correct cell's markedBy set to caller's playerId; other cells unchanged
- `UNMARK_CELL` — cell's markedBy becomes null
- `RESHUFFLE_BOARD` — all cells reset; card and seed updated; timer reset
- `BACK_TO_LOBBY` — status Lobby; all marks cleared; readyStates empty; result null
- `REMATCH` — status InProgress; marks cleared; result null; card unchanged (same seed)
- Input state not mutated (deep-equal check on original after calling applyEvent)

**checkWin:**
- Row win (each of 5 rows)
- Column win (each of 5 columns)
- Both diagonal wins
- Line with mixed ownership → null
- 13 cells for one player → majority win
- 12 cells → null
- Line win takes priority over simultaneous majority win → `reason: 'line'`
- Empty board → null
- Marks split evenly → null
