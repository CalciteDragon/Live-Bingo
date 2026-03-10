# Angular Client Implementation Plan

## Context

The backend is fully implemented and tested (REST, WebSocket, engine, DB). The Angular 21 client (`apps/web/`) is scaffolded with stub page components and no services, state, or HTTP/WebSocket integration. This plan establishes the correct build order for all six phases, from infrastructure through game-loop polish, to ensure each layer unblocks the next cleanly.

---

## Open Questions

> **Q1 — Join code → matchId resolution:** The copy-paste join flow (user enters a 6-char code on the Home page) and the share-link flow (`/join/:code`) both require resolving a join code to a `matchId` before calling `POST /matches/:id/join`. The current API has no endpoint for this lookup. Two options:
> - **Option A:** Add `GET /matches/by-code/:code` → returns `{ matchId }` (or 404/410 if invalid/expired). Client calls this first, then calls `POST /matches/:id/join`.
> - **Option B:** Add `POST /join/:code` with body `{ alias }` — a single endpoint that resolves the code, finds the match, and performs the join in one call. Simpler for the client but conflates lookup + join.
>
> **Decision needed before Phase 2 implementation.** The plan currently assumes Option A. Whichever is chosen, the new API route must be added to `apps/api/` as a prerequisite to Phase 2.

- Use Option A for clearer separation of concerns
---

## Baseline

- Angular 21, standalone components, signal-based reactivity, Vitest for tests, SCSS
- `@bingo/shared` already path-aliased in `apps/web/tsconfig.json` → import types directly from there
- `app.config.ts` is missing `provideHttpClient` — must be added in Phase 1
- No environment files yet — must be created in Phase 1
- **Route param convention:** all match routes use `:matchId` (not `:id`). Existing stubs use `:id` — rename in `app.routes.ts` in Phase 1.
- Existing routes (to be renamed): `/` → Home, `/lobby/:matchId` → Lobby, `/match/:matchId` → Match (all stubs)
- **`/results/:matchId` stub route must be deleted** — results are shown as an overlay inside `MatchComponent`, not a separate page. The stub in `app.routes.ts` should be removed in Phase 1 alongside the param rename.
- Missing route: `/join/:code` → JoinComponent (for share-link arrivals)
- **Shared type gap:** `packages/shared/src/errors.ts` `RestErrorCode` is missing `'FORBIDDEN'` (returned by `GET /matches/:id` on 403). Must be added before `MatchApiService` is typed.

---

## Phase 1 — Foundation: Environment, App Config, Core Services

**Goal:** Build and test the full service infrastructure before touching any page component.

### Build Order

1. **Add `'FORBIDDEN'` to `RestErrorCode`** in `packages/shared/src/errors.ts`. Prerequisite for correct `MatchApiService` error mapping.

2. **Environment files** — `src/environments/environment.ts` and `environment.development.ts`, each exporting:
   ```typescript
   export const environment = {
     apiBaseUrl: string,  // 'http://localhost:3000' | 'https://<service>.onrender.com'
     wsBaseUrl:  string,  // 'ws://localhost:3000'   | 'wss://<service>.onrender.com'
   };
   ```
   **`wsBaseUrl` format:** base host only, no path. The service appends `/ws?matchId=...&clientId=...` at connection time.
   - Development: `ws://localhost:3000`
   - Production: `wss://<render-api-service>.onrender.com`

   Register file replacement in `angular.json`.

3. **Route param rename and cleanup** — update `app.routes.ts`: rename `:id` → `:matchId` on lobby and match routes; **delete the `/results/:matchId` route entirely** (results are rendered as an overlay within `MatchComponent`).

4. **`ClientIdService`** (`src/app/core/client-id.service.ts`) — generates and persists the `clientId` UUID in `localStorage` under key `bingo_client_id`. `providedIn: 'root'`. Returns the same ID for the lifetime of the browser session.

5. **`clientIdInterceptor`** (`src/app/core/client-id.interceptor.ts`) — functional `HttpInterceptorFn` that clones every outbound request with `X-Client-Id: <clientId>`.

6. **`app.config.ts`** — add `provideHttpClient(withInterceptors([clientIdInterceptor]))`.

7. **`MatchApiService`** (`src/app/core/match-api.service.ts`) — typed `HttpClient` wrapper:
   - `createMatch(alias): Observable<CreateMatchResponse>`
   - `joinMatch(matchId, alias, joinCode?): Observable<JoinMatchResponse>`
   - `getMatch(matchId): Observable<GetMatchResponse>`
  - `resolveJoinCode(code): Observable<ResolveJoinCodeResponse>` — calls the join-code-lookup endpoint (see Q1)
  - Add `ResolveJoinCodeResponse` to `packages/shared/src/rest.ts` so web and API share one typed contract
   - All errors mapped via `catchError` to `{ code: RestErrorCode; message: string }`, including `'FORBIDDEN'`

8. **`MatchSocketService`** (`src/app/core/match-socket.service.ts`) — `providedIn: 'root'`. Owns the single persistent `WebSocket`. **Pages are subscribers only — they never call `connect()` or `disconnect()`.**
   - `connect(matchId: string): void` — opens `${wsBaseUrl}/ws?matchId=...&clientId=...` using `ClientIdService.clientId`. Called exactly once after a successful create/join REST call, or by `sessionGuard` on hydration.
   - `disconnect(): void` — closes the socket cleanly. Called on session teardown (e.g., navigating home after abandonment).
   - `send(msg: ClientMessage): void` — serializes and sends; no-op if socket is not open.
   - `readonly messages$: Observable<ServerMessage>` — built with `new Observable()` for proper teardown; shared via `share()` so multiple page subscriptions receive the same stream without re-opening the socket. Automatically sends `SYNC_STATE` after each (re-)connection.
   - `readonly connectionStatus = signal<'connected' | 'connecting' | 'disconnected'>('disconnected')`

9. **`SessionStoreService`** (`src/app/core/session-store.service.ts`) — `providedIn: 'root'`:
   - `matchId = signal<string | null>(null)`
   - `playerId = signal<string | null>(null)`
   - `joinCode = signal<string | null>(null)` — stored after create, for Lobby copy-link
   - `matchState = signal<MatchState | null>(null)`
   - `alias = signal<string | null>(this.loadAlias())` — loaded from `localStorage` key `bingo_alias` on init
   - `saveAlias(alias: string): void` — persists to localStorage and updates the signal

10. **`match.helpers.ts`** (`src/app/core/match.helpers.ts`) — pure functions (not injectable):
    - `getMyPlayer(state, playerId)`, `isHost(state, playerId)`, `isAllPlayersReady(state)`
    - `buildClientMessage(type, matchId, clientId, payload)` — generates `eventId` via `crypto.randomUUID()` internally

### Tests
Write unit tests for all of the above before Phase 2:
- `ClientIdService`: UUID generation, localStorage persistence, same value on second call
- `clientIdInterceptor`: header attachment via `HttpTestingController`
- `MatchApiService`: request shape and error mapping per endpoint (including `FORBIDDEN`)
- `MatchSocketService`: correct URL construction (`wsBaseUrl + /ws?...`), `send()` serializes, auto-sends `SYNC_STATE` on connect, `messages$` emits, `connectionStatus` transitions, `share()` ensures single socket for multiple subscribers
- `SessionStoreService`: alias loaded from localStorage on init, `saveAlias()` persists and updates signal
- `match.helpers.ts`: fixture-based pure function tests

### Verification
- `npm test --workspace=apps/web` passes all Phase 1 specs
- `npm run dev:web` starts without TypeScript errors

---

## Phase 2 — Home Page and Join Flow

**Goal:** Working create-match and join-match flows that establish session and connect the WebSocket, landing the user in `/lobby/:matchId`.

### Alias Handling

Alias is persisted to `localStorage` via `SessionStoreService.alias`. The alias field is shown on the **Home page only** — no other page prompts for an alias. If a stored alias exists it pre-fills; if not, `generateAlias()` generates one and saves it immediately. The user can always change it, and the updated value is saved on every change event.

The Join page does **not** show an alias field. It reads `SessionStoreService.alias()` directly. If alias is somehow null on arrival at `/join/:code`, redirect to `/?joinCode=<code>` so the user sets an alias on the home page first.

### Build Order

1. **`generateAlias()`** (`src/app/core/alias.ts`) — pure function returning a random `Adjective + MinecraftNoun` string from small hardcoded arrays.

2. **`HomeComponent`** — replace stub:
   - On init: if `SessionStoreService.alias()` is null, call `generateAlias()` and `saveAlias()`
   - Alias input: always shown, always editable; calls `SessionStoreService.saveAlias(alias)` on `(change)`
   - Local `mode = signal<'create' | 'join'>('create')`
   - **Create flow:** "Create Match" button → `MatchApiService.createMatch(alias())` → write `matchId`, `playerId`, `joinCode`, `matchState` into `SessionStoreService` → `MatchSocketService.connect(matchId)` → navigate to `/lobby/:matchId`
   - **Join flow:** join-code input (6 hex chars, auto-uppercase) → `MatchApiService.resolveJoinCode(code)` → on success, `MatchApiService.joinMatch(matchId, alias(), code)` → write session → `MatchSocketService.connect(matchId)` → navigate to `/lobby/:matchId`
   - `HomeComponent` handles all join errors inline for the copy-paste flow; share-link arrivals use `JoinComponent`
   - If `?abandoned=true` query param present: show dismissible banner "Your match was abandoned." and clear `SessionStoreService` + call `MatchSocketService.disconnect()`

3. **`JoinComponent`** (`src/app/pages/join/`) + route `/join/:code`:
   - Add to `app.routes.ts`, lazy-loaded
   - Reads join code from `:code` route param
   - **No alias input** — reads `SessionStoreService.alias()` directly
   - If alias is null: redirect to `/?joinCode=:code`
   - On load: call `MatchApiService.resolveJoinCode(code)` → then `MatchApiService.joinMatch(matchId, alias(), code)` → write session → `MatchSocketService.connect(matchId)` → navigate to `/lobby/:matchId`
   - Error cases rendered inline:
     - `MATCH_NOT_FOUND` — "This match no longer exists"
     - `MATCH_FULL` — "This match is already full"
     - `JOIN_CODE_EXPIRED` — "This invite link has expired"
     - `MATCH_NOT_JOINABLE` — "This match has already started"
     - `JOIN_CODE_INVALID` — "This invite code is not valid"
     - `CLIENT_CONFLICT` — "You are already in this match" (with link to navigate to the active match)
   - **Note on join URL contract:** The `joinUrl` returned by `POST /matches` must be `/join/<joinCode>` (code in path, nothing else). Verify or update `apps/api/src/routes/matches.ts` to generate this shape. This is the only API-side touch in the web plan.

4. **`sessionGuard`** (`src/app/core/session.guard.ts`) — functional `CanActivateFn` on `/lobby/:matchId` and `/match/:matchId` only. **Single authority for session hydration — no page component calls `getMatch()`.**
   - If `SessionStoreService.matchId()` matches the route `:matchId` param → allow
   - If mismatch (page refresh / direct URL): call `MatchApiService.getMatch(matchId)` → on success, write `matchId`, `playerId`, `matchState` into `SessionStoreService`, call `MatchSocketService.connect(matchId)`, allow → on 403 (`FORBIDDEN`) or 404, redirect to `/`
  - If store is empty and route has `:matchId` (fresh tab/refresh): call `MatchApiService.getMatch(matchId)` → on success, write `matchId`, `playerId`, `matchState` into `SessionStoreService`, call `MatchSocketService.connect(matchId)`, allow → on 403 (`FORBIDDEN`) or 404, redirect to `/`

5. **Route-status consistency contract:**
   - `sessionGuard` owns participant validation and session hydration only.
   - `state.status` from `STATE_SYNC`/`STATE_UPDATE` is the canonical navigation source. `MATCH_STARTED`, `MATCH_COMPLETED` etc. are delivery hints only. Pages navigate based on `state.status`, not on receiving a specific lifecycle message type.
   - Every page component must implement a status-route `effect()` so manual URL changes and browser back/forward self-correct.
   - **Effect-only navigation rule:** All automatic navigation (post-create, post-join, post-state-update) goes through the status-route `effect()`. A subscribe/next callback must never call `router.navigate()` to route the user after a successful state transition — it only writes to `SessionStoreService` and connects the socket. `router.navigate()` is permitted in exactly two cases:
     1. **User-initiated navigation** — e.g. the "Go to your active match" button on `CLIENT_CONFLICT`.
     2. **Guard-style preemptive redirects** — e.g. the null-alias redirect in `JoinComponent`, or `sessionGuard`'s 403/404 redirect. These are error/precondition paths, not state transitions.
   - Tests that verify effect-driven navigation must call `TestBed.flushEffects()` before asserting `router.navigate`.

### Tests
- `HomeComponent`: alias loads from store, generates and saves if null, alias field triggers `saveAlias`, create flow, join-by-code flow (resolveJoinCode → joinMatch), error display, abandoned banner + session teardown
- `JoinComponent`: null alias redirects to home with joinCode param, auto-joins on load, all six error states, `CLIENT_CONFLICT` shows match link, success navigates
- `sessionGuard`: pass-through when session matches, mismatch re-hydration path (calls `getMatch`, connects socket, allows), empty-store re-hydration path (same behavior), 403/404 redirect to home

### Verification
- Navigate to `/` → alias pre-filled (from storage or generated)
- Change alias on home page → saved to localStorage
- Create match → session written, WebSocket connected, arrives at `/lobby/:matchId` stub
- Share `/join/<code>` in second browser (alias set) → auto-joins, navigates to `/lobby/:matchId`
- Share `/join/<code>` with no alias stored → redirected to `/?joinCode=<code>`
- Enter code on home page → resolves → joins → navigates
- Direct `/lobby/:matchId` or `/match/:matchId` with no in-memory session (same `clientId`) → guard hydrates via `GET /matches/:matchId`, connects socket, allows
- Direct `/lobby/:matchId` or `/match/:matchId` as non-participant/different `clientId` → redirected to `/` (or `/?error=forbidden` in Phase 6 hardening)

---

## Phase 3 — Lobby Page

**Goal:** Both players see each other, toggle ready, host configures timer, host starts match. WebSocket is already connected before this page loads — Lobby page subscribes only.

### Build Order

1. **`LobbyComponent`** — replace stub. **Does not call `connect()` or `disconnect()`.** Subscribes to `MatchSocketService.messages$` with `takeUntilDestroyed()`:
   - `STATE_SYNC` / `STATE_UPDATE` → write `state` to `SessionStoreService.matchState`
   - `ERROR` → show error banner
   - All display values as `computed()` signals:
     ```typescript
     players   = computed(() => state()?.players ?? [])
     myReady   = computed(() => state()?.readyStates[playerId()] ?? false)
     amHost    = computed(() => isHost(state()!, playerId()!))
     canStart  = computed(() => amHost() && isAllPlayersReady(state()!))
     timerMode = computed(() => state()?.lobbySettings.timerMode ?? 'stopwatch')
     ```
   - Ready toggle → `SET_READY`
   - Timer mode `<select>` + countdown duration input (debounced 500 ms) → `SET_LOBBY_SETTINGS` (host only)
   - Start button (host only, disabled unless `canStart()`) → `START_MATCH`
   - Copy invite link button → reads `SessionStoreService.joinCode()`, writes to clipboard
   - Board seed display (read-only; custom seed deferred — add to `docs/todos.md`)
   - Status-route `effect()` (canonical navigation — `MATCH_STARTED` is a hint only):
     ```typescript
     effect(() => {
       const s = this.sessionStore.matchState();
       if (s?.status === 'InProgress') this.router.navigate(['/match', s.matchId]);
       if (s?.status === 'Completed')  this.router.navigate(['/match', s.matchId]);  // overlay shows on match page
       if (s?.status === 'Abandoned')  this.router.navigate(['/'], { queryParams: { abandoned: true } });
     });
     ```

