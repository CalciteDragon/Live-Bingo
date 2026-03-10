# Live Bingo 1v1 — System Overview

> Real-time 1v1 Live Bingo web app built with Angular (SPA), Node.js + TypeScript backend, WebSockets, and Postgres. Deployed on Render.

---

## 1. Purpose & Vision

This project is a 1v1 real-time bingo web app designed for quick setup, seamless gameplay, and manual goal verification against pre-generated bingo challenges in games like Minecraft.

The MVP must deliver a functioning client web UI that contacts a server to create a private lobby, returns a shareable link for a second player to join, and presents both players with a populated, interactive bingo board that updates between clients in near real-time. Real-time updates are critical because responsivity directly impacts the competitive experience and overall enjoyment of an online challenge.

### Success Criteria

The project is successful when it meets the MVP feature set and additionally demonstrates:

- A full-stack web app with well-documented components and APIs
- Working unit and integration tests
- A CI/CD pipeline
- Well-defined boundaries and contracts between system components

---

## 2. Scope Definition

### 2.1 MVP Features

- 1v1 real-time matches
- Create / join match via shareable link or short code
- Shared 5×5 bingo card generated from a seed
- Lobby with per-player ready state
- Configurable match timer (stopwatch or countdown, selected in lobby settings)
- Manual cell marking (no auto-verification)
- Win detection: line completion, majority, and win-by-time
- Results screen

### 2.2 Roles

The **host** is always the player who created the match (slot 1). Host status cannot be transferred. If the host disconnects, their host privileges are suspended until they reconnect; the guest cannot assume host actions.

### 2.3 Player Actions During a Match

- **Mark a cell:** Click an unmarked cell to mark it globally. The server records which player marked it.
- **Unmark a cell:** Click a marked cell to unmark it globally, but only if the clicking player originally marked that cell. The server enforces mark ownership while the match is in progress.
- **Reshuffle the board (host only):** Regenerate the board from a new seed during an active match, allowed only if no cells are currently marked. The match timer resets on reshuffle. This is a distinct action from rematch.
- **Leave the match:** Disconnect and return to the home screen.

### 2.4 Post-Match Actions

- **Rematch (host only):** Transition from Completed directly back to InProgress with a fresh board generated from a new seed, resetting all marks and the timer. This allows immediate rematches without returning to the lobby.

### 2.5 Server vs Client Responsibilities

**Server-side:**

- Join link/code creation and expiration
- Match and board initialization
- Match state persistence (source of truth)
- Event validation and application
- Win detection (line, majority, timer expiry)
- Timer management (countdown expiry triggers server-side)
- Lobby ready state management
- Lobby settings enforcement

**Client-side:**

- Local board UI rendering and interactivity
- Sending player intent events to the server
- Timer display (derived from server-provided anchor timestamps)

### 2.6 Non-Goals (Explicit Exclusions)

The following are intentionally excluded from the MVP to prevent scope creep:

- Detection of in-game actions in Minecraft or any other game
- More than two players in a lobby
- Public lobbies or lobby discovery/listing
- Player account creation, authentication, or storage
- Saved match history, results, or timelines
- Ranking, Elo, or leaderboard systems
- Mobile-native apps
- Over-engineered microservices

---

## 3. High-Level Architecture

### 3.1 System Components

| Component | Deployment | Role |
|---|---|---|
| **Angular SPA** | Render Static Site | Serves the client HTML/JS built from Angular source |
| **Node.js + TypeScript API** | Render Web Service | Exposes REST endpoints and WebSocket connections |
| **WebSocket layer** | Co-located with API service | Maintains persistent connections for real-time client-to-client updates via server relay |
| **Postgres** | Render Managed DB | Persists match state snapshots and event logs |

Third-party platform hosting (Render) reduces infrastructure complexity while still enabling full-stack development and deployment practice.

### 3.2 Why Server-Authoritative

The server is the sole source of truth because there is only one server and two clients. Having clients serve as the source of truth would introduce conflicts, require complex client-to-client validation, and open the door to cheating. A single server validating all state changes is simpler, more reliable, and more secure.

### 3.3 Why WebSockets Over Polling

WebSockets enable server-initiated messages, meaning the server can push state changes immediately after they are applied. With polling, update latency is bounded by the poll interval, and repeated HTTP requests create unnecessary overhead. For a fast-paced competitive experience, push-based updates are the right choice.

### 3.4 Postgres vs In-Memory State

The Postgres database is updated with a full match state snapshot and an append-only event log row after every accepted state change. This guarantees persistence of match state in case the server crashes or restarts mid-match. The snapshot is the primary persisted representation; the event log is used for debugging and auditing.

---

## 4. Architectural Principles

### 4.1 Core Design Rules

- **Server authoritative:** Clients send intent events; the server validates, applies, persists, and broadcasts the resulting state.
- **Event-driven state updates:** All state mutations flow through an explicit event pipeline.
- **Pure match engine:** Core match logic (`applyEvent`, `validateEvent`, `checkWin`) is IO-free, produces no side effects, does not mutate input state, generates no random numbers, and has no external dependencies.
- **Explicit contracts:** Shared TypeScript types and Zod schemas define all boundaries between client, server, and engine.
- **Reconnect safety and idempotency:** The system must handle disconnects and duplicate events gracefully.

### 4.2 System Invariants

These must always hold true:

1. The server applies events in a single canonical order per match.
2. Match state is persisted as a snapshot after each accepted event, so a match can be reconstructed after reconnect or server restart.
3. Each client intent includes an `eventId` that the server processes at most once per match (idempotency).
4. The server never trusts client-reported game state, timer values, or win claims.
5. Client identity beyond the server-recognized `clientId` is not trusted. The `clientId` serves as a reconnect/idempotency hint and does not grant authority by itself.

---

## 5. Domain Model

### 5.1 Core Entities

| Entity | Description |
|---|---|
| **Match** | Top-level container for a game session, identified by a UUID `matchId`. Players join via a short-lived join code or link that resolves to the `matchId`. |
| **Player** | A participant in a match, identified by a server-assigned `playerId` UUID. Slot 1 is always the host. |
| **ClientSession** | Represents a browser instance, identified by a `clientId` UUID generated on first load and stored in `localStorage`. Used for reconnect and idempotency. |
| **Lobby** | Pre-match state containing ready flags and settings (including timer mode). |
| **BingoCard** | The 5×5 grid generated deterministically from a seed. |
| **Cell** | A single square on the bingo card, with a goal description and optional mark (including which player marked it). |
| **MatchState** | The authoritative snapshot of the entire match at a point in time (board, marks, ownership, timer, lifecycle status). |
| **Event** | A validated, sequenced state mutation applied by the engine. |

### 5.2 Persistence Boundaries

**Persisted (in Postgres):**

- Match record: `matchId`, status, `createdAt`/`startedAt`/`endedAt`
- Lobby settings (including timer mode and countdown duration if applicable)
- Full `MatchState` snapshot after each accepted event
- Append-only event log rows (for debugging/auditing)
- Cell marks and mark ownership (as part of `MatchState`)

**Ephemeral (reset on disconnect/reconnect or server restart):**

- Player ready states (reset to unready on disconnect)

**Transient (client-only):**

- UI state: hover, selection, animations, local pending-send queue

### 5.3 Minimum State for Match Reconstruction

The persisted `MatchState` snapshot (board seed/goals, marks/ownership, timer anchors, lifecycle status) plus the `matchId`. Lobby data is only required if the match is still in the lobby phase.

---

## 6. Match Lifecycle State Machine

### 6.1 States

