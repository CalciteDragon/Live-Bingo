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

- [ ] Implement Home page create/join flows with persisted alias, join-code entry, and abandoned/forbidden banners
- [ ] Implement `JoinComponent` for `/join/:code` with resolve-then-join flow and inline error states
- [ ] Implement `sessionGuard` hydration for `/lobby/:matchId` and `/match/:matchId` (allow refresh/new-tab restore for same `clientId`)
- [ ] Implement Lobby page component — show players/ready state, host timer settings, start flow, copy invite link, seed display (read-only)
- [ ] Implement Match page component with 5x5 board, timer, host controls, and in-page results overlay (no separate results route)
- [ ] Add reconnect status UI + HTTP error hardening for Home/Join + alias client validation
- [ ] Write unit tests for core services and page components per `docs/plans/angular-client-phases.md`
- [ ] Defer custom lobby seed input (keep seed display read-only for MVP)
- [ ] Make the board reshuffle also reset the match timer

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction