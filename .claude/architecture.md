# Architecture Overview

## Monorepo Layout

```
Live-Bingo/
├── apps/
│   ├── api/          Node.js + TypeScript REST + WebSocket server
│   └── web/          Angular SPA
├── packages/
│   ├── engine/       Pure match engine (no I/O, no side effects)
│   └── shared/       Shared TypeScript types + Zod schemas
├── docs/
│   ├── design/       System design doc
│   ├── plans/        All Claude planning documents (kebab-case .md)
│   └── todos.md      Running TODO list (live source of truth)
├── .claude/          THIS directory — living documentation
├── .github/workflows/ci.yml
├── CLAUDE.md         Project instructions for Claude Code
├── package.json      Root workspace config
└── tsconfig.base.json
```

npm workspaces: `apps/*` and `packages/*`. Workspace aliases: `@bingo/shared`, `@bingo/engine`.

## Data Flow

```
Client (Angular SPA)
  │
  ├── REST (create/join/hydrate)  →  Express routes  →  Postgres
  │                                                       ↕
  └── WebSocket (real-time)       →  WS handler      →  Match Registry (in-memory)
                                       │
                                       ├── Parse & validate (Zod)
                                       ├── Envelope check (matchId/clientId)
                                       ├── Deduplication (DB lookup)
                                       ├── Engine validation (validateEvent)
                                       ├── Engine apply (applyEvent + checkWin)
                                       ├── Persist (DB transaction)
                                       ├── Commit to registry
                                       ├── Broadcast STATE_UPDATE
                                       ├── Lifecycle broadcasts (MATCH_STARTED, MATCH_COMPLETED)
                                       └── Timer reconciliation
```

## Key Design Principles

1. **Server-authoritative**: All state mutations validated+applied server-side. Clients send intents, receive MatchState snapshots.
2. **Pure engine**: `validateEvent()`, `applyEvent()`, `checkWin()` are IO-free, side-effect-free, never mutate input state.
3. **Explicit contracts**: All boundaries use shared TypeScript types from `@bingo/shared`. Zod only at trust boundaries.
4. **Idempotency**: Every client intent includes `clientId` + `eventId` UUID. Server processes each eventId at most once.
5. **Full snapshots**: Every accepted event broadcasts the full MatchState (no diff/patch for MVP).

## Match Lifecycle State Machine

```
Lobby → InProgress → Completed → InProgress (rematch)
                                → Lobby (back to lobby)
Any state → Abandoned (all players disconnect; 10-min timeout)
```

- **Host** (slot 1, always creator) controls: START_MATCH, RESHUFFLE_BOARD, BACK_TO_LOBBY, REMATCH, SET_LOBBY_SETTINGS, KICK_PLAYER
- **Any player**: SET_READY, MARK_CELL, UNMARK_CELL, SYNC_STATE

## Match Mode

Currently only `'ffa'` (free-for-all) mode is implemented. Up to 4 players (Slot 1-4). The `resolveOwnerGroup()` function in the engine is the single extension point for future team-based ownership.

## Win Conditions (server-evaluated only)

1. **Line** — 5 cells in a row/column/diagonal, all owned by same player. Priority: highest.
2. **Majority** — remaining blank cells < leader's lead over 2nd place (mathematically uncatchable).
3. **Win-by-time** — countdown reaches zero; most cells wins (tie = draw).

Priority if simultaneous: line > majority.

## Communication Protocols

### REST
- `POST /matches` — create match (returns matchId, joinCode, joinUrl, state)
- `POST /matches/:id/join` — join match (returns matchId, playerId, state)
- `GET /matches/by-code/:code` — resolve join code to matchId
- `GET /matches/:id` — initial state hydration (returns matchId, playerId, state)
- All REST requests require `X-Client-Id` header (UUID)

### WebSocket
- Upgrade: `ws://<host>/ws?matchId=<uuid>&clientId=<uuid>`
- Client → Server: `{ type, matchId, clientId, eventId, payload }`
- Server → Client: `{ type, matchId, payload }`
- Server message types: STATE_SYNC, STATE_UPDATE, ERROR, MATCH_STARTED, MATCH_COMPLETED, PRESENCE_UPDATE

## Persistence Strategy

- **Postgres** stores `state_json` JSONB snapshot in `matches` table after every accepted event
- **match_events** table is append-only audit log (debugging only)
- **In-memory registry** is the primary runtime state; DB is backup for server restarts
- On startup, active matches hydrated from DB `state_json`, abandon timers started for all

## Environment

- Dev: `npm run dev` (concurrently runs api + web)
- Angular dev proxy forwards `/matches` and `/ws` to `localhost:3000`
- Prod env vars: `DATABASE_URL`, `NODE_ENV`, `PORT`, `CLIENT_ORIGIN`
- Deployment: Render (Angular as Static Site, Node API as Web Service, managed Postgres)