| State | Description |
|---|---|
| **Lobby** | Match created, waiting for players to join and ready up. |
| **InProgress** | Match is active, players are marking cells. |
| **Completed** | A win condition has been met or the timer has expired. |
| **Abandoned** | Both players have left or the match has expired. Abandoned matches are permanently destroyed after a **10-minute timeout** from the moment the last player disconnects. |

### 6.2 Transitions

| Trigger | From | To | Conditions |
|---|---|---|---|
| `StartMatch` | Lobby | InProgress | Both players present and ready. Host-only. |
| `PlayerWin` | InProgress | Completed | Line completion, majority, or timer expiry detected by server. |
| `BackToLobby` | InProgress / Completed | Lobby | Host-only. Resets marks, timer, and ready states. Board seed is preserved. |
| `Rematch` | Completed | InProgress | Host initiates. New seed and board generated, marks reset, timer reset. Both players must be connected. |
| `PlayerLeave` (all players) | Any | Abandoned | Both players have disconnected. 10-minute destruction timer begins. |
| `PlayerJoin` | Abandoned | Lobby | Player re-joins before the 10-minute timeout. Match rehydrates to Lobby state with ready states reset. |

### 6.3 Invalid Transitions

- Lobby → Completed (cannot skip InProgress)
- Abandoned → InProgress (must re-join through Lobby first)

### 6.4 Disconnect and Reconnect Behavior

- Disconnect does **not** immediately change lifecycle state. It marks the player as disconnected and resets their ready state if the match is in Lobby.
- Reconnect re-associates the player to the existing match and triggers a state sync. If the match is InProgress, gameplay continues from the server snapshot.
- If both players disconnect, the match transitions to Abandoned and begins the 10-minute destruction countdown.

---

## 7. Win Conditions

A match ends and transitions to Completed when any of the following conditions are met. The server checks all conditions after every accepted `MARK_CELL` or `UNMARK_CELL` event, and additionally on timer expiry for countdown mode.

### 7.1 Line Completion

A player wins by completing an entire row, column, or diagonal (5 cells) where **all 5 cells are marked by that player**. Mixed-ownership lines do not count. Both players' lines are checked after every mark event; if a mark event simultaneously completes a line for the marking player, that player wins.

### 7.2 Majority

A player wins by owning more than half of all cells on the board. On a 5×5 board (25 cells), this means a player wins when they have **13 or more** cells marked.

### 7.3 Win by Time (Countdown Mode Only)

When the match timer is configured as a countdown and it reaches zero, the match ends. The player who owns more marked cells at the moment of expiry wins. If both players have the same number of marked cells, the result is a draw.

### 7.4 Priority

If a single `MARK_CELL` event simultaneously triggers multiple win conditions (e.g., completing a line and achieving majority), line completion takes precedence as the reported win reason. The practical outcome is the same — the marking player wins — but the reported reason should reflect the most specific condition.

---

## 8. Match Timer

The match timer is configured via lobby settings before the match starts. Two modes are supported:

### 8.1 Stopwatch Mode

A count-up timer that displays elapsed time since the match started. Purely informational; it does not trigger any state transitions. The server stores a `startedAt` timestamp and the client derives the display value.

### 8.2 Countdown Mode

A decrementing timer that starts from a host-configured duration (e.g., 10 minutes). When the timer reaches zero, the server triggers a `TimerExpiry` event that transitions the match to Completed and evaluates win-by-time (Section 7.3). The server stores `startedAt` and `countdownDurationMs` as part of `MatchState`; the client derives the remaining time from these anchors.

### 8.3 Timer and Reshuffle

When a reshuffle occurs during an active match, the timer resets. In stopwatch mode, `startedAt` is updated to the current time. In countdown mode, the countdown restarts from the original duration.

### 8.4 Timer and Rematch

On rematch, the timer resets to its initial state (stopwatch restarts from zero; countdown restarts from the configured duration).

---

## 9. API Contracts

