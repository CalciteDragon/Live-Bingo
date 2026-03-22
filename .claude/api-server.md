# apps/api — Node.js + TypeScript Server

## File Map

```
apps/api/
├── src/
│   ├── index.ts                Server entrypoint (creates HTTP server, WSS, hydrates from DB)
│   ├── app.ts                  Express app factory (CORS, JSON, logging, routes)
│   ├── match-registry.ts       In-memory match state + socket management
│   ├── db/index.ts             Postgres Pool (pg)
│   ├── middleware/
│   │   └── client-id.ts        X-Client-Id header validation middleware
│   ├── routes/
│   │   └── index.ts            REST route handlers (matchRouter)
│   ├── ws/
│   │   ├── index.ts            WebSocket upgrade, connection lifecycle, disconnect handling
│   │   ├── message-pipeline.ts 12-stage message processing pipeline
│   │   └── match-timers.ts     Countdown + abandon timer management
│   ├── scripts/
│   │   └── migrate.ts          DB migration runner
│   └── __tests__/
│       ├── routes.test.ts      REST endpoint tests
│       └── ws.test.ts          WebSocket handler tests
├── migrations/
│   └── 1740574800000_initial_schema.sql
├── package.json
├── vitest.config.ts
└── tsconfig.json
```

## Server Startup (src/index.ts)

1. Creates Express app + HTTP server + WebSocketServer (`noServer: true`)
2. Hydrates active matches from DB: `SELECT match_id, state_json FROM matches WHERE status IN ('Lobby', 'InProgress')`
3. For each hydrated match:
   - Loads into in-memory registry
   - Starts 10-min abandon timer (all sockets empty on restart)
   - Reschedules countdown timer if match was InProgress with countdown mode
4. Listens on `PORT` (env var, default 3000)

## Express App (src/app.ts)

- CORS: `origin: process.env['CLIENT_ORIGIN']`
- JSON body parser
- Request logging middleware (method, path, status, duration)
- Routes mounted at `/matches`

## Match Registry (src/match-registry.ts)

In-memory `Map<string, MatchEntry>`:

```typescript
interface MatchEntry {
  state: MatchState
  sockets: Map<string, WebSocket>                // clientId → WebSocket
  abandonTimer?: NodeJS.Timeout
  countdownTimer?: NodeJS.Timeout
  lobbyKickTimers?: Map<string, NodeJS.Timeout>  // playerId → 30s auto-kick timer (Lobby only)
}
```

Functions:
- `getMatch(matchId)`, `setMatch(matchId, entry)`, `deleteMatch(matchId)`
- `registerSocket(matchId, clientId, ws)` — replaces stale socket if same clientId reconnects (sends SESSION_REPLACED error to old socket, closes it)
- `removeSocket(matchId, clientId)`, `removeSocketIfCurrent(matchId, clientId, ws)` — only removes if ws matches current
- `broadcastToMatch(matchId, message)` — sends to all connected sockets

## REST Routes (src/routes/index.ts)

All routes use `clientIdMiddleware` (validates `X-Client-Id` header via Zod).

### POST /matches — Create match
- Validates body with `CreateMatchBodySchema`
- Generates: matchId (UUID), playerId (UUID), seed (random 32-bit), joinCode (6-char hex uppercase), 30-min expiry
- Creates initial MatchState (Lobby, stopwatch mode, one player at slot 1)
- DB transaction: inserts into `matches` + `match_players`
- Adds to registry, returns `CreateMatchResponse`

### POST /matches/:id/join — Join match
- Validates body with `JoinMatchBodySchema`
- Checks: match exists, status=Lobby, not already joined, not full (max 4), join code not expired, join code matches (if provided)
- DB transaction with `FOR UPDATE` lock to get next slot number
- Adds player to state, persists, returns `JoinMatchResponse`

### GET /matches/by-code/:code — Resolve join code
- Looks up match by join code, checks expiry
- Returns `{ matchId }`

### GET /matches/:id — Hydrate state
- Always queries DB for `join_code` and `join_code_expires_at` (not stored in registry)
- Prefers registry state over DB state_json (more current)
- Validates caller is a participant (`clientId` match)
- Returns `GetMatchResponse` including `joinCode: string | null` (null if expired or no code on record)

