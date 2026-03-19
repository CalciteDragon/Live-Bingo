# Data Model & Persistence

## Postgres Schema

Migration: `apps/api/migrations/1740574800000_initial_schema.sql`

### matches

| Column | Type | Notes |
|---|---|---|
| match_id | UUID | PK |
| status | TEXT | 'Lobby', 'InProgress', 'Completed', 'Abandoned' |
| seed | BIGINT | Board generation seed |
| join_code | TEXT | 6-char hex uppercase, nullable |
| join_code_expires_at | TIMESTAMPTZ | 30 min from creation |
| timer_mode | TEXT | 'stopwatch' or 'countdown' |
| countdown_duration_ms | INTEGER | nullable |
| state_json | JSONB | Full MatchState snapshot |
| created_at | TIMESTAMPTZ | |
| started_at | TIMESTAMPTZ | Set on START_MATCH/REMATCH |
| ended_at | TIMESTAMPTZ | Set on win/timer expiry |
| abandoned_at | TIMESTAMPTZ | |

Indexes:
- `matches_join_code_idx` — partial unique on `join_code WHERE join_code IS NOT NULL`

### match_players

| Column | Type | Notes |
|---|---|---|
| player_id | UUID | PK |
| match_id | UUID | FK → matches (CASCADE) |
| client_id | UUID | |
| slot | SMALLINT | 1=host, 2-4=guests |
| alias | TEXT | nullable |
| connected | BOOLEAN | default false |
| last_seen_at | TIMESTAMPTZ | |

Constraints:
- `UNIQUE (match_id, slot)` — prevents duplicate slots
- `UNIQUE (match_id, client_id)` — prevents duplicate joins from same browser

### match_events

| Column | Type | Notes |
|---|---|---|
| match_id | UUID | FK → matches (CASCADE) |
| seq | BIGINT | Server-assigned, monotonic per match |
| event_id | UUID | Client-provided idempotency key |
| type | TEXT | Event type string |
| payload_json | JSONB | Event payload |
| player_id | UUID | |
| client_id | UUID | |
| created_at | TIMESTAMPTZ | |

Constraints:
- `UNIQUE (match_id, seq)` — canonical ordering
- `UNIQUE (match_id, event_id)` — at-most-once processing (deduplication)

## Persistence Strategy

### Primary: state_json JSONB

The `state_json` column in `matches` stores the complete `MatchState` snapshot. Updated after every accepted event via the message pipeline (stage 8).

### match_events (audit only)

Append-only log. Used for:
- Deduplication (stage 5 of message pipeline queries `match_events` by eventId)
- Debugging/auditing

### In-Memory Registry

`MatchEntry` in `match-registry.ts` is the runtime source of truth:
- `state: MatchState` — authoritative during uptime
- `sockets: Map<string, WebSocket>` — live connections
- `abandonTimer` / `countdownTimer` — active timeouts

### Write Path

For every accepted event:
1. Engine produces new state
2. DB transaction: INSERT event + UPDATE matches.state_json
3. Update in-memory registry
4. Broadcast to clients

### Startup Hydration

On server start:
- Queries all matches with status `Lobby` or `InProgress`
- Loads into registry with empty socket maps
- Starts abandon timers for all (since no clients connected yet)
- Reschedules countdown timers for InProgress+countdown matches

### Abandon Cleanup

When all players disconnect:
- 10-minute timer starts
- If no reconnection: `DELETE FROM matches WHERE match_id = $1` + remove from registry

### DB Connection

`pg.Pool` with `DATABASE_URL` env var. Single pool instance in `src/db/index.ts`.
