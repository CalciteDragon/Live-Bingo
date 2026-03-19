# TODOs

Running list of deferred work and known gaps. Update this file whenever a stub, placeholder, or known-incomplete item is introduced.

---

## `apps/api`

- [ ] Write integration tests for API endpoints and WebSocket handlers against a real Postgres instance (unit tests with mocked DB already exist) (make sure this is in a seperate command from npm run ci)
- [ ] Harden idempotency and ACID behavior across in-memory registry and Postgres persistence paths
- [ ] Add server-side WebSocket heartbeat (ping/pong every ~30s, terminate on no pong) so crashed/killed clients are detected within a bounded time window rather than relying on TCP keepalive (post-MVP)
- [ ] On new WebSocket connection, explicitly disconnect and invalidate any pre-existing stale connection for the same clientId (e.g. second browser tab); send that stale client a redirect/error so it navigates to home
- [ ] Host kick-player: add a KICK_PLAYER intent (lobby only); auto-kick a player after 30 s of disconnect in lobby

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
- join code can still get lost on reconnect in certain edge cases
- make bingo card fill screen better (too small on high resolutions)
- rejoin ongoing match flow from join request (currently blocks on "This match has already started" even if you are a participant)
- rejoin recent match home button
- add esLint to npm run ci