## WebSocket Handling (src/ws/index.ts)

### Upgrade
- Validates query params: `matchId` and `clientId` (both UUID format)
- Verifies match exists in registry and client is a participant
- On success, performs `wss.handleUpgrade` → `onClientConnected`

### onClientConnected
1. Registers socket in registry (replaces stale socket for same clientId)
2. Cancels abandon timer
3. Cancels any pending lobby auto-kick timer for the reconnecting player
4. Sets player `connected: true` in state, persists to DB
5. Broadcasts PRESENCE_UPDATE to all
6. Sends STATE_SYNC to the connecting client
7. Attaches `message` and `close` event handlers

### handleDisconnect
1. Only proceeds if `removeSocketIfCurrent` returns true (prevents stale socket handling)
2. Sets player `connected: false`
3. If lobby: also sets player's ready state to false
4. Persists to DB, broadcasts PRESENCE_UPDATE
5. If Lobby and non-host player: starts 30s auto-kick timer (`scheduleLobbyKickTimer`)
6. If ALL players disconnected: starts abandon timer

## Message Pipeline (src/ws/message-pipeline.ts)

`processMessage(ws, matchId, clientId, raw)` — 12-stage pipeline:

1. **Parse**: JSON.parse + Zod `ClientMessageSchema.safeParse`
2. **Envelope check**: matchId/clientId must match connection credentials
3. **Registry lookup**: get MatchEntry (drop silently if evicted)
4. **SYNC_STATE short-circuit**: read-only, returns STATE_SYNC immediately
5. **Deduplication**: DB lookup in `match_events` for eventId
6. **Engine validation**: `validateEvent(state, message)` — catches EngineError
7. **Apply + check win**: `buildEngineContext` → `applyEvent` → `checkWin`. If win, sets status=Completed
8. **Persist**: DB transaction — insert into `match_events`, update `matches` (state_json, status, started_at/ended_at)
9. **Registry commit**: update in-memory state
10. **Broadcast**: STATE_UPDATE with full state + lastAppliedEventId
11. **Lifecycle broadcasts**: MATCH_STARTED / MATCH_COMPLETED as appropriate
12. **Timer reconciliation**: cancel/start countdown timers based on event type

`buildEngineContext(message)`: generates new board (random seed) for START_MATCH/RESHUFFLE_BOARD/REMATCH; always provides `nowIso`.

## Timers (src/ws/match-timers.ts)

### Countdown Timer
- `scheduleCountdownTimer(matchId, remainingMs)` — clears existing, sets new `setTimeout`
- `cancelCountdownTimer(matchId)` — clears timeout
- `expireCountdown(matchId)` — called on timeout: evaluates `resolveTimerWinner`, sets Completed, persists, broadcasts STATE_UPDATE + MATCH_COMPLETED

### Abandon Timer
- `scheduleAbandonTimer(matchId)` — 10-minute timeout when all players disconnect
- `cancelAbandonTimer(matchId)` — cancelled when any player reconnects
- `abandonMatch(matchId)` — deletes from DB + registry, cancels countdown timer

### Lobby Kick Timer
- `scheduleLobbyKickTimer(matchId, playerId)` — 30-second timeout when a non-host player disconnects in Lobby; resets if called again before firing
- `cancelLobbyKickTimer(matchId, playerId)` — cancelled when the player reconnects or is manually kicked
- `autoKickPlayer(matchId, playerId)` — fires after 30s: removes player from state + `match_players` DB row, broadcasts STATE_UPDATE + PRESENCE_UPDATE; no-ops if match left Lobby or player reconnected

## Tests

- `routes.test.ts` — REST endpoint tests (mocked DB)
- `ws.test.ts` — WebSocket handler tests (mocked DB)
- Test runner: vitest

## Dependencies

Key packages: `express`, `cors`, `ws`, `pg`, `dotenv`, `zod`, `@bingo/shared`, `@bingo/engine`

Dev: `vitest`, `tsx` (for running TS directly)
