-- Up Migration

-- matches: one row per game session
CREATE TABLE matches (
  match_id              UUID        PRIMARY KEY,
  status                TEXT        NOT NULL,
  seed                  BIGINT      NOT NULL,
  join_code             TEXT,
  join_code_expires_at  TIMESTAMPTZ,
  timer_mode            TEXT        NOT NULL,
  countdown_duration_ms INTEGER,
  state_json            JSONB       NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  abandoned_at          TIMESTAMPTZ
);

-- Partial unique index: join_code must be unique when set, but multiple rows may have NULL
CREATE UNIQUE INDEX matches_join_code_idx
  ON matches (join_code)
  WHERE join_code IS NOT NULL;

-- match_players: one row per player per match (max 2)
CREATE TABLE match_players (
  player_id    UUID        PRIMARY KEY,
  match_id     UUID        NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  client_id    UUID        NOT NULL,
  slot         SMALLINT    NOT NULL,  -- 1 = host, 2 = guest
  alias        TEXT,
  connected    BOOLEAN     NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL,
  UNIQUE (match_id, slot),       -- prevents a third player and duplicate slots
  UNIQUE (match_id, client_id)   -- prevents duplicate joins from same browser
);

-- match_events: append-only audit log
CREATE TABLE match_events (
  match_id     UUID        NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
  seq          BIGINT      NOT NULL,  -- server-assigned, monotonically increasing per match
  event_id     UUID        NOT NULL,  -- client-provided idempotency key
  type         TEXT        NOT NULL,
  payload_json JSONB,
  player_id    UUID,
  client_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, seq),      -- canonical ordering
  UNIQUE (match_id, event_id)  -- at-most-once processing
);

-- Down Migration

DROP TABLE IF EXISTS match_events;
DROP TABLE IF EXISTS match_players;
DROP TABLE IF EXISTS matches;