REST is used for match creation, joining, and initial hydration. WebSockets are used for real-time intent and authoritative state updates. The `clientId` is sent as a request header (`X-Client-Id`) on all REST requests for consistency with the WebSocket envelope.

### 9.1 REST Endpoints

**`POST /matches`** — Create a new match in Lobby state.

- Headers: `X-Client-Id`
- Returns: `{ matchId, joinCode, joinUrl, state }`
- Not idempotent (each call creates a new match).
- The creating player is automatically assigned as host (slot 1).

**`POST /matches/:id/join`** — Add a player to the match (or re-associate an existing session).

- Headers: `X-Client-Id`
- Accepts: optionally a join code in the request body.
- Returns: `{ matchId, playerId, state }`
- Effectively idempotent for MVP: if the same `clientId` joins the same match twice, the server returns the existing `playerId` and current state rather than creating a duplicate player.

**`GET /matches/:id`** — Read-only hydration endpoint for refresh/reconnect.

- Headers: `X-Client-Id`
- Returns: `{ matchId, playerId, state }`
- Only returns data if the caller is already associated with the match (verified via `clientId`).
- Idempotent (read-only).

### 9.2 Join Code Rules

- Join codes expire **30 minutes** after creation, permanently. An expired code cannot be reused or refreshed.
- A join code is rejected if the match already has two players, or if the match is in any state other than Lobby.
- Navigating to an invalid or expired join link displays an appropriate error message (e.g., "This invite has expired" or "This match is full") and redirects the user to the home page.

### 9.3 REST Validation Errors

- `JOIN_CODE_EXPIRED` — Join code has passed its 30-minute TTL
- `JOIN_CODE_INVALID` — Join code does not match any active match
- `MATCH_NOT_FOUND` — No match exists with the given ID
- `MATCH_FULL` — Match already has two players
- `MATCH_NOT_JOINABLE` — Match is not in Lobby state
- `CLIENT_CONFLICT` — Client already associated with a different player in this match

### 9.4 WebSocket Message Envelope

**Client → Server:**

```
{ type, matchId, clientId, eventId, payload }
```

**Server → Client:**

```
{ type, matchId, payload }
```

`eventId` is a client-generated UUID used for idempotency of intent events. The server may reject intents and respond with an error without mutating state.

### 9.5 Client → Server Intents

| Event | Payload | Notes |
|---|---|---|
| `SYNC_STATE` | — | Sent on connect/reconnect to request current state |
| `SET_READY` | `{ ready: boolean }` | Toggle ready state in lobby |
| `START_MATCH` | — | Host-only; requires both players present and ready |
| `MARK_CELL` | `{ cellIndex: number }` | Mark an unmarked cell |
| `UNMARK_CELL` | `{ cellIndex: number }` | Unmark a cell (ownership enforced server-side) |
| `RESHUFFLE_BOARD` | — | Host-only; only allowed if no cells are marked. Generates new seed, resets timer. |
| `BACK_TO_LOBBY` | — | Host-only; allowed from InProgress or Completed. Resets marks, timer, and ready states. |
| `REMATCH` | — | Host-only; only from Completed state. Generates new seed and board, resets marks and timer. |

### 9.6 Server → Client Messages

| Event | Payload | Routing | Notes |
|---|---|---|---|
| `STATE_SYNC` | `{ state }` | Single-recipient | Response to `SYNC_STATE` (hydration) |
| `STATE_UPDATE` | `{ state, lastAppliedEventId? }` | Broadcast | Sent to both players after accepted intents |
| `ERROR` | `{ code, message, rejectedEventId? }` | Broadcast | Validation failures and rejections |
| `MATCH_STARTED` | — | Broadcast | Convenience notification on match start |
| `MATCH_COMPLETED` | `{ reason, winnerId? }` | Broadcast | Includes win reason: `line`, `majority`, `timer_expiry`, or `draw` |
| `PRESENCE_UPDATE` | `{ players: [...] }` | Broadcast | Required. Sent on join, leave, disconnect, and reconnect. |

