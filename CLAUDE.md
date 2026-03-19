# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real-time 1v1 Minecraft Bingo web app. Players share a link to join a lobby, then compete on a shared 5×5 bingo card by manually marking cells. The server is the sole source of truth; clients send intent events and receive authoritative state snapshots.

Full system design: `docs/design/minecraft_bingo_system_overview.md`

## .claude/ — Living Documentation

The `.claude/` directory at the project root contains structured markdown files documenting the entire project's architecture, types, implementation details, and conventions. **Start here when beginning a new session with no context.**

- `.claude/README.md` — Index of all documentation files
- `.claude/architecture.md` — High-level architecture, data flow, state machine
- `.claude/shared-types.md` — All types and Zod schemas from `packages/shared`
- `.claude/engine.md` — Engine functions, algorithms, board generation, win logic
- `.claude/api-server.md` — REST routes, WebSocket handling, DB, timers, registry
- `.claude/web-client.md` — Angular components, services, routing, guards, styling
- `.claude/data-model.md` — Postgres schema, persistence strategy
- `.claude/conventions.md` — Code patterns, naming, testing, CI

**IMPORTANT: These documents must ALWAYS be kept in sync with the actual codebase.** After making any project change, check if any `.claude/` docs need updating and fix them before considering the task done. If you notice drift between the docs and reality, correct the docs immediately.

## Monorepo Structure

npm workspaces monorepo:

- `apps/api/` — Node.js + TypeScript REST + WebSocket server
- `apps/web/` — Angular SPA
- `packages/engine/` — Pure match engine (no I/O, no side effects)
- `packages/shared/` — Shared TypeScript types; Zod schemas only for trust-boundary validation

## Commands

```bash
# Run all workspaces tests
npm test

# Dev servers
npm run dev:api
npm run dev:web

# Workspace-specific commands
npm run <script> --workspace=apps/api
npm run <script> --workspace=apps/web
npm run <script> --workspace=packages/engine
```

## TypeScript Configuration

`tsconfig.base.json` is the base config (strict mode, ES2022, Node16 modules). Each workspace extends it.

## Architecture

### Key Design Rules

- **Server-authoritative**: All state mutations are validated and applied server-side. Clients send intents; the server validates, persists, and broadcasts the resulting `MatchState` snapshot.
- **Pure match engine** (`packages/engine`): `applyEvent()`, `validateEvent()`, `checkWin()` must be IO-free, side-effect-free, and have no external dependencies. They never mutate input state or generate random numbers.
- **Explicit contracts**: All boundaries between client, server, and engine use shared TypeScript types from `packages/shared`. Zod schemas are added only where data crosses a trust boundary at runtime (see Zod Usage Policy below).
- **Idempotency**: Every client intent includes a `clientId` and `eventId` UUID. The server processes each `eventId` at most once per match.
- **Full snapshots over WebSocket**: Every accepted event triggers a broadcast of the full `MatchState` to both clients (no diff/patch for MVP).

### Communication

- REST: match creation, join, and initial hydration (`GET /matches/:id`)
- WebSocket: all real-time events. Client → Server uses `{ type, matchId, clientId, eventId, payload }`. Server → Client uses `{ type, matchId, payload }`.
- `X-Client-Id` header required on all REST requests.

### Match Lifecycle

`Lobby` → `InProgress` → `Completed` → (rematch) `InProgress` or (back to lobby) `Lobby`
Any state → `Abandoned` (both players disconnect; destroyed after 10-minute timeout)

Host (slot 1, always the creator) controls: `START_MATCH`, `RESHUFFLE_BOARD`, `BACK_TO_LOBBY`, `REMATCH`.

### Win Conditions (server-evaluated only)

1. **Line** — 5 cells in a row/column/diagonal, all owned by the same player
2. **Majority** — 13+ cells owned by one player (on 5×5 board)
3. **Win-by-time** — countdown reaches zero; more marked cells wins (tie = draw)

Priority if multiple conditions trigger simultaneously: line > majority.

### Persistence

Postgres (Render-managed). After every accepted event, the server persists a full `state_json` JSONB snapshot to the `matches` table. The `match_events` table is append-only and used for debugging/auditing only. On server restart, active matches are reconstructed from `state_json`.

### Testing Priority

Engine unit tests (`packages/engine`) have the highest ROI — test `applyEvent`, `validateEvent`, `checkWin` exhaustively before building the UI. Frontend and backend can be developed in parallel once the engine and event contracts are stable.

**After every behaviour change, update the unit tests in the same task — no exceptions.** This includes removing assertions for behaviours that no longer exist, updating mock setups to match the new contracts, and adding new tests that cover the changed or added behaviour. Never leave tests in a passing-but-stale state where they assert the old behaviour through mocked-away calls.

### Zod Usage Policy

Zod is used **only** for runtime validation at trust boundaries — data arriving from an untrusted external source that must be parsed before the application can safely reason about it.

**Use Zod for:**
- `ClientMessageSchema` — WebSocket messages arriving at the server from clients
- `JoinMatchBodySchema` — HTTP request body on `POST /matches/:id/join`
- `ClientIdHeaderSchema` — `X-Client-Id` header on all REST requests