### Tests
- `STATE_SYNC` updates `matchState` signal
- Ready toggle sends correct `SET_READY` payload
- Start button disabled when not both ready
- `effect()` navigates to `/match/:matchId` when `status` becomes `InProgress` (regardless of whether `MATCH_STARTED` was received)
- `effect()` navigates to `/match/:matchId` when `status` becomes `Completed` (overlay will show there)
- Component does not call `connect()` or `disconnect()`

### Verification
- Two tabs share lobby → both see each other's alias, ready state, connection status
- Timer settings (host only) propagate to both
- Both clients navigate to `/match/:matchId` when `state.status` becomes `InProgress`

---

## Phase 4 — Match Page (Board + Timer + Results Overlay)

**Goal:** Core gameplay — 5×5 board, mark/unmark, live timer. When the match ends, a results overlay appears on top of the board in place of navigating away. WebSocket already connected — page subscribes only.

### Build Order

1. **`BingoCellComponent`** (`src/app/shared/bingo-cell/`) — pure presentational component:
   - `InputSignal<Cell>` + `InputSignal<string>` (myPlayerId) + `InputSignal<boolean>` (isActive)
   - `OutputEmitterRef<number>` emits `cell.index` on click
   - CSS classes: unmarked / self-marked / opponent-marked
   - No pointer events when `!isActive`
   - No service injection — fully isolated and testable

2. **`TimerService`** (`src/app/core/timer.service.ts`):
   - `getDisplayTimer$(timer: TimerState): Observable<string>` — uses `interval(1000).pipe(startWith(0))`
   - Stopwatch: `elapsed = now - Date.parse(startedAt)` → `MM:SS`
   - Countdown: `remaining = countdownDurationMs - elapsed` → `MM:SS`, clamped at `0`
   - Returns `of('00:00')` when `startedAt` is `null`

3. **`ResultsOverlayComponent`** (`src/app/shared/results-overlay/`) — standalone presentational component rendered inside `MatchComponent`. Not a page; no routing; no socket subscription of its own.
   - Reads `matchState`, `playerId` directly from `SessionStoreService` signals
   - Injects `MatchSocketService` solely to call `send()` for post-match actions
   - Computed display signals:
     ```typescript
     result     = computed(() => state()?.result ?? null)
     winner     = computed(() => players().find(p => p.playerId === result()?.winnerId) ?? null)
     isDraw     = computed(() => result()?.reason === 'draw')
     iWon       = computed(() => winner()?.playerId === playerId())
     winReason  = computed(() => result()?.reason)
     cellCounts = computed(() => /* count cells per playerId from state().card.cells */)
     ```
   - Headline: "You won!" / "You lost." / "It's a draw!"
   - Win reason badge: Line / Majority / Time expired
   - Player score summary (cells marked by each player)
   - Host-only buttons: Rematch → `REMATCH`; Back to Lobby → `BACK_TO_LOBBY`
   - Visual design: full-width overlay rendered over the board. Board remains visible beneath (blurred or dimmed) — final cell state is part of the result context.

