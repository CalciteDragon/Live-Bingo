# packages/engine — Pure Match Engine

Package: `@bingo/engine` — exports from `src/index.ts`.

Source files: `src/engine.ts`, `src/board.ts`, `src/goals.ts`

## Exports

```typescript
export { validateEvent, applyEvent, checkWin, resolveTimerWinner, EngineError } from './engine.js'
export type { EngineContext } from './engine.js'
export { generateBoard } from './board.js'
```

## EngineError

Custom error class with a `code: WsErrorCode` property. Thrown by `validateEvent` when an event is illegal.

## EngineContext

```typescript
interface EngineContext {
  nowIso?: string       // ISO 8601 timestamp for START_MATCH, RESHUFFLE_BOARD, REMATCH
  newCard?: BingoCard   // pre-generated board for START_MATCH, RESHUFFLE_BOARD
}
```

The caller (API server) provides context so the engine remains pure (no `Date.now()`, no `Math.random()`).

## validateEvent(state, event) → void

Validates that a `ClientMessage` is legal in the current `MatchState`. Throws `EngineError` on violation.

Key rules:
- Looks up caller by `event.clientId` in `state.players`
- Host-only actions: START_MATCH, SET_LOBBY_SETTINGS, RESHUFFLE_BOARD, BACK_TO_LOBBY, REMATCH
- START_MATCH: requires Lobby status, 2-4 players, all ready
- MARK_CELL: requires InProgress, cell must not already be marked
- UNMARK_CELL: requires InProgress, cell must be owned by caller
- RESHUFFLE_BOARD: requires InProgress, no cells marked
- REMATCH: requires Completed, all players connected
- BACK_TO_LOBBY: requires InProgress or Completed

## applyEvent(state, event, ctx?) → MatchState

Pure function that returns a new MatchState. Never mutates input. Caller must call `validateEvent` first.

Key behaviors:
- SYNC_STATE: returns state unchanged
- SET_READY: updates `readyStates[caller.playerId]`
- SET_LOBBY_SETTINGS: updates `lobbySettings` and `timer` mode/duration
- START_MATCH: status→InProgress, applies `ctx.newCard`, sets `timer.startedAt`
- MARK_CELL: sets `cell.markedBy = caller.playerId`
- UNMARK_CELL: sets `cell.markedBy = null`
- RESHUFFLE_BOARD: applies `ctx.newCard`, resets `timer.startedAt`
- BACK_TO_LOBBY: status→Lobby, clears marks, resets timer, clears readyStates+result
- REMATCH: status→InProgress, applies `ctx.newCard`, resets timer, clears result

## checkWin(state) → MatchResult | null

Checks for line or majority win. Returns null if no win detected. Only runs when `status === 'InProgress'`.

**Line detection**: checks all 12 lines (5 rows + 5 cols + 2 diagonals). Uses `resolveOwnerGroup()` for FFA/team abstraction.

**Majority detection**: calculates per-player cell counts. If `blanks < leader_score - second_score`, the leader wins (mathematically uncatchable). This is NOT a simple ≥13 threshold — it's a dynamic check.

Priority: line > majority (checked in that order; first match returned).

## resolveTimerWinner(state) → MatchResult

Called by the server when countdown expires. Counts cells per player, highest count wins. Tie = draw (`winnerId: null`).

## Board Generation (src/board.ts)

`generateBoard(seed: number) → BingoCard`

- Uses **mulberry32** PRNG (seedable, deterministic)
- **Fisher-Yates shuffle** of the GOALS array
- Takes first 25 goals, creates cells with `markedBy: null`
- Same seed always produces the same board

## Goals List (src/goals.ts)

`GOALS: readonly string[]` — 89 hardcoded Minecraft bingo goals across categories:
- Crafting & tools (13)
- Mining & resources (10)
- Exploration & structures (11)
- Mobs & combat (15)
- Food & farming (13)
- Achievements & feats (12)
- Completely random (15)

## Tests

- `src/__tests__/engine.test.ts` — tests for validateEvent, applyEvent, checkWin
- `src/__tests__/board.test.ts` — tests for generateBoard determinism
- Test runner: vitest (`vitest.config.ts`)
