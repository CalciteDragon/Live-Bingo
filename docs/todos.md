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

- [ ] Add a wildcard route fallback (`**`) to handle unknown URLs (redirect to home or show a minimal Not Found page)
- [ ] Defer custom lobby seed input (keep seed display read-only for MVP)
- [ ] Make the board reshuffle also reset the match timer
- [ ] Remove the `/join/:code` → home redirect flow (null-alias path); share links should always attempt to join directly and only redirect home on hard errors
- [ ] Add "you" identifier badge to the current player's row in the Lobby player list
- [ ] Verify session store is cleared whenever the user is not in an active match (audit all teardown paths)
- [ ] Post-MVP: show a match miniplayer/quick-return UI when navigating away from an active match

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction