# TODOs

Running list of deferred work and known gaps. Update this file whenever a stub, placeholder, or known-incomplete item is introduced.

---

## `apps/api`

- [ ] Write integration tests for API endpoints and WebSocket handlers against a real Postgres instance (unit tests with mocked DB already exist) (make sure this is in a seperate command from npm run ci)
- [ ] Harden idempotency and ACID behavior across in-memory registry and Postgres persistence paths
- [ ] Add server-side WebSocket heartbeat (ping/pong every ~30s, terminate on no pong) so crashed/killed clients are detected within a bounded time window rather than relying on TCP keepalive (post-MVP)
- [ ] Bug: lobby ready-state desync — when a player disconnects, their ready state is not cleared, so the other client may see a stale "ready" indicator that doesn't reflect the disconnected player's state

## `packages/shared`

<!-- CreateMatchBodySchema and JoinMatchBodySchema (with alias) implemented -->

## `packages/engine`

- [ ] Make the center square (index 12) always a "hard" goal from the goal pool

## `apps/web`

- [ ] Post-MVP: show a match miniplayer/quick-return UI when navigating away from an active match
- [ ] Post-MVP: show connected/disconnected status indicators for players in-match
- [ ] Post-MVP: improve opponent cell UX — currently opponent cells accept pointer cursor; add cursor hint that the cell is unclickable

## CI

- [ ] Add Postgres service to `test-api` job once DB integration is implemented

## `user-added-todos` — temporary holding area; auto-sorted into sections above on next interaction
- stale clients should be explicitly disconnected and sent to home screen on new connection (multiple clients can be open in two browser tabs in lobby. only one is connected, but the other can still change ready status)
- host kick player button and auto-leave after 30 seconds when disconnected in lobby