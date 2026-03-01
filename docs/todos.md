# TODOs

Running list of deferred work and known gaps. Update this file whenever a stub, placeholder, or known-incomplete item is introduced.

---

## `apps/api`

- [ ] Write integration tests for API endpoints and WebSocket handlers against a real Postgres instance (unit tests with mocked DB already exist) (make sure this is in a seperate command from npm run ci)
- [ ] Harden idempotency and ACID behavior across in-memory registry and Postgres persistence paths

## `packages/shared`

<!-- CreateMatchBodySchema and JoinMatchBodySchema (with alias) implemented -->

## `packages/engine`

<!-- all engine functions implemented and tested -->

## `apps/web`

- [ ] Implement Home page component — collect alias (pre-filled random name) before creating/joining; support joining via join code alone (no full URL required)
- [ ] Implement Lobby page component — show timer mode, allow host to configure countdown duration; display board seed; allow host to set a custom seed
- [ ] Implement Match page component — on page refresh, re-hit `GET /matches/:id` for initial state, then reconnect WebSocket to `ws://api/ws?matchId=xxx&clientId=xxx`; server sends `STATE_SYNC` on connect
- [ ] Implement Results page component
- [ ] Write unit tests for page components

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction
