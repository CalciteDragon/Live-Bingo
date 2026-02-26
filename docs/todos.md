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
- [ ] Add a root npm script (e.g. using `concurrently`) to start API and web dev servers together (`npm run dev`)

## `packages/engine`

- [ ] Implement `validateEvent(state, event)`
- [ ] Implement `applyEvent(state, event)`
- [ ] Implement `checkWin(state)`
- [ ] Write exhaustive unit tests for all three functions

## `apps/web`

- [ ] Implement Home page component
- [ ] Implement Lobby page component
- [ ] Implement Match page component
- [ ] Implement Results page component

## CI

- [ ] Create `.github/workflows/ci.yml` with three jobs: `test-engine`, `test-api`, `build-web`

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction

