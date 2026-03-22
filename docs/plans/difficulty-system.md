# Difficulty System — Design & Implementation Plan

## Feature Summary

Add a host-configurable difficulty system to the lobby that influences which goals appear on the board. Goals each have an assigned `difficulty: number` (0.0–1.0). A Gaussian (normal distribution) weighting function biases goal selection toward the chosen difficulty level without eliminating randomness. A spread slider controls how tightly the distribution is centered. The center cell (index 12) is always biased one spread-unit harder than the target. Difficulty is stored per-cell and displayed as a green-to-red border ring in the UI.

---

## Design Decisions (Answers)

| # | Question | Answer |
|---|---|---|
| 1 | Goal difficulty assignment | Estimated by Claude, reviewed by user |
| 2 | "Weighted toward difficulty" meaning | Bell curve centered at selected difficulty (A) |
| 3 | Deviation slider | Default 0.175, min 0.05, max 0.5; visible to all; label: "Difficulty Spread" |
| 4 | Center cell bias | Target = `min(1.0, difficulty + spread)` (1 spread-unit above selected difficulty) |
| 5 | Determinism | `generateBoard(seed, difficulty, spread)` — same seed + same settings = same board |
| 6 | Settings persistence | Stored in `LobbySettings` |
| 7 | Difficulty display | Subtle colored border ring on each cell (green → red), visually separated from ownership color |

---

## Goal Difficulty Assignments

These are initial estimates for user review. Format: `{ text, difficulty }`.

### Crafting & tools
| Goal | Difficulty |
|------|-----------|
| Craft a fishing rod | 0.10 |
| Craft a compass | 0.25 |
| Craft a clock | 0.25 |
| Craft an anvil | 0.45 |
| Craft a bookshelf | 0.30 |
| Craft a jukebox | 0.35 |
| Craft a lead | 0.35 |
| Craft a name tag | 0.60 |
| Craft waxed weathered cut copper stairs | 0.80 |
| Craft a copper spear | 0.45 |
| Craft chisled tuff bricks | 0.55 |
| Craft a block from any ore | 0.35 |
| Craft an eye of ender | 0.85 |

### Mining & resources
| Goal | Difficulty |
|------|-----------|
| Mine a diamond ore | 0.50 |
| Mine an emerald ore | 0.55 |
| Mine ancient debris | 0.90 |
| Mine a block of obsidian | 0.30 |
| Find a geode | 0.40 |
| Break a monster spawner | 0.35 |
| Collect a stack of iron ingots | 0.35 |
| Collect a stack of gold ingots | 0.60 |
| Collect a stack of coal | 0.15 |
| Collect a stack of redstone dust | 0.40 |

### Exploration & structures
| Goal | Difficulty |
|------|-----------|
| Enter the Nether | 0.30 |
| Find a stronghold | 0.75 |
| Blow up a desert temple (and its loot!) | 0.35 |
| Loot a jungle temple | 0.50 |
| Loot an ocean monuments gold | 0.80 |
| Loot a woodland mansion chest | 0.85 |
| Loot a bastion remnant chest | 0.75 |
| Enter a nether fortress | 0.50 |
| Loot a shipwreck chest | 0.35 |
| Find a buried treasure | 0.40 |
| Find an archeological site | 0.40 |

### Mobs & combat
| Goal | Difficulty |
|------|-----------|
| Kill a creeper with fire damage | 0.35 |
| Kill a skeleton with an arrow | 0.10 |
| Kill an enderman with water | 0.55 |
| Kill a blaze with a snowball | 0.70 |
| Kill a wither skeleton with fall damage | 0.75 |
| Kill a ghast with melee damage | 0.85 |
| Kill a pillager | 0.30 |
| Kill a drowned | 0.20 |
| Kill an elder guardian | 0.90 |
| Kill a hoglin | 0.65 |
| Kill a phantom | 0.40 |
| Make a villager die to a zombie | 0.50 |
| Kill a monster at full hp in one hit | 0.45 |
| Kill a nether monster with a trident | 0.75 |
| Kill a mob with magic damage | 0.30 |

### Food & farming
| Goal | Difficulty |
|------|-----------|
| Eat a golden apple | 0.40 |
| Eat a suspicious stew | 0.25 |
| Brew a potion of Strength | 0.60 |
| Brew a potion of Night Vision | 0.55 |
| Brew a splash potion | 0.55 |
| Grow a pumpkin | 0.20 |
| Grow a melon | 0.20 |
| Breed two cows | 0.15 |
| Breed two pigs | 0.15 |
| Tame a wolf | 0.30 |
| Tame a cat | 0.30 |
| Tame a horse | 0.35 |
| Make a purple sheep | 0.40 |

### Achievements & feats
| Goal | Difficulty |
|------|-----------|
| Wear a full set of iron armor | 0.30 |
| Wear a full set of diamond armor | 0.75 |
| Enchant an item using a table | 0.40 |
| Trade with a villager | 0.25 |
| Travel 1000 blocks from spawn | 0.20 |
| Sleep in a bed in the Nether (attempt) | 0.50 |
| Reach the top of the world (Y=320) | 0.15 |
| Ride a pig with a carrot on a stick | 0.35 |
| Ride a strider in the Nether | 0.65 |
| Fill a map completely | 0.50 |
| Place a banner on a shield | 0.55 |
| Get to level 30 | 0.60 |

### Completely random
| Goal | Difficulty |
|------|-----------|
| Put armor on a tamed wolf | 0.45 |
| Look at the sun with a spyglass | 0.35 |
| Get struck by lightning | 0.70 |
| Throw an enchanted tool in lava | 0.55 |
| Equip a full armor set with trimmings | 0.80 |
| Equip an enchanted golden helmet with trim | 0.70 |
| Lay down in a cauldron of lava | 0.25 |
| Have all 3 types of nugget in your inventory | 0.35 |
| Fish a fishing rod | 0.30 |
| Type a message in chat and be ignored | 0.05 |
| Die 5 times in a row without your opponent dying | 0.50 |
| Shoot a projectile from a dispenser | 0.25 |
| Launch an explosive firework | 0.45 |
| Throw an ender pearl without having it land | 0.55 |
| Jump into a pool of lava in the nether | 0.35 |
| Make a redstone circuit with at least 3 different components | 0.50 |

---

## Algorithm Design

### Gaussian Weight Function

For each goal, its selection weight for a given target and spread is:

```
weight(goal) = exp(-0.5 * ((goal.difficulty - target) / spread)^2)
```

This is the unnormalized Gaussian PDF. At `goal.difficulty == target`, weight = 1.0 (maximum). A goal 1σ away has weight ≈ 0.607; 2σ away ≈ 0.135; 3σ away ≈ 0.011. Goals are never completely excluded — even extreme outliers have a nonzero weight (IEEE 754 doubles support values down to ~5e-324, so no underflow risk with the allowed ranges).

### Weighted Sampling Without Replacement

```
function pickWeighted(pool, weights, rand):
  total = sum(weights)
  r = rand() * total
  for i in 0..pool.length-1:
    r -= weights[i]
    if r <= 0: return (pool[i], i)
  return (pool[last], last)   # floating-point safety fallback
```

Each selection removes the chosen goal from the pool. Weights are recomputed fresh for each pick (pool shrinks, so total weight changes). This is O(N) per pick, O(25N) total ≈ 2,200 operations for N=88 — negligible.

### Board Generation Order (defines PRNG call order — must not change)

```
CENTER = 12

1. Compute centerTarget = min(1.0, difficulty + spread)
2. Compute weights for full pool using centerTarget
3. Pick center goal via pickWeighted → remove from pool

4. Pick 24 goals for non-center positions (selection phase):
     selected = []
     For i in 0..23:
       Compute weights for remaining pool using difficulty
       Pick goal via pickWeighted → remove from pool
       Append to selected

5. Shuffle `selected` in-place using Fisher-Yates + PRNG (placement phase)

6. Assign:
     cells[12] = center goal
     For i in 0..23:
       position = [0..11, 13..24][i]
       cells[position] = selected[i]
```

