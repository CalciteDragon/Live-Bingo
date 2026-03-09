# TODOs

Running list of deferred work and known gaps. Update this file whenever a stub, placeholder, or known-incomplete item is introduced.

---

## `apps/api`

- [ ] Write integration tests for API endpoints and WebSocket handlers against a real Postgres instance (unit tests with mocked DB already exist) (make sure this is in a seperate command from npm run ci)
- [ ] Harden idempotency and ACID behavior across in-memory registry and Postgres persistence paths
- [ ] Add server-side WebSocket heartbeat (ping/pong every ~30s, terminate on no pong) so crashed/killed clients are detected within a bounded time window rather than relying on TCP keepalive (post-MVP)

## `packages/shared`

<!-- CreateMatchBodySchema and JoinMatchBodySchema (with alias) implemented -->

## `packages/engine`

<!-- all engine functions implemented and tested -->

## `apps/web`

- [ ] Add reconnect status UI + HTTP error hardening for Home/Join + alias client validation (Phase 6)
- [ ] Add a wildcard route fallback (`**`) to handle unknown URLs (redirect to home or show a minimal Not Found page)
- [ ] Delete the `ResultsComponent` stub (`src/app/pages/results/`) and its directory (Phase 5)
- [ ] Defer custom lobby seed input (keep seed display read-only for MVP)
- [ ] Make the board reshuffle also reset the match timer

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction

- join url checks if user is already in a match with the same ID, or if the passed in ID leads to valid *different* match before deciding to snap "recorrect" url or join a new match
- make sure session store is cleared whenever user is not in a match (probably already the case, but want to verify)
- post mvp idea: navigating to other pages while in-match shows a "miniplayer" of match with easy return option
- improve code documentation and comments
- identifier to "you" in lobby
- reconnect button only works for lobby, not match
- remove join url -> home screen with code autofilled flow, url should always go straight to lobby if sucessful