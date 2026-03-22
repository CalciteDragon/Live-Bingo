# Fix: Join Code Hydration via GET /matches/:id

## Problem

The join code is lost in any reconnect or refresh scenario because:

1. `GET /matches/:id` (the session guard's hydration endpoint) never returns the join code.
2. The session guard's only fallback is the 5-minute persisted localStorage session — which expires during a normal match.
3. Once both are gone, the client has no recovery path.

## Design

### What changes

Add `joinCode: string | null` to `GetMatchResponse`. The server always fetches `join_code` from the DB on this route and returns it alongside state. The session guard sets the join code signal directly from the response instead of relying on the persisted session.

### Why `string | null` (not `string`)

The code may be expired (30-minute creation-time window). An expired code is useless to show in the lobby — sharing it would mislead the second player. Return `null` if `join_code IS NULL` or `join_code_expires_at < NOW()`.

### Why always query the DB (even on registry hit)

The in-memory match registry stores only `MatchState` and sockets — it has no `join_code`. On a registry hit the current code skips the DB entirely, making the join code unrecoverable without a dedicated second query. The fix is to always include `join_code` in the DB fetch, treating the registry as the state source and the DB as the join-code source.

This adds one lightweight `SELECT` per hydration request (a cold path, not a hot WebSocket path), so the performance impact is negligible.

### What does NOT change

- `MatchState` does not gain a `joinCode` field — it remains an access-control concern, not game state.
- No Zod schema changes — `GET /matches/:id` is a server-generated response, not a trust boundary.
- Session guard still keeps `getPersistedSession()` for the `route` redirect field — only the `joinCode` sourcing changes.
- The 5-minute session TTL is intentionally preserved.

---

## Implementation Steps

### Step 1 — `packages/shared/src/rest.ts`

Add `joinCode` to `GetMatchResponse`:

```ts
export interface GetMatchResponse {
  matchId: string;
  playerId: string;
  state: MatchState;
  joinCode: string | null;   // null if expired or no code on record
}
```

---

### Step 2 — `apps/api/src/routes/index.ts` (`GET /matches/:id`)

**Current behaviour:** Two branching code paths — registry hit skips DB entirely; DB fallback selects only `state_json`.

**New behaviour:** Always query `SELECT state_json, join_code, join_code_expires_at FROM matches`. Use registry state if available (fresher), DB state otherwise. Return `joinCode` as null if expired.

Replace the current handler body (lines 190–219) with:

```ts
matchRouter.get('/:id', async (req, res) => {
  const clientId = res.locals['clientId'] as string;
  const matchId  = req.params['id'] as string;

  // Always fetch from DB so we can return join_code alongside state.
  // Registry state is preferred (fresher) but join_code is DB-only.
  const { rows } = await db.query<{
    state_json: MatchState;
    join_code: string | null;
    join_code_expires_at: Date | null;
  }>(
    'SELECT state_json, join_code, join_code_expires_at FROM matches WHERE match_id = $1',
    [matchId],
  );

  if (rows.length === 0) {
    res.status(404).json({ code: 'MATCH_NOT_FOUND', message: 'Match not found' });
    return;
  }

  const entry = getMatch(matchId);
  const state  = entry?.state ?? rows[0].state_json;

  const player = state.players.find((p) => p.clientId === clientId);
  if (!player) {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Not a participant in this match' });
    return;
  }

  const { join_code, join_code_expires_at } = rows[0];
  const joinCode =
    join_code && join_code_expires_at && join_code_expires_at > new Date()
      ? join_code
      : null;

  const response: GetMatchResponse = { matchId, playerId: player.playerId, state, joinCode };
  res.status(200).json(response);
});
```

---

### Step 3 — `apps/web/src/app/core/session.guard.ts`

**Current behaviour:** After `getMatch()` resolves, the guard reads `joinCode` from the persisted localStorage session (if not expired).

**New behaviour:** Set `joinCode` directly from the API response — always authoritative. The persisted session continues to be read for its `route` field if that is used elsewhere, but `joinCode` is no longer sourced from it in this guard.

Replace lines 43–44:

```ts
// Before:
const persisted = sessionStore.getPersistedSession();
if (persisted?.joinCode) sessionStore.joinCode.set(persisted.joinCode);

// After:
sessionStore.joinCode.set(res.joinCode);
```

The full `map` callback becomes:

```ts
map(res => {
  sessionStore.matchId.set(res.matchId);
  sessionStore.playerId.set(res.playerId);
  sessionStore.matchState.set(res.state);
  sessionStore.joinCode.set(res.joinCode);
  socket.connect(matchId);
  return true as const;
}),
```

---

## File Change Summary

| File | Change |
|------|--------|
| `packages/shared/src/rest.ts` | Add `joinCode: string \| null` to `GetMatchResponse` |
| `apps/api/src/routes/index.ts` | Always query DB in `GET /:id`; compute and return `joinCode` |
| `apps/web/src/app/core/session.guard.ts` | Set `joinCode` from API response instead of persisted session |
| `apps/api/src/__tests__/routes.test.ts` | Update `GET /matches/:id` suite — fix mocks, update assertions, add new cases |
| `apps/web/src/app/core/session.guard.spec.ts` | Replace persisted-session joinCode tests with API-response tests |
| `.claude/shared-types.md` | Update `GetMatchResponse` docs |
| `.claude/api-server.md` | Update `GET /matches/:id` description |
| `.claude/web-client.md` | Update SessionGuard description |

---

## Testing

### `apps/api/src/__tests__/routes.test.ts` — `GET /matches/:id` suite

The route now **always** hits the DB, so every test in this suite must provide a `db.query` mock. The mock row shape also changes from `{ state_json }` to `{ state_json, join_code, join_code_expires_at }`.

#### Tests that need mock fixes

**"returns 200 with matchId, playerId, and state (from registry)"** (currently line 365)

The registry hit no longer skips the DB. Add a `db.query` mock returning a valid join code row, and assert `joinCode` is present in the response:

```ts
it('returns 200 with matchId, playerId, state, and joinCode (from registry)', async () => {
  const state = makeState();
  const futureExpiry = new Date(Date.now() + 30 * 60 * 1000);
  (getMatch as any).mockReturnValue({ state, sockets: new Map() });
  (db as any).query.mockResolvedValueOnce({
    rows: [{ state_json: state, join_code: 'ABC123', join_code_expires_at: futureExpiry }],
  });

  const res = await request(app)
    .get(`/matches/${MATCH_ID}`)
    .set('X-Client-Id', HOST_CLIENT_ID);

  expect(res.status).toBe(200);
  expect(res.body.matchId).toBe(MATCH_ID);
  expect(res.body.playerId).toBe(HOST_PLAYER_ID);
  expect(res.body.state).toBeDefined();
  expect(res.body.joinCode).toBe('ABC123');
});
```

**"returns 200 loading state from DB when not in registry"** (currently line 379)

Add `join_code` and `join_code_expires_at` to the mock row:

```ts
it('returns 200 loading state from DB when not in registry', async () => {
  const state = makeState();
  const futureExpiry = new Date(Date.now() + 30 * 60 * 1000);
  (getMatch as any).mockReturnValue(undefined);
  (db as any).query.mockResolvedValueOnce({
    rows: [{ state_json: state, join_code: 'XYZ789', join_code_expires_at: futureExpiry }],
  });

  const res = await request(app)
    .get(`/matches/${MATCH_ID}`)
    .set('X-Client-Id', HOST_CLIENT_ID);

  expect(res.status).toBe(200);
  expect(res.body.playerId).toBe(HOST_PLAYER_ID);
  expect(res.body.joinCode).toBe('XYZ789');
});
```

**"returns 403 when clientId is not a participant"** (currently line 404)

Currently has no `db.query` mock — the test would fail after the change because the route now always queries DB first. Add the mock (state is from registry, but DB is now queried too):

```ts
it('returns 403 when clientId is not a participant', async () => {
  const state = makeState();
  const futureExpiry = new Date(Date.now() + 30 * 60 * 1000);
  (getMatch as any).mockReturnValue({ state, sockets: new Map() });
  (db as any).query.mockResolvedValueOnce({
    rows: [{ state_json: state, join_code: 'ABC123', join_code_expires_at: futureExpiry }],
  });

  const res = await request(app)
    .get(`/matches/${MATCH_ID}`)
    .set('X-Client-Id', '00000000-0000-0000-0000-000000000099');

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('FORBIDDEN');
});
```

#### New tests to add

```ts
it('returns joinCode: null when join code is expired', async () => {
  const state = makeState();
  const pastExpiry = new Date(Date.now() - 1000);
  (getMatch as any).mockReturnValue(undefined);
  (db as any).query.mockResolvedValueOnce({
    rows: [{ state_json: state, join_code: 'OLD123', join_code_expires_at: pastExpiry }],
  });

  const res = await request(app)
    .get(`/matches/${MATCH_ID}`)
    .set('X-Client-Id', HOST_CLIENT_ID);

  expect(res.status).toBe(200);
  expect(res.body.joinCode).toBeNull();
});

it('returns joinCode: null when join_code is null in DB', async () => {
  const state = makeState();
  (getMatch as any).mockReturnValue(undefined);
  (db as any).query.mockResolvedValueOnce({
    rows: [{ state_json: state, join_code: null, join_code_expires_at: null }],
  });

  const res = await request(app)
    .get(`/matches/${MATCH_ID}`)
    .set('X-Client-Id', HOST_CLIENT_ID);

  expect(res.status).toBe(200);
  expect(res.body.joinCode).toBeNull();
});
```

The **404** and **400** (missing header) tests are unchanged — the 404 path returns before the participant check, and the 400 hits middleware before the handler.

---

### `apps/web/src/app/core/session.guard.spec.ts`

The guard no longer calls `getPersistedSession()` for `joinCode`. Two test cases assert the old behaviour and must be rewritten. All `getMatchReturn` mock values need `joinCode` added to match the new response shape.

#### `setupGuard` helper changes

- Remove `persistedJoinCode` option — no longer drives guard behaviour.
- All `getMatchReturn` values must include `joinCode: string | null`. Update the helper's type and all call sites.
- `mockGetPersistedSession` can be retained as a stub (the guard no longer calls it, but it's provided in the service mock — removing it is optional cleanup).

#### Tests to rewrite

**"restores joinCode from persisted session when present"** → **"sets joinCode from API response when present"**

```ts
it('sets joinCode from API response when present', () => {
  const state = makeState();
  const { joinCodeSignal } = setupGuard({
    getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state, joinCode: 'API123' }),
  });
  TestBed.runInInjectionContext(() =>
    (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
  );
  expect(joinCodeSignal()).toBe('API123');
});
```

**"does not set joinCode when persisted session has none"** → **"sets joinCode to null when API response returns null"**

```ts
it('sets joinCode to null when API response returns null', () => {
  const state = makeState();
  const { joinCodeSignal } = setupGuard({
    getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state, joinCode: null }),
  });
  TestBed.runInInjectionContext(() =>
    (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
  );
  expect(joinCodeSignal()).toBeNull();
});
```

#### All other hydration tests

Every other call in the `hydration` and `mismatched store` suites uses `of({ matchId: 'match-1', playerId: 'p1', state })` — add `joinCode: null` to each so the mock matches the updated response type and the guard's `.set(res.joinCode)` call receives a valid value.

---

## Documentation Updates

### `.claude/shared-types.md` — REST Schemas section (line 126)

```
# Before:
- `GetMatchResponse` — `{ matchId, playerId, state }`

# After:
- `GetMatchResponse` — `{ matchId, playerId, state, joinCode: string | null }`
```

### `.claude/api-server.md` — GET /matches/:id entry (lines 90–93)

```
# Before:
### GET /matches/:id — Hydrate state
- Prefers registry state over DB (more current)
- Validates caller is a participant (`clientId` match)
- Returns `GetMatchResponse`

# After:
### GET /matches/:id — Hydrate state
- Always queries DB for `join_code` and `join_code_expires_at` (not stored in registry)
- Prefers registry state over DB state_json (more current)
- Validates caller is a participant (`clientId` match)
- Returns `GetMatchResponse` including `joinCode: string | null` (null if expired or no code on record)
```

### `.claude/web-client.md` — SessionGuard entry (lines 80–84)

```
# Before:
### SessionGuard
- Ensures session store is populated before match routes
- If `matchId` already matches: reconnects socket if disconnected
- Otherwise: calls `GET /matches/:id` to hydrate, then connects socket
- On FORBIDDEN: redirects to home with `?error=forbidden`

# After:
### SessionGuard
- Ensures session store is populated before match routes
- If `matchId` already matches: reconnects socket if disconnected
- Otherwise: calls `GET /matches/:id` to hydrate, then connects socket
  - Sets `joinCode` signal directly from API response (authoritative; no persisted-session fallback)
- On FORBIDDEN: redirects to home with `?error=forbidden`
```

---

## Edge Cases Covered After Fix

| Scenario | Before | After |
|----------|--------|-------|
| Page refresh within 5 min of joining | Works (persisted session) | Works (API response) |
| Page refresh after 5 min | Code lost | Works (API response) |
| Direct navigation to `/lobby/:matchId` or `/match/:matchId` | Code lost | Works (API response) |
| BACK_TO_LOBBY after match (code not yet expired) | Works | Works (API response, returns live code) |
| BACK_TO_LOBBY after match (code expired) | Lost | Returns null — lobby shows `—` |
| Match InProgress (code expired) | Lost | Returns null — expected, code is irrelevant |
