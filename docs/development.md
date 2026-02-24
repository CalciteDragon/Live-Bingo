# Development Guide

## Prerequisites

- **Node.js** v20+ (check `.nvmrc` or `engines` field if present)
- **npm** v10+ (comes with Node 20)
- A running **Postgres** instance for `apps/api` (see Environment Variables below)

---

## Install

```bash
npm install
```

This installs all workspace dependencies in one pass.

---

## Build

```bash
# Build all workspaces in dependency order (tsc --build from root)
npm run build

# Build + run all tests in one command (used in CI)
npm run ci

# Build a single workspace
npm run build --workspace=apps/api
npm run build --workspace=packages/engine
npm run build --workspace=packages/shared
```

> **Note:** `packages/shared` must be built before `apps/api` or `packages/engine` if you are not using `npm run build` from the root (which handles dependency order automatically).

---

## Test

```bash
# Run all workspace tests
npm test

# Run tests for a single workspace
npm run test --workspace=apps/api
npm run test --workspace=packages/engine
```

---

## Dev Servers

```bash
# API server with live reload (tsx watch)
npm run dev:api

# Angular dev server (once apps/web is scaffolded)
npm run dev:web
```

---

## Database Migrations

```bash
# Run migrations (apps/api workspace)
npm run migrate --workspace=apps/api
```

Migrations must be run before the API server will start successfully against a fresh database.

---

## Environment Variables

Create a `.env` file in `apps/api/` (never commit it). Required variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (e.g., `postgresql://user:pass@host:5432/db`) |
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | Yes | Port the API server listens on (Render provides this automatically) |
| `CLIENT_ORIGIN` | Yes | Allowed origin for CORS and WebSocket origin validation (e.g., `http://localhost:4200`) |
| `LOG_LEVEL` | No | Logging verbosity (e.g., `debug`, `info`, `warn`) |
| `RULESET_VERSION` | No | Optional versioning for goal pools |
