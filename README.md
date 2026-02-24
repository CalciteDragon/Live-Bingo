# Minecraft Bingo 1v1

Real-time 1v1 Minecraft Bingo web app. Players share a link to join a private lobby, then compete on a shared 5×5 bingo card by manually marking cells. The server is the sole source of truth.

**Tech stack:** Angular SPA · Node.js + TypeScript · WebSockets · Postgres · Deployed on Render

## MVP Features

- Create / join a match via shareable link or short code
- Shared 5×5 bingo card generated from a seed
- Lobby with per-player ready state and configurable timer
- Manual cell marking with server-enforced ownership
- Win detection: line, majority, and win-by-time
- Results screen with rematch option

## Quick Start

```bash
# Install all workspace dependencies
npm install

# Build all workspaces (required before first run)
npm run build

# Run all tests
npm test

# Build + test in one command (CI)
npm run ci

# Dev servers
npm run dev:api   # API with live reload
npm run dev:web   # Angular dev server

# Database migrations (apps/api)
npm run migrate --workspace=apps/api
```

## Documentation

- [System Design](docs/design/minecraft_bingo_system_overview.md) — domain model, lifecycle, API contracts, persistence, testing strategy
- [Development Guide](docs/development.md) — build commands, env vars, prerequisites
- [TODOs](docs/todos.md) — deferred work and known gaps