State-mutating intents: `SET_READY`, `START_MATCH`, `MARK_CELL`, `UNMARK_CELL`, `RESHUFFLE_BOARD`, `BACK_TO_LOBBY`, `REMATCH`.

For MVP, every server update includes the full authoritative `MatchState` snapshot. Optimization to diff/patch can be deferred.

---

## 10. Persistence Model

### 10.1 Database Schema

Goal: persist enough to recover from server restarts and support reconnect + match completion, while keeping the schema minimal.

**`matches`**

| Column | Type | Notes |
|---|---|---|
| `match_id` | UUID | Primary key |
| `status` | text/enum | `Lobby`, `InProgress`, `Completed`, `Abandoned` |
| `seed` | int/bigint | Board generation seed |
| `join_code` | text | Short join code, nullable after expiry |
| `join_code_expires_at` | timestamp | 30 minutes after creation |
| `timer_mode` | text/enum | `stopwatch` or `countdown` |
| `countdown_duration_ms` | int | Nullable; set only in countdown mode |
| `state_json` | JSONB | Authoritative MatchState snapshot |
| `created_at` | timestamp | |
| `started_at` | timestamp | Nullable |
| `ended_at` | timestamp | Nullable |
| `abandoned_at` | timestamp | Nullable; set when entering Abandoned. Destruction at `abandoned_at + 10 min`. |

**`match_players`**

| Column | Type | Notes |
|---|---|---|
| `match_id` | UUID | FK → matches |
| `player_id` | UUID | Primary key |
| `client_id` | UUID | From ClientSession/localStorage |
| `slot` | smallint | 1 (host) or 2 (guest) |
| `alias` | text | Optional display name |
| `connected` | boolean | Current connection status |
| `last_seen_at` | timestamp | |

**`match_events`** (append-only, debugging/auditing)

| Column | Type | Notes |
|---|---|---|
| `match_id` | UUID | FK → matches |
| `seq` | bigint | Server-assigned, monotonically increasing per match |
| `event_id` | UUID | Client-provided idempotency key |
| `type` | text | Event type |
| `payload_json` | JSONB | Event payload |
| `player_id` | UUID | Nullable |
| `client_id` | UUID | Nullable |
| `created_at` | timestamp | |

### 10.2 Required Indexes

| Index | Constraint | Purpose |
|---|---|---|
| `match_events (match_id, seq)` | UNIQUE | Canonical event ordering |
| `match_events (match_id, event_id)` | UNIQUE | At-most-once event processing |
| `match_players (match_id, slot)` | UNIQUE | Prevents third player |
| `match_players (match_id, client_id)` | UNIQUE | Prevents duplicate joins from same client |
| `matches (join_code)` | UNIQUE (where not null) | Fast join code lookup |

### 10.3 Crash Recovery

On server restart, load `matches.state_json` for any active matches (Lobby or InProgress). When a client connects or reconnects, the server resolves `(match_id, client_id)` → `player_id` via `match_players`, then sends a `STATE_SYNC` containing the authoritative snapshot. Abandoned matches past their 10-minute timeout are cleaned up on restart.

---

## 11. Testing Strategy

### 11.1 Engine Unit Tests (Highest ROI)

Target the pure match engine functions: `applyEvent`, `validateEvent`, `checkWin`.

**Invariants to test:**

- For each event type: valid event produces expected new state, invalid event is rejected, no unintended side effects on unrelated state.
- Duplicate `eventId` must not double-apply; out-of-phase events (e.g., `MARK_CELL` before start) must be rejected.
- Mark ownership: only the player who marked a cell can unmark it.
- Host-only events (`START_MATCH`, `RESHUFFLE_BOARD`, `BACK_TO_LOBBY`, `REMATCH`) must be rejected when sent by the guest.
- `BACK_TO_LOBBY` must be rejected from Lobby or Abandoned states.
- Reshuffle must be rejected if any cells are marked.