4. **`MatchComponent`** — replace stub. **Does not call `connect()` or `disconnect()`.** Session and socket established by `sessionGuard` before this page loads.
   - Subscribes to `MatchSocketService.messages$` with `takeUntilDestroyed()`:
     - `STATE_SYNC` / `STATE_UPDATE` → update `matchState`
     - `ERROR` → show dismissible error banner (3-second auto-dismiss via signal + `setTimeout`)
   - Computed signals:
     ```typescript
     isCompleted = computed(() => state()?.status === 'Completed')
     isActive    = computed(() => state()?.status === 'InProgress')
     ```
   - Status-route `effect()` handles only transitions that require navigation:
     ```typescript
     effect(() => {
       const s = this.sessionStore.matchState();
       if (s?.status === 'Lobby')     this.router.navigate(['/lobby', s.matchId]);
       if (s?.status === 'Abandoned') this.router.navigate(['/'], { queryParams: { abandoned: true } });
       // Completed: no navigation — overlay renders in-place
     });
     ```
   - Template structure:
     ```html
     <div class="match-page">
       <app-timer ... />
       <div class="bingo-board">
         @for (cell of cells(); track cell.index) {
           <app-bingo-cell [isActive]="isActive()" ... />
         }
       </div>
       @if (isActive() && amHost()) {
         <app-match-controls ... />
       }
       @if (isCompleted()) {
         <app-results-overlay />
       }
     </div>
     ```
   - `onCellClick(index)`: sends `MARK_CELL` or `UNMARK_CELL` based on `cell.markedBy`; no-op if cell is opponent's
   - Timer: `effect()` watches `matchState().timer.startedAt`; when it changes, restarts the `Observable<string>` from `TimerService`; template uses `async` pipe
   - Host in-game controls (hidden when overlay is visible): Reshuffle (enabled when `noMarkedCells()`) → `RESHUFFLE_BOARD`; Back to Lobby → `BACK_TO_LOBBY`
   - **Rematch flow:** `ResultsOverlayComponent` sends `REMATCH` → server transitions to `InProgress` → `isCompleted()` becomes false → overlay unmounts → board becomes active. Both players stay on `/match/:matchId`.
   - **Back to Lobby flow:** `ResultsOverlayComponent` sends `BACK_TO_LOBBY` → server transitions to `Lobby` → `MatchComponent`'s `effect()` navigates to `/lobby/:matchId`.

### Tests
- `BingoCellComponent`: CSS class correctness, click emission, disabled state
- `TimerService`: stopwatch counts up, countdown counts down, null guard, formatting
- `ResultsOverlayComponent`: win/loss/draw headline combinations, host-only button visibility, rematch sends `REMATCH`, back-to-lobby sends `BACK_TO_LOBBY`
- `MatchComponent`: `onCellClick` mark/unmark/no-op, overlay shown when `Completed` and hidden when `InProgress`, `effect()` navigates on `Lobby`/`Abandoned` but not `Completed`, component does not call `connect()` or `disconnect()`

### Verification
- Board renders 25 cells with correct goals
- Click unmarked cell → marked with your color after state echo
- Click your marked cell → unmarked
- Click opponent's cell → no-op
- Timer ticks every second in correct direction
- Win → results overlay appears over the board; board visible but inactive beneath
- Rematch → overlay disappears, board resets and becomes active (no navigation)
- Back to Lobby → navigates to `/lobby/:matchId`

---

## Phase 5 — Abandoned State and Session Teardown

**Goal:** Handle match abandonment cleanly. The `ResultsOverlayComponent` was built in Phase 4; this phase wires up the one remaining end-of-session path — the abandoned state — and closes the session lifecycle.

### Build Order

1. **Abandoned state on `HomeComponent`** — on init, read `ActivatedRoute` query params:
   - If `?abandoned=true`: show dismissible banner "Your match was abandoned."
   - If `?error=forbidden`: show dismissible banner "You are not a participant in this match."
   - In both cases: clear all `SessionStoreService` signals and call `MatchSocketService.disconnect()`. This is the **one explicit `disconnect()` call in the entire app**.

2. **Delete the `ResultsComponent` stub** (`src/app/pages/results/`) — the file was scaffolded but is no longer used. Remove it and its route entry (already removed from `app.routes.ts` in Phase 1).

### Tests
- `HomeComponent` abandoned path: `?abandoned=true` → banner shown, `SessionStoreService` cleared, `MatchSocketService.disconnect()` called
- `HomeComponent` forbidden path: `?error=forbidden` → correct banner shown, same teardown

### Verification
- Both players disconnect → 10-minute timer fires → server transitions to `Abandoned` → both clients receive `STATE_UPDATE` with `status: 'Abandoned'` → `MatchComponent`'s `effect()` navigates to `/?abandoned=true` → banner shown on home page, session cleared

---

## Phase 6 — Hardening: Reconnect, Error Handling, Edge Cases

**Goal:** Close gaps that distinguish a reliable app from a demo.

### Build Order

1. **WebSocket auto-reconnect** in `MatchSocketService`:
   - Track `intentional` disconnect flag; on `onclose` without flag → retry with exponential backoff (1s → 2s → 4s → … → 30s cap)
   - `connectionStatus` transitions: `'connecting'` on each retry attempt, `'connected'` on open, `'disconnected'` on intentional close
   - `SYNC_STATE` sent automatically on reconnect (handled by existing auto-send in `connect()`)

2. **Connection status UI** — "Reconnecting…" banner in Lobby and Match pages, keyed off `MatchSocketService.connectionStatus()`.

3. **HTTP error hardening** — map 5xx and network errors to user-facing messages; add retry buttons in Home/Join forms.

4. **Alias client-side validation** — prevent empty or >32-char alias from submitting; show inline error without a network call.

5. **Non-participant redirect hardening** — if `sessionGuard`'s `getMatch()` returns 403 (`FORBIDDEN`), navigate to `/?error=forbidden`; `HomeComponent` shows "You are not a participant in this match."

### Verification
- Drop network during match → "Reconnecting…" banner → reconnects → board state is current
- Empty alias submit → inline error, no network call
- Navigate to `/match/:matchId` in new tab (same `clientId`) → guard hydrates, socket connects, board renders
- Navigate to `/match/:matchId` in new tab (different `clientId`) → guard gets 403, redirected to home

---

## Cross-Cutting Decisions

| Concern | Decision |
|---|---|
| Signal/Observable boundary | Services expose `Observable<ServerMessage>`; components subscribe with `takeUntilDestroyed()` and write to signals |
| Subscription cleanup | `takeUntilDestroyed(this.destroyRef)` on all component subscriptions — no `Subject` + `takeUntil` pattern |
| WebSocket scope | `MatchSocketService` is `providedIn: 'root'`. Connected once on create/join or guard hydration. Pages subscribe only; never call `connect()`/`disconnect()`. |
| Session hydration authority | `sessionGuard` is the sole hydration point. No page component calls `getMatch()`. |
| Navigation authority | All automatic navigation goes through the status-route `effect()` — subscribe callbacks write to `SessionStoreService` and connect the socket, then stop. `router.navigate()` is only called for user-initiated navigation (click handlers) and guard-style preemptive redirects (null-alias check, 403/404 guard). Tests verifying effect-driven navigation must call `TestBed.flushEffects()` before asserting. |
| Results presentation | Results are shown as an overlay inside `MatchComponent`, not a separate route. `Completed` status does not trigger navigation — it toggles overlay visibility via `isCompleted` computed signal. The board remains visible but inactive beneath the overlay. |
| `wsBaseUrl` format | Base host only, no path. Dev: `ws://localhost:3000`. Prod: `wss://<service>.onrender.com`. Service appends `/ws?matchId=...&clientId=...`. |
| Alias persistence | Persisted to `localStorage` (`bingo_alias`). Shown and editable on Home page only. Other pages read from `SessionStoreService.alias()` — never prompt. |
| Client-side win detection | Never. Client only reads `state.status` and `state.result` from server. |
| `eventId` generation | Always in `buildClientMessage()` — never inline in a component. |
| Custom board seed (lobby) | Deferred; display seed read-only for now; entry in `docs/todos.md`. |

---

## Critical Files

| File | Why |
|---|---|
| `packages/shared/src/errors.ts` | Add `'FORBIDDEN'` to `RestErrorCode` — prerequisite for Phase 1 |
| `apps/api/src/` | Add join-code resolution endpoint (see Q1) — prerequisite for Phase 2 |
| `apps/api/src/routes/index.ts` | Verify `joinUrl` generates `/join/<joinCode>` (code in path only) |
| `apps/web/src/app/app.config.ts` | Add `provideHttpClient` + interceptor |
| `apps/web/src/app/app.routes.ts` | Rename `:id` → `:matchId`; **delete `/results/:matchId` route**; add `/join/:code` route; no per-route `providers: [MatchSocketService]` |
| `packages/shared/src/events.ts` | All `ClientMessage` / `ServerMessage` types |
| `packages/shared/src/rest.ts` | `CreateMatchResponse`, `JoinMatchResponse`, `GetMatchResponse`, `ResolveJoinCodeResponse` |
| `packages/shared/src/match.ts` | `MatchState` and all domain types |
| `apps/web/tsconfig.json` | Confirm `@bingo/shared` path alias |
