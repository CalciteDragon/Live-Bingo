# TODOs

Running list of deferred work and known gaps. Update this file whenever a stub, placeholder, or known-incomplete item is introduced.

---

## `apps/api`

- [ ] Implement `POST /matches` — accept alias + timer settings in body, create match, persist to DB, return `CreateMatchResponse`
- [ ] Implement `POST /matches/:id/join` — accept alias in body, validate join code, assign slot 2, return `JoinMatchResponse`
- [ ] Implement `GET /matches/:id` — hydrate client with current `MatchState`
- [ ] Implement WebSocket intent routing in `src/ws/index.ts` (route parsed `ClientMessage` to handlers)
- [ ] Implement disconnect / presence update handling in `src/ws/index.ts`
- [ ] Send typed `ERROR` message back to client on invalid WebSocket message
- [ ] Implement match persistence (write `state_json` after every accepted event)
- [ ] Implement at-most-once `eventId` deduplication
- [ ] Implement 10-minute abandoned match cleanup
- [ ] Reschedule countdown timers on startup hydration (Phase 5)
- [ ] Write sanity integration tests for API endpoints and WebSocket handlers

## `packages/shared`

<!-- CreateMatchBodySchema and JoinMatchBodySchema (with alias) implemented -->

## `packages/engine`

<!-- all engine functions implemented and tested -->

## `apps/web`

- [ ] Implement Home page component — collect alias (pre-filled random name) before creating/joining
- [ ] Implement Lobby page component — show timer mode, allow host to configure countdown duration; display board seed; allow host to set a custom seed
- [ ] Implement Match page component
- [ ] Implement Results page component
- [ ] Write unit tests for page components

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction
