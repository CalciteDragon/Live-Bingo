-- Up Migration

-- 1. Add difficulty and difficultySpread to lobbySettings in all existing matches
UPDATE matches
SET state_json = jsonb_set(
  jsonb_set(
    state_json,
    '{lobbySettings,difficulty}',
    '0.5'
  ),
  '{lobbySettings,difficultySpread}',
  '0.175'
)
WHERE state_json -> 'lobbySettings' IS NOT NULL;

-- 2. Add difficulty:0.5 placeholder to every cell in card.cells
--    (0.5 is a neutral approximation; cells are regenerated on next START_MATCH/RESHUFFLE)
UPDATE matches
SET state_json = jsonb_set(
  state_json,
  '{card,cells}',
  (
    SELECT jsonb_agg(cell || '{"difficulty": 0.5}')
    FROM jsonb_array_elements(state_json -> 'card' -> 'cells') AS cell
  )
)
WHERE state_json -> 'card' -> 'cells' IS NOT NULL;

-- Down Migration

UPDATE matches
SET state_json = jsonb_set(
  state_json,
  '{lobbySettings}',
  (state_json -> 'lobbySettings') - 'difficulty' - 'difficultySpread'
)
WHERE state_json -> 'lobbySettings' IS NOT NULL;

UPDATE matches
SET state_json = jsonb_set(
  state_json,
  '{card,cells}',
  (
    SELECT jsonb_agg(cell - 'difficulty')
    FROM jsonb_array_elements(state_json -> 'card' -> 'cells') AS cell
  )
)
WHERE state_json -> 'card' -> 'cells' IS NOT NULL;