**Why two phases?** Sequential weighted pick-without-replacement favors goals closest to the target difficulty first. Without a shuffle step, those best-fit goals would cluster at top-left positions (lower indices) and later cells would receive the pool's leftovers — goals further from the target. Selecting all 24 goals first and then shuffling their board positions eliminates this spatial bias while preserving the overall difficulty distribution of the board as a whole.

Center is picked first (before the 24-goal selection) so its boosted target competes against the full goal pool.

PRNG call order is fixed: center pick → 24 sequential picks → shuffle. The same seed + same settings always produces the same board.

### Difficulty Color (for UI)

```
hue = (1 - difficulty) * 120   // 0.0 → 120° green, 1.0 → 0° red
color = hsl(hue, 70%, 50%)
```

This is computed in the Angular component and bound as a CSS custom property.

---

## Data Model Changes

### `packages/shared` — `src/match.ts`

**`LobbySettings`** — add two fields:

```typescript
interface LobbySettings {
  timerMode: TimerMode
  countdownDurationMs: number | null
  difficulty: number          // 0.0–1.0, default 0.5
  difficultySpread: number    // default 0.175, min 0.05, max 0.5
}
```

**`Cell`** — add difficulty field so the UI can display it without any lookup:

```typescript
interface Cell {
  index: number
  goal: string
  difficulty: number          // 0.0–1.0, the actual difficulty of the selected goal
  markedBy: string | null
}
```

### `packages/shared` — `src/events.ts`

**`SET_LOBBY_SETTINGS` payload** — make all fields optional (partial update semantics):

```typescript
interface SetLobbySettingsPayload {
  timerMode?: TimerMode
  countdownDurationMs?: number | null
  difficulty?: number
  difficultySpread?: number
}
```

Corresponding Zod schema update:

```typescript
z.object({
  timerMode: z.enum(['stopwatch', 'countdown']).optional(),
  countdownDurationMs: z.number().positive().nullable().optional(),
  difficulty: z.number().min(0).max(1).optional(),
  difficultySpread: z.number().min(0.05).max(0.5).optional(),
})
```

Making all fields optional enables each UI control (timer mode, countdown duration, difficulty, spread) to send its own independent event carrying only the changed field. The engine merges the update into existing settings.

### `packages/engine` — `src/goals.ts`

Convert from `readonly string[]` to a typed array:

```typescript
export interface Goal {
  text: string
  difficulty: number  // 0.0–1.0
}

export const GOALS: readonly Goal[] = [ ... ]
```

### `packages/engine` — `src/board.ts`

New signature:

```typescript
export function generateBoard(
  seed: number,
  difficulty = 0.5,
  spread = 0.175,
): BingoCard
```

### `packages/api` — `src/ws/message-pipeline.ts`

`buildEngineContext` currently only receives the WebSocket message. It must also receive the current `MatchState` so it can read `lobbySettings.difficulty` and `lobbySettings.difficultySpread` when calling `generateBoard`:

```typescript
// Before
function buildEngineContext(message: ClientMessage): EngineContext

// After
function buildEngineContext(message: ClientMessage, state: MatchState): EngineContext
```

The call site in the pipeline already has `state` in scope. `generateBoard` is called for `START_MATCH`, `RESHUFFLE_BOARD`, and `REMATCH` — all three must pass the settings from `state.lobbySettings`.

### `packages/api` — `src/routes/index.ts`

Initial match creation sets `LobbySettings` defaults:

```typescript
lobbySettings: {
  timerMode: 'stopwatch',
  countdownDurationMs: null,
  difficulty: 0.5,
  difficultySpread: 0.175,
}
```

The initial board generated at match creation also uses these defaults.

### `packages/engine` — `src/engine.ts`

`applyEvent` for `SET_LOBBY_SETTINGS` changes from full-replace to partial-merge semantics. Critically, the `timer` update logic must be **gated on `payload.timerMode !== undefined`** — a payload carrying only `{ difficulty }` must not touch the timer:

```typescript
case 'SET_LOBBY_SETTINGS': {
  const newLobbySettings = {
    ...state.lobbySettings,
    ...(payload.timerMode !== undefined && { timerMode: payload.timerMode }),
    ...('countdownDurationMs' in payload && { countdownDurationMs: payload.countdownDurationMs ?? null }),
    ...(payload.difficulty !== undefined && { difficulty: payload.difficulty }),
    ...(payload.difficultySpread !== undefined && { difficultySpread: payload.difficultySpread }),
  };
  return {
    ...state,
    lobbySettings: newLobbySettings,
    // Timer only updated if timerMode was explicitly changed
    timer: payload.timerMode !== undefined
      ? { /* existing timer rebuild logic using newLobbySettings.timerMode */ }
      : state.timer,
  };
}
```

---

## Database Migration

### New file: `apps/api/migrations/1742515200000_add_difficulty_settings.sql`

No new columns are added to the `matches` table. The existing `timer_mode` and `countdown_duration_ms` dedicated columns are only written at match creation and are not updated when `SET_LOBBY_SETTINGS` fires (the pipeline only updates `state_json`, `status`, `started_at`, `ended_at`). Adding dedicated difficulty columns would inherit the same staleness problem, so all difficulty data lives exclusively in `state_json`.

The migration patches existing rows' `state_json` in-place:

```sql
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
```

**Note on placeholder cell difficulties**: The `0.5` value written to existing cells is a neutral placeholder. It will display as a yellow border in the UI (mid-range on the green-to-red scale). The real per-cell difficulty is written when the next `START_MATCH`, `RESHUFFLE_BOARD`, or `REMATCH` event fires and `generateBoard` produces a properly-weighted card.

---

## API / Endpoint Contract Changes

All state snapshots (`MatchState`) sent by every endpoint and WebSocket message now include the two new fields in `lobbySettings` and `difficulty` on each cell. No new endpoints are introduced.

### REST

#### `POST /matches` — Create match

No request change. Response `state` shape changes:

```diff
  lobbySettings: {
    timerMode: 'stopwatch',
    countdownDurationMs: null,
+   difficulty: 0.5,
+   difficultySpread: 0.175,
  },
  card: {
    seed: <number>,
    cells: [
      {
        index: 0,
        goal: "...",
+       difficulty: <number>,   // 0.0–1.0, actual goal difficulty
        markedBy: null,
      },
      // ... 24 more
    ]
  }
```

The route handler must also pass `difficulty: 0.5, difficultySpread: 0.175` to `generateBoard(seed, 0.5, 0.175)` when creating the initial board.

#### `POST /matches/:id/join` — Join match

No request change. Response `state` includes the same new fields as above (passed through from registry state).

#### `GET /matches/:id` — Hydrate state

No request change. Response `state` includes the same new fields. No server-side logic change — the state is read from the registry (or `state_json` fallback) and returned as-is; the new fields are present because the state was constructed with them.

#### `GET /matches/by-code/:code` — Resolve join code

Unchanged. Returns only `{ matchId }`.

### WebSocket

#### `SET_LOBBY_SETTINGS` (Client → Server)

Payload is now a partial update — all fields optional. Each UI control sends only the field it changed:

| Field | Type | Validation |
|---|---|---|
| `timerMode` | `'stopwatch' \| 'countdown'` | optional |
| `countdownDurationMs` | `number \| null` | optional, positive if set |
| `difficulty` | `number` | optional, `min(0) max(1)` |
| `difficultySpread` | `number` | optional, `min(0.05) max(0.5)` |

At least one field should be present (the Zod schema does not enforce a minimum, but the engine no-ops if the payload is empty after merge).

#### `STATE_SYNC` / `STATE_UPDATE` (Server → Client)

No handler change. The `state` payload now includes `lobbySettings.difficulty`, `lobbySettings.difficultySpread`, and `cell.difficulty` on all cells as part of the normal `MatchState` broadcast.

### What does NOT change