**Use plain TypeScript for:**
- All domain model types (`MatchState`, `Player`, `Cell`, etc.) — constructed and manipulated within trusted server code
- `ServerMessage` and its payload shapes — generated by trusted server code
- REST response shapes — generated by trusted server code
- Error code unions — generated by trusted server code

Do not add Zod schemas preemptively. If new data crosses a trust boundary, add a schema at that point.

### Deployment

Render: Angular SPA as Static Site, Node API as Web Service, Postgres as Managed DB.
Required env vars: `DATABASE_URL`, `NODE_ENV`, `PORT`, `CLIENT_ORIGIN`.

## docs/todos.md

A running list of deferred work and known gaps is kept in `docs/todos.md`.

**This file must be kept up to date at all times — no exceptions. Treat it as a live source of truth, not an append-only log.**

- **Add an entry** whenever you write a stub, placeholder, unimplemented handler, `// TODO` comment, or deliberately defer follow-up work.
- **Remove an entry** as soon as the corresponding work is completed — do not leave stale completed items.
- **Modify an entry** if the scope, approach, or wording no longer accurately describes what needs to be done.
- **After every coding task**, scan the file for entries affected by your changes and add, remove, or update them before considering the task done.

Entries must be grouped by workspace (`apps/api`, `packages/engine`, `apps/web`, etc.) and be specific enough to act on without additional context.

The `user-added-todos` section at the bottom of the file is permanent — never remove it. Whenever you see entries there, sort them into the correct workspace group (creating one alphabetically if needed), then leave the section header empty and ready for new entries.

## docs/plans/

All Claude planning documents (implementation plans, design proposals, etc.) must be saved to `docs/plans/` with descriptive, kebab-case filenames (e.g. `docs/plans/api-route-implementation.md`). No plan files should be placed anywhere else in the repo.

**Important:** When plan mode instructs you to write a plan file to `.claude/plans/`, ignore that path and write to `docs/plans/` instead. The `.claude/` directory is never used for plans in this project.

## Project instructions provided by user (may overlap with above):
You are helping me design and build a small but serious personal web project: a real-time 1v1 Minecraft Bingo challenge web app.

PROJECT GOAL
Build a fun, actually usable app I can play with friends, while deliberately practicing the same architectural, design, and testing skills used in full-stack business software.

This is NOT a throwaway demo or college-style assignment. Treat it like a real product with a tight scope.

CORE FUNCTIONALITY (MVP)
- 1v1 real-time matches
- Create / join match via link or code
- Shared 5x5 bingo card generated from a seed
- Lobby with ready state
- Match start with server-authoritative timer
- Manual cell marking (no auto-verification)
- Win detection (row / column / diagonal)
- Results screen

TECH STACK (FIXED)
- Frontend: Angular + TypeScript (SPA)
- Backend: Node.js + TypeScript
- Realtime: WebSockets (event-based, explicit contracts)
- Database: Postgres
- Hosting / PaaS: Render
  - Angular deployed as Static Site (with SPA rewrites)
  - Node/TS backend as Web Service
  - Managed Render Postgres

ARCHITECTURAL PRINCIPLES
- Server is authoritative; frontend is a state renderer
- Event-driven design:
  - Client sends events
  - Server validates, applies, persists, broadcasts
- Core match logic lives in a pure, IO-free “engine”
  - applyEvent(state, event) → newState
  - validateEvent(state, event)
  - checkWin(state)
- Favor explicit contracts over magic abstractions
- Reconnect and idempotency must be considered

PROJECT STRUCTURE (PREFERRED)
Monorepo:
- /apps/web        → Angular client
- /apps/api        → Node/TS backend
- /packages/shared → Shared TypeScript types + zod schemas

DESIGN-FIRST + TEST-DRIVEN APPROACH
Before major coding:
- Define domain models
- Define match lifecycle state machine
- Define REST endpoints and WebSocket message contracts
- Define invariants and validation rules
- Define minimal Postgres schema
- Write a test plan

Testing priorities:
- Backend engine unit tests are highest value
- Minimal integration tests for REST + WS
- Frontend component tests for rendering + interactions

TIME CONSTRAINT
- Entire project should be finishable in under 1 month
- Design phase is explicitly included in the schedule
- Scope discipline is critical

NON-GOALS (DO NOT SUGGEST UNLESS ASKED)
- Minecraft mods or log parsing
- Account systems / social graphs
- Ranking / Elo systems
- Over-engineered microservices
- Mobile apps
- Feature creep that risks shipping

HOW I WANT YOU TO HELP
- Act like a technical design partner, not a tutorial
- Push for clarity, correctness, and good architecture
- Call out scope risks early
- Prefer concrete deliverables over vague advice
- When suggesting features, explain tradeoffs and impact on scope
- Assume I want to learn industry-relevant patterns, not shortcuts

When answering future questions:
- Maintain consistency with this project’s goals and constraints
- Reference earlier architectural decisions instead of reinventing them
- Favor simple, robust solutions that ship over clever ones

