# .claude/ — Living Documentation

This directory contains structured documentation of the entire project, maintained to accelerate future Claude Code sessions starting with no context.

**IMPORTANT**: These documents must ALWAYS be updated to reflect the actual project structure whenever changes are made. If you notice any drift between these docs and the codebase, fix the docs immediately.

## Document Index

| File | Purpose |
|---|---|
| [architecture.md](architecture.md) | High-level architecture, data flow, state machine, design decisions |
| [shared-types.md](shared-types.md) | All types, Zod schemas, and contracts from `packages/shared` |
| [engine.md](engine.md) | Pure engine functions, algorithms, win logic, board generation |
| [api-server.md](api-server.md) | REST routes, WebSocket handling, DB layer, timers, match registry |
| [web-client.md](web-client.md) | Angular app: components, services, routing, guards, styling |
| [data-model.md](data-model.md) | Postgres schema, MatchState shape, persistence strategy |
| [conventions.md](conventions.md) | Code patterns, naming, testing, file organization, CI |

## How to Use

- **Starting a new session?** Read `architecture.md` first for the big picture, then the workspace-specific doc for whatever you're working on.
- **Modifying shared types?** Update `shared-types.md`.
- **Adding a route or WS handler?** Update `api-server.md`.
- **Adding/changing a component?** Update `web-client.md`.
- **Changing DB schema?** Update `data-model.md`.
- **Changing engine logic?** Update `engine.md`.
