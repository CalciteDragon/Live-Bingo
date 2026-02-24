# TODOs

Running list of deferred work and known gaps. Update this file whenever a stub, placeholder, or known-incomplete item is introduced.

---

## `apps/api`

- [ ] Implement `POST /matches` — create match, persist to DB, return `CreateMatchResponse`
- [ ] Implement `POST /matches/:id/join` — validate join code, assign slot 2, return `JoinMatchResponse`
- [ ] Implement `GET /matches/:id` — hydrate client with current `MatchState`
- [ ] Implement WebSocket intent routing in `src/ws/index.ts` (route parsed `ClientMessage` to handlers)
- [ ] Implement disconnect / presence update handling in `src/ws/index.ts`
- [ ] Send typed `ERROR` message back to client on invalid WebSocket message
- [ ] Add DB schema and migrations (`node-pg-migrate`)
- [ ] Implement match persistence (write `state_json` after every accepted event)
- [ ] Implement at-most-once `eventId` deduplication
- [ ] Implement 10-minute abandoned match cleanup

## `packages/engine`

- [ ] Implement `validateEvent(state, event)`
- [ ] Implement `applyEvent(state, event)`
- [ ] Implement `checkWin(state)`
- [ ] Write exhaustive unit tests for all three functions

## `apps/web`

- [ ] Scaffold Angular app
- [ ] Add `apps/web` to root `tsconfig.json` references
