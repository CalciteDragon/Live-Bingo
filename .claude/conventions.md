# Code Conventions & Patterns

## TypeScript

- Base config: `tsconfig.base.json` — strict mode, ES2022 target, Node16 modules
- Each workspace extends base config
- Workspace aliases: `@bingo/shared`, `@bingo/engine` (configured in respective `package.json` files)
- Import extensions: `.js` in all imports (Node16 module resolution)

## File Naming

- Source files: lowercase with hyphens (e.g., `match-registry.ts`, `client-id.service.ts`)
- Angular components: `component-name.ts` (NOT `component-name.component.ts` — uses the newer Angular convention)
- Test files:
  - Engine/API: `__tests__/filename.test.ts`
  - Angular: co-located `filename.spec.ts`
- Plans: `docs/plans/kebab-case-name.md`

## Angular Patterns

- Standalone components throughout (no NgModules)
- Signal-based state management (no RxJS stores)
- Lazy-loaded routes
- Functional interceptors and guards (not class-based)
- Single global stylesheet (`styles.scss`) — no component-level styles
- Template syntax: `@if`, `@for` (Angular 17+ control flow)
- Input/output: `input.required<T>()`, `output<T>()` (signal-based)

## State Management

- `SessionStoreService` holds all client-side session state as Angular signals
- WebSocket messages update `matchState` signal
- Components derive computed signals from `matchState`
- No external state management library

## Testing

- Engine tests: **highest priority** — exhaustive coverage of validateEvent, applyEvent, checkWin
- API tests: route handlers + WS handlers (mocked DB)
- Web tests: component specs (Karma)
- Test runners: vitest (engine, API), Karma (Angular)
- **Rule**: After every behavior change, update tests in the same task

## Error Handling

- Engine: throws `EngineError` with `WsErrorCode`
- API REST: returns JSON `{ code: RestErrorCode, message: string }`
- API WS: sends `{ type: 'ERROR', payload: { code: WsErrorCode, message, rejectedEventId? } }`
- Client: `MatchApiService.mapError()` normalizes HTTP errors to `ApiError`

## Zod Policy

Zod ONLY at trust boundaries:
- `ClientMessageSchema` — WebSocket messages from clients
- `CreateMatchBodySchema` / `JoinMatchBodySchema` — REST request bodies
- `ClientIdHeaderSchema` — X-Client-Id header

Everything else is plain TypeScript types.

## CI Pipeline (.github/workflows/ci.yml)

4 parallel jobs:
1. `test-engine` — `npm run test --workspace=packages/engine`
2. `test-api` — `npm run test --workspace=apps/api`
3. `lint` — `npm run lint` (ESLint)
4. `build-web` — `npm run test --workspace=apps/web` + `npm run build --workspace=apps/web`

All use Node 24, npm ci.

## Local CI

`npm run ci` — builds + runs all tests with pass/fail banner.

## Scripts (root package.json)

- `npm run build` — `tsc --build`
- `npm run dev` — concurrently runs api + web dev servers
- `npm run dev:api` / `npm run dev:web` — individual dev servers
- `npm test` — runs tests across all workspaces
- `npm run lint` — ESLint
- `npm run ci` — build + test with colored output

## docs/todos.md

- Live source of truth for deferred work
- Grouped by workspace
- Must be updated after every coding task
- `user-added-todos` section at bottom is permanent; entries get sorted into workspace sections

## docs/plans/

- All planning documents go here (never `.claude/plans/`)
- Kebab-case filenames

## Player Slot Colors

Consistent across all UI:
- Slot 1: `#4a9eff` (blue)
- Slot 2: `#ff6b6b` (red)
- Slot 3: `#51cf66` (green)
- Slot 4: `#fcc419` (yellow)

## WebSocket URL Format

`ws[s]://<host>/ws?matchId=<uuid>&clientId=<uuid>`

Dev: Angular proxy handles this via `proxy.config.json`
Prod: direct connection to `wss://live-bingo-w7ua.onrender.com`
