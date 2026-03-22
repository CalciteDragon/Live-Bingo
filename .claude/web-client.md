# apps/web — Angular SPA

## File Map

```
apps/web/src/
├── main.ts                          Bootstrap
├── index.html                       Single-page shell
├── styles.scss                      Global design system (all CSS)
├── environments/
│   ├── environment.ts               Production (Render URLs)
│   └── environment.development.ts   Dev (empty, uses proxy)
├── app/
│   ├── app.ts                       Root component (nav, leave-match modal, socket disconnect on nav)
│   ├── app.config.ts                Angular providers (router, HTTP client with interceptor)
│   ├── app.routes.ts                Route definitions (lazy-loaded)
│   ├── core/                        Services, guards, interceptors, helpers
│   │   ├── alias.ts                 Random alias generator (Adjective+Noun)
│   │   ├── client-id.service.ts     Persistent clientId (localStorage)
│   │   ├── client-id.interceptor.ts HTTP interceptor: adds X-Client-Id header
│   │   ├── match-api.service.ts     REST API client (create, join, get, resolveJoinCode)
│   │   ├── match-socket.service.ts  WebSocket client (connect, disconnect, send, reconnect)
│   │   ├── match.helpers.ts         Pure helpers (isHost, buildClientMessage, colors, rankings)
│   │   ├── session-store.service.ts Signal-based session state (matchId, playerId, matchState, alias)
│   │   ├── session.guard.ts         Route guard: ensures session + WS connection before match routes
│   │   ├── timer.service.ts         Observable-based timer display (stopwatch/countdown)
│   │   └── uuid.ts                  UUID v4 generator (crypto.randomUUID with fallback)
│   ├── pages/
│   │   ├── home/home.ts             Home page (create/join match, rejoin banner)
│   │   ├── join/join.ts             Join flow (resolve code → join match → navigate)
│   │   ├── lobby/lobby.ts           Lobby (player list, ready, settings, start)
│   │   └── match/match.ts           Match page (board, timer, controls, results overlay)
│   └── shared/
│       ├── bingo-cell/bingo-cell.ts     Single board cell component
│       ├── player-panel/player-panel.ts Player rankings sidebar
│       └── results-overlay/results-overlay.ts Match results modal
```

## Routing (app.routes.ts)

| Path | Component | Guard | Load |
|---|---|---|---|
| `/` | HomeComponent | none | lazy |
| `/join/:code` | JoinComponent | none | lazy |
| `/lobby/:matchId` | LobbyComponent | sessionGuard | lazy |
| `/match/:matchId` | MatchComponent | sessionGuard | lazy |
| `**` | redirect to `/` | — | — |

## Core Services

### ClientIdService
- Generates UUID v4, persists in `localStorage` as `bingo_client_id`
- Singleton, read-only `clientId` property

### ClientIdInterceptor
- HTTP interceptor: clones every request with `X-Client-Id` header

### MatchApiService
- REST client wrapping `HttpClient`
- Methods: `createMatch(alias)`, `joinMatch(matchId, alias, joinCode?)`, `getMatch(matchId)`, `resolveJoinCode(code)`
- Maps HTTP errors to `ApiError` objects with typed `RestErrorCode`

### MatchSocketService
- WebSocket management with exponential backoff reconnection (max 30s)
- Signals: `connectionStatus` ('connected'|'connecting'|'disconnected'), `isReconnecting`, `sessionReplaced`, `wasKicked`
- Observable: `messages$` (all ServerMessage)
- Methods: `connect(matchId)`, `disconnect()`, `send(ClientMessage)`
- On connect: sends SYNC_STATE immediately
- On SESSION_REPLACED error: sets `sessionReplaced` signal, stops reconnecting
- On KICKED error: sets `wasKicked` signal, stops reconnecting
- Reconnect logic: exponential backoff `1s * 2^attempt`, capped at 30s

### SessionStoreService
- Signal-based state store: `matchId`, `playerId`, `joinCode`, `matchState`, `alias`
- Persists alias in `localStorage` (`bingo_alias`)
- Persists session to `localStorage` (`bingo_session`) with 5-min TTL for rejoin
- `clear()` resets all signals + removes session
- `getPersistedSession()` returns `{ matchId, route, joinCode }` if within TTL

### SessionGuard
- Ensures session store is populated before match routes
- If `matchId` already matches: reconnects socket if disconnected
- Otherwise: calls `GET /matches/:id` to hydrate, then connects socket
- On FORBIDDEN: redirects to home with `?error=forbidden`

### TimerService
- `getDisplayTimer$(timer: TimerState) → Observable<string>`
- Emits `MM:SS` every second (stopwatch: counts up, countdown: counts down to 0)

### Helpers (match.helpers.ts)

- `getMyPlayer(state, playerId)` — find player in state
- `isHost(state, playerId)` — checks slot === 1
- `isAllPlayersReady(state)` — min 2 players, all ready
- `buildClientMessage(type, matchId, clientId, payload)` — creates typed ClientMessage with random eventId
- `SLOT_COLORS` — `{ 1: '#4a9eff', 2: '#ff6b6b', 3: '#51cf66', 4: '#fcc419' }`
- `buildPlayerColorMap(state)` — maps playerId → CSS color from slot
- `getPlayerRankings(state, myPlayerId)` — dense-ranked player entries with scores
- `ordinalLabel(rank)` — '1st', '2nd', '3rd', etc.

### Alias Generator (alias.ts)

`generateAlias()` — random `Adjective + Noun` from Minecraft-themed word lists (10 adjectives x 10 nouns = 100 combos)