**Win detection edge cases:**

- A completed line where cells are owned by different players must **not** count as a win.
- Majority win triggers at exactly 13 cells for one player on a 5×5 board.
- Timer expiry with equal marks results in a draw, not a win.
- Win is checked only after accepted events and only when the match is InProgress.
- A single mark event that triggers both line and majority reports line as the win reason.

### 11.2 Integration Tests (Minimal but Valuable)

**REST contract validation:**

- Create match, join match, hydrate match (GET).
- Validate expected error responses: match full, invalid/expired join code, not joinable.
- Verify `X-Client-Id` header is required and validated.

**WebSocket event flow:**

- Connect + `SYNC_STATE` → `STATE_SYNC` response.
- Two clients: mark/unmark → broadcast `STATE_UPDATE`.
- Reject invalid intents; verify `ERROR` is single-recipient.
- `PRESENCE_UPDATE` is broadcast on connect/disconnect.

### 11.3 Frontend Tests (Lightweight)

**Component rendering:**

- Render Lobby, InProgress, and Completed screens from provided `MatchState` snapshots.

**User interaction flows:**

- Join → ready → start → mark/unmark → win → results → rematch.

### 11.4 Intentionally Not Tested for MVP

- Stress/load testing and deep performance optimization.
- Cross-browser UI polish testing beyond basic sanity checks.

---

## 12. Deployment Model

### 12.1 Render Configuration

| Service | Type | Notes |
|---|---|---|
| Angular SPA | Static Site | SPA rewrites enabled |
| Node API | Web Service | Serves HTTP + WebSocket |
| Postgres | Managed DB | Render-managed instance |

### 12.2 Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Render Postgres connection string |
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | Yes | Provided by Render |
| `CLIENT_ORIGIN` | Yes | For CORS and WebSocket origin validation |
| `LOG_LEVEL` | No | Optional logging verbosity |
| `RULESET_VERSION` | No | Optional versioning for goal pools |

### 12.3 Frontend API URL

Angular's build-time environment configuration (`environment.ts`) defines the API base URL, with separate values for dev and production builds.

### 12.4 Database Migrations

Use a migration tool (e.g., node-pg-migrate or Knex). Migrations run during deployment/startup in a controlled manner before the server begins accepting traffic.

---

## 13. Risks & Tradeoffs

**Biggest technical risk:** Reconnect correctness — ensuring both clients converge on the same authoritative snapshot and preventing duplicate event application.

**First bottleneck under scale:** A single Node instance handling all WebSocket connections. Horizontal scaling would require sticky sessions and/or a shared pub-sub layer. This is acceptable for MVP (1v1 matches with a small user base).

**Deliberate simplifications:**

- No authentication or account system.
- Full-state snapshots sent over WebSocket instead of diff/patch updates.
- Single-region, single-instance deployment.

---

## 14. Future Extensions (Post-MVP)

These are ideas for after the MVP ships. They are not in scope and should not influence MVP architecture decisions unless the cost is trivial.

- User accounts and saved match history
- Spectator mode
- Custom goal pools / rulesets per match
- Diff/patch state updates instead of full snapshots
- Multi-region deployment
- Host transfer on disconnect

**Architectural decisions that protect future expansion:**

- Pure match engine with explicit event contracts allows new features without rewriting core logic.
- Persisted snapshots + event log enable replay and history features later.

---

## 15. Development Plan Summary

### Prerequisites Before UI Work

Match lifecycle state machine, event contracts, and engine unit tests must be complete before building the UI.

### Parallelizable Work

Angular UI components (rendering from mocked `MatchState`) can be developed in parallel with backend engine logic and tests.

### Scope Cut Fallback Plan

If time runs short, cut in this order:

1. Countdown timer mode (keep stopwatch only)
2. Majority and win-by-time win conditions (keep line completion only)
3. Reshuffle during active match
