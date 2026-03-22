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
- Host-only actions: START_MATCH, SET_LOBBY_SETTINGS, RESHUFFLE_BOARD, BACK_TO_LOBBY, REMATCH, KICK_PLAYER
- START_MATCH: requires Lobby status, 2-4 players, all ready
- MARK_CELL: requires InProgress, cell must not already be marked
- UNMARK_CELL: requires InProgress, cell must be owned by caller
- RESHUFFLE_BOARD: requires InProgress, no cells marked
- REMATCH: requires Completed, all players connected
- BACK_TO_LOBBY: requires InProgress or Completed
- KICK_PLAYER: requires Lobby status, target must exist and must not be the host (slot 1)

## applyEvent(state, event, ctx?) → MatchState

Pure function that returns a new MatchState. Never mutates input. Caller must call `validateEvent` first.

Key behaviors:
- SYNC_STATE: returns state unchanged
- SET_READY: updates `readyStates[caller.playerId]`
- SET_LOBBY_SETTINGS: partial-merge into `lobbySettings` — only fields present in payload are applied. Timer mode/duration only updated if `timerMode` is explicitly in payload. `countdownDurationMs` uses `'countdownDurationMs' in payload` check to allow explicit `null`.
- START_MATCH: status→InProgress, applies `ctx.newCard`, sets `timer.startedAt`
- MARK_CELL: sets `cell.markedBy = caller.playerId`
- UNMARK_CELL: sets `cell.markedBy = null`
- RESHUFFLE_BOARD: applies `ctx.newCard`, resets `timer.startedAt`
- BACK_TO_LOBBY: status→Lobby, clears marks, resets timer, clears readyStates+result
- REMATCH: status→InProgress, applies `ctx.newCard`, resets timer, clears result
- KICK_PLAYER: removes target from `players` array and `readyStates`

## checkWin(state) → MatchResult | null

Checks for line or majority win. Returns null if no win detected. Only runs when `status === 'InProgress'`.

**Line detection**: checks all 12 lines (5 rows + 5 cols + 2 diagonals). Uses `resolveOwnerGroup()` for FFA/team abstraction.

**Majority detection**: calculates per-player cell counts. If `blanks < leader_score - second_score`, the leader wins (mathematically uncatchable). This is NOT a simple ≥13 threshold — it's a dynamic check.

Priority: line > majority (checked in that order; first match returned).

## resolveTimerWinner(state) → MatchResult

Called by the server when countdown expires. Counts cells per player, highest count wins. Tie = draw (`winnerId: null`).

## Board Generation (src/board.ts)

`generateBoard(seed: number, difficulty?: number, spread?: number) → BingoCard`

- Uses **mulberry32** PRNG (seedable, deterministic)
- **Gaussian-weighted sampling without replacement**: `weight(goal) = exp(-0.5 * ((goal.difficulty - target) / spread)^2)`
- **Two-phase algorithm**: (1) select 25 goals via weighted picks, (2) Fisher-Yates shuffle positions to eliminate spatial clustering bias
- Center cell (index 12) is picked first with `centerTarget = min(1.0, difficulty + spread)` (slightly harder than average)
- PRNG call order is fixed: center pick → 24 sequential picks → shuffle
- Each `Cell` carries `difficulty` from the selected `Goal`
- Same seed + same settings always produces the same board; different difficulty → different board

## Goals List (src/goals.ts)

`GOALS: readonly Goal[]` — 90 hardcoded Minecraft bingo goals with `difficulty` values (0.05–0.90) across categories:
- Crafting & tools
- Mining & resources
- Exploration & structures
- Mobs & combat
- Food & farming
- Achievements & feats
- Completely random

```typescript
interface Goal {
  text: string       // displayed goal label
  difficulty: number // 0.0–1.0
}
```

## Tests

- `src/__tests__/engine.test.ts` — tests for validateEvent, applyEvent, checkWin
- `src/__tests__/board.test.ts` — tests for generateBoard determinism
- Test runner: vitest (`vitest.config.ts`)
