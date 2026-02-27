# Engine Implementation Status

## Context

Verified that `MatchState` and all domain types are fully defined in `packages/shared/src/match.ts` before proceeding with engine implementation. The engine plan at `docs/plans/engine-implementation.md` references these types and is ready to execute.

## What's Ready

- **`packages/shared/src/match.ts`** — `MatchState`, `Player`, `Cell`, `BingoCard`, `TimerState`, `MatchResult`, `LobbySettings`
- **`packages/shared/src/events.ts`** — `ClientMessage` (Zod-validated), `ServerMessage` (plain TS)
- **`packages/shared/src/errors.ts`** — `WsErrorCode`, `RestErrorCode`
- **`docs/plans/engine-implementation.md`** — detailed plan with `EngineContext`, validation rules, `applyEvent` transitions, `checkWin` logic, test plan

## What Needs Implementation

Per `docs/plans/engine-implementation.md`:

1. **`packages/engine/src/goals.ts`** — 50+ goals list
2. **`packages/engine/src/board.ts`** — `generateBoard` using mulberry32 PRNG + Fisher-Yates
3. **`packages/engine/src/engine.ts`** — implement `validateEvent`, `applyEvent` (with `EngineContext`), `checkWin`
4. **`packages/engine/src/__tests__/engine.test.ts`** — comprehensive tests
5. **`packages/engine/src/__tests__/board.test.ts`** — board generation tests

## Key Note

`applyEvent` signature must change from `(state, event)` to `(state, event, ctx: EngineContext)` where `EngineContext` carries `nowIso: string` and `newCard: BingoCard` (injected by server, keeps engine IO-free).

## Verification

```bash
npm test --workspace=packages/engine
```
