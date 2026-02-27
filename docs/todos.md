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
- [ ] Run migrations automatically on API startup (or as a pre-start step in deployment)
- [ ] Implement match persistence (write `state_json` after every accepted event)
- [ ] Implement at-most-once `eventId` deduplication
- [ ] Implement 10-minute abandoned match cleanup
- [ ] Add logging middleware
- [ ] Write sanity integration tests for API endpoints and WebSocket handlers

## `packages/engine`

- [ ] Implement `validateEvent(state, event)`
- [ ] Implement `applyEvent(state, event, ctx: EngineContext)`
- [ ] Implement `checkWin(state)`
- [ ] Write exhaustive unit tests for all three engine functions

## `apps/web`

- [ ] Implement Home page component
- [ ] Implement Lobby page component
- [ ] Implement Match page component
- [ ] Implement Results page component
- [ ] Write unit tests for page components

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction

- npm run ci should have an "all tests pass" indicator at the end of the output
- make src/app/app.spec.ts automatically exit after one round of tests (currently i have to press q to quit every time)