- WebSocket upgrade params (`matchId`, `clientId`) — unchanged
- `MARK_CELL`, `UNMARK_CELL`, `START_MATCH`, `RESHUFFLE_BOARD`, `REMATCH`, `BACK_TO_LOBBY`, `KICK_PLAYER`, `SET_READY`, `SYNC_STATE` — all unchanged
- Error codes — unchanged
- `match_events` table — unchanged (events are recorded as-is; `SET_LOBBY_SETTINGS` payload now may have fewer fields, but that's fine for the audit log)

---

## UI Changes

### `apps/web` — `src/app/pages/lobby/lobby.ts`

**New host-only controls** (visible to all, interactive for host only):

- **Difficulty** slider: `min=0 max=1 step=0.05 default=0.5`
  - Displays current value as a percentage label (e.g., "50%")
  - Sends `SET_LOBBY_SETTINGS { difficulty }` on change, debounced 300ms
- **Difficulty Spread** slider: `min=0.05 max=0.5 step=0.025 default=0.175`
  - Displays current value (e.g., "±0.175")
  - Sends `SET_LOBBY_SETTINGS { difficultySpread }` on change, debounced 300ms

Both sliders use the same optimistic local state + pending eventId pattern already used for countdown duration. **No `isEditing` focus guard is needed** — unlike text inputs, sliders don't suffer cursor-jump on external value updates, and the optimistic local signal already prevents flicker on the host side. Non-host players see the current values as read-only display (rendered from `matchState().lobbySettings` directly, no local signal).

**New computed signals:**
- `difficulty` — from `matchState().lobbySettings.difficulty`
- `difficultySpread` — from `matchState().lobbySettings.difficultySpread`

**New local signals (host optimistic state):**
- `localDifficulty: number` — mirrors difficulty, updated immediately on slider input
- `localDifficultySpread: number` — mirrors spread, updated immediately on slider input

### `apps/web` — `src/app/shared/bingo-cell/bingo-cell.ts`

**New input:** `difficulty: number` (0.0–1.0)

**New computed property:**

```typescript
get difficultyColor(): string {
  const hue = (1 - this.difficulty) * 120;
  return `hsl(${hue}, 70%, 50%)`;
}
```

**Template binding:**

```html
<div class="bingo-cell"
     [style.--cell-color]="playerColorMap[cell.markedBy] ?? ''"
     [style.--difficulty-color]="difficultyColor"
     [class.active]="isActive"
     (click)="cellClick.emit(cell.index)">
  {{ cell.goal }}
</div>
```

### `apps/web` — `src/styles.scss`

**Difficulty border** — uses `outline` so it renders entirely outside the element's border box, creating a natural 2px gap of the page background between the ownership color and the difficulty ring:

```scss
.bingo-cell {
  outline: 3px solid var(--difficulty-color, transparent);
  outline-offset: 2px;
}
```

The ownership color fills the cell background via `--cell-color`. The difficulty ring sits visually outside, separated by the `outline-offset` gap. No layout changes needed.

---

## Implementation Steps (Ordered)

### Step 0 — `apps/api`: Database migration
1. Create `apps/api/migrations/1742515200000_add_difficulty_settings.sql` with the SQL above
2. Run migration against dev DB: `npm run migrate --workspace=apps/api`

### Step 1 — `packages/shared`: Data model
1. Add `difficulty` and `difficultySpread` to `LobbySettings`
2. Add `difficulty: number` to `Cell`
3. Update `SetLobbySettingsPayload` and its Zod schema to make all fields optional

### Step 2 — `packages/engine`: Goals list
1. Define `Goal` interface in `goals.ts`
2. Replace `readonly string[]` with `readonly Goal[]`, adding difficulty values per the table above

### Step 3 — `packages/engine`: Board generation
1. Add `gaussianWeight` helper
2. Add `pickWeighted` helper
3. Rewrite `generateBoard` with new signature and weighted sampling algorithm
4. Update `board.test.ts`:
   - Existing determinism test: pass explicit `difficulty=0.5, spread=0.175` to keep snapshot stable
   - New test: same seed + different difficulty → different board
   - New test: same seed + same difficulty + same spread → same board
   - New test: center cell (index 12) has higher difficulty than board average when `difficulty < 1.0`

### Step 4 — `packages/engine`: Engine event handler
1. Update `applyEvent` for `SET_LOBBY_SETTINGS` to use partial-merge semantics
2. Gate the `timer` update branch on `payload.timerMode !== undefined` so difficulty-only payloads don't touch the timer
3. Update `engine.test.ts`:
   - Existing `SET_LOBBY_SETTINGS` tests: update mock payloads to only include the field being changed
   - New test: partial update preserves unrelated fields (e.g., changing `difficulty` doesn't reset `timerMode`)
   - New test: payload with only `difficulty` leaves `state.timer` unchanged

### Step 5 — `packages/api`: Routes & message pipeline
1. Update `POST /matches` route: set `difficulty: 0.5, difficultySpread: 0.175` in initial `LobbySettings`; pass them to `generateBoard(seed, 0.5, 0.175)`
2. Update `buildEngineContext` signature to `(message, state)` and pass `state.lobbySettings.difficulty` and `state.lobbySettings.difficultySpread` to `generateBoard` for `START_MATCH`, `RESHUFFLE_BOARD`, and `REMATCH`
3. Update all `buildEngineContext` call sites in the pipeline to pass the current state
4. Update `routes.test.ts` and `ws.test.ts`: add the two new `LobbySettings` fields to all mock state objects; add `difficulty` to all mock `Cell` objects

### Step 6 — `apps/web`: BingoCellComponent
1. Add `difficulty` input
2. Add `difficultyColor` getter
3. Bind `--difficulty-color` in template

### Step 7 — `apps/web`: LobbyComponent
1. Add difficulty and spread sliders (host-interactive, all-visible)
2. Add optimistic local signals for both values
3. Debounce + send `SET_LOBBY_SETTINGS` on each slider change
4. Add computed signals for `difficulty` and `difficultySpread`

### Step 8 — `apps/web`: MatchComponent
1. Pass `cell.difficulty` to `BingoCellComponent` in the board template

### Step 9 — `apps/web`: Styles
1. Add `outline` + `outline-offset` rules to `.bingo-cell` in `styles.scss`

### Step 10 — Documentation
1. Update `.claude/shared-types.md` (LobbySettings, Cell)
2. Update `.claude/engine.md` (Goals list: fix "Completely random (15)" → "(16)" and total "89" → "90"; update `generateBoard` signature; note `buildEngineContext` signature change)
3. Update `.claude/api-server.md` (`buildEngineContext` signature)
4. Update `.claude/web-client.md` (BingoCellComponent inputs, LobbyComponent signals)
5. Remove this item from `docs/todos.md` when done; add any deferred items

---

## Open Questions / Risks

1. **`SET_LOBBY_SETTINGS` partial semantics**: Making all fields optional is a breaking change to the event contract. The existing lobby tests send a full payload; they'll need to be updated. The engine test for this event must verify merge behavior.

2. **Goal difficulty review**: The assignments in this document are initial estimates. Before shipping, the user should review and tune values — especially the "Completely random" category which has high variance. A separate tuning pass is planned.

3. **Difficulty spread at extremes**: With `spread=0.05` and `difficulty=0.0`, only ~3 goals exist near that difficulty level (0.05, 0.10, 0.10). After picking those 3, the remaining 22 cells are drawn from goals with very low weight — the board will be significantly harder than the target. This is the intended design (no hard exclusion, always random), but the practical guarantee weakens at extreme settings. No code change needed; note in any user-facing description of the sliders.

4. **DB migration ordering**: The migration must run before the new server code is deployed. If the server starts before the migration runs, hydrating any existing match from `state_json` will produce a `Cell` without `difficulty`, which TypeScript will treat as `undefined` — catching this at runtime before the board is rendered. In practice: run migration first.

5. **`Cell.difficulty` type change**: Any existing tests that construct mock `Cell` objects will need the new `difficulty` field added. This affects both `packages/engine` and `apps/api` test files — search for `markedBy: null` to find all inline cell literals.