## Page Components

### HomeComponent
- Create/join tabs
- Alias input (auto-generated if empty)
- Create: calls `matchApi.createMatch()` → sets session → navigates to lobby
- Join: validates 6-char code → navigates to `/join/:code`
- Rejoin banner: shows if persisted session exists (5-min TTL)
- Error banners: abandoned, forbidden, kicked, session-replaced

### JoinComponent
- Reads `:code` from route params
- If no alias: shows alias input form
- Flow: resolveJoinCode → joinMatch → set session → effect navigates based on status
- CLIENT_CONFLICT handling: if already in match, calls `getMatch` to restore session

### LobbyComponent
- Shows: seed, join code, copy invite link, player list with ready/connected badges
- Toggle ready button
- Host controls: timer mode dropdown, countdown duration input (debounced 500ms), start match button
- Host action: kick player button (non-self, host-only)
- Socket message handling: STATE_SYNC/STATE_UPDATE → update matchState; PRESENCE_UPDATE → merge players; ERROR (non-KICKED) → show banner; ERROR KICKED → suppress banner (effect handles redirect)
- Countdown duration: uses optimistic local state with pending eventId tracking (avoids flicker during debounced sends)
- Auto-navigates: InProgress → /match, Completed → /match, Abandoned → /, session replaced → /, kicked → /?kicked=true

**Signals:**
- `errorMessage` — `string | null`; displays ERROR messages from server
- `linkCopied` — boolean; transient "Copied!" feedback (2s timeout)
- `countdownDurationMs` — number; optimistic local state for countdown input
- `isEditingCountdown` — boolean; flags when input has focus (prevents server broadcasts from overwriting)
- `playerToKick` — `{ playerId, alias } | null`; non-null while a kick confirmation modal is open

**Computed signals:**
- `players` — all players from matchState
- `readyStates` — ready state map from matchState
- `playersWithLocalStatus` — players with WS connection status overlaid (live feedback)
- `myReady` — current player's ready state
- `amHost` — true if current player is host (slot 1)
- `canStart` — true if host and all players ready
- `timerMode` — timer mode from lobby settings (stopwatch|countdown)
- `seed` — bingo card seed
- `joinCode` — current player's join code
- `isReconnecting` — true if WebSocket is reconnecting

**Methods:**
- `toggleReady()` — sends SET_READY intent (opposite of current state)
- `onTimerModeChange(event)` — sends SET_LOBBY_SETTINGS intent with new timer mode
- `onCountdownInput(event)` — updates local countdown state, debounces 500ms before sending
- `onCountdownFocus()` / `onCountdownBlur()` — flags editing state (prevents clobbering)
- `startMatch()` — sends START_MATCH intent (host-only)
- `openKickConfirm(player)` — sets `playerToKick` to open the confirmation modal (host-only, non-self)
- `confirmKick()` — sends KICK_PLAYER intent and clears `playerToKick`
- `cancelKick()` — clears `playerToKick` without sending
- `copyInviteLink()` — copies full join URL to clipboard; shows transient feedback

### MatchComponent
- Shows: timer, player panel, 5x5 bingo board, host controls (reshuffle, back to lobby), results overlay
- Cell click: if own cell → UNMARK_CELL; if empty → MARK_CELL; if opponent's → no-op
- Reshuffle: only enabled when no cells marked
- Timer: reactive Observable via toObservable + switchMap
- Auto-navigates: Lobby → /lobby, Abandoned → /

## Shared Components

### BingoCellComponent
- Inputs: `cell` (Cell), `playerColorMap` (Record<string, string>), `isActive` (boolean)
- Output: `cellClick` (emits cell index)
- Uses CSS custom property `--cell-color` for dynamic player coloring

### PlayerPanelComponent
- Reads state from SessionStoreService
- Computes dense rankings via `getPlayerRankings()`
- Shows: rank, color swatch, alias, score

### ResultsOverlayComponent
- Headline: "You won!" / "You came 2nd!" / "It's a draw!"
- Win reason badge (Line/Majority/Time expired)
- Score summary (all players sorted by cell count)
- Host actions: Rematch, Back to Lobby
- Non-host: "Waiting for host..."

## Root Component (app.ts)

- Nav bar with "Live Bingo" logo (navigates home with leave-match confirmation if InProgress)
- Page label based on current URL (Lobby/Match/Join)
- Modal: leave-match warning when navigating away from InProgress match
- Auto-disconnects socket on NavigationEnd when leaving match routes

## Styling (styles.scss)

Global design system — no component-level styles. All CSS in one file.

Key sections:
- CSS custom properties (tokens): `--bg`, `--surface`, `--border`, `--text`, `--accent`, `--danger`, etc.
- Components: `.app-nav`, `.page`, `.card`, `.banner`, `.tabs`, `.player-card`, `.badge`, `.modal`, `.bingo-board`, `.bingo-cell`, `.player-panel`, `.match-controls`, `.results-overlay`
- Accent color: green (`#16a34a`)
- Board: CSS Grid 5x5, `aspect-ratio: 1` for square cells

## Environment Config

- Production: `apiBaseUrl: 'https://live-bingo-w7ua.onrender.com'`, `wsBaseUrl: 'wss://live-bingo-w7ua.onrender.com'`
- Development: both empty (uses Angular dev proxy)

## Dev Proxy (proxy.config.json)

- `/matches` → `http://localhost:3000`
- `/ws` → `http://localhost:3000` (WebSocket upgrade enabled)

## Tests

Spec files co-located with source (`*.spec.ts`). Test runner: Karma (Angular default).
