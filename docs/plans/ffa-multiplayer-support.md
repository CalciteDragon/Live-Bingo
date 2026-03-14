# FFA Multiplayer Support

## End Goal

Expand the 1v1 match format to support **2–4 players** in a free-for-all (FFA) style. Every player competes on the same shared board; goals are claimed by whichever player marks them first, and each player's claims render in their own persistent color. A new majority win condition ends the match early when the leader's advantage over second place exceeds the number of remaining blank squares. A player panel left of the board shows all participants' aliases, colors, live scores, and current standings.

## Overview of Scope

| Layer | Summary of changes |
|---|---|
| `packages/shared` | Expand `Slot` to `1\|2\|3\|4`; add `matchMode: 'ffa'` to `MatchState` |
| `packages/engine` | New majority condition; relax START_MATCH player count to 2–4; extract `resolveOwnerGroup` + `collectScoresByOwner` helpers |
| `apps/api` | Join route allows up to 4 players; timer-expiry logic generalized to n players |
| `apps/web` | Cell color via pre-resolved color map (mode-agnostic); new PlayerPanelComponent; updated MatchComponent layout; updated ResultsOverlay for n-player results |

---

## Questions

### Answered

**Q: Should player color be stored in `MatchState` or derived from slot?**
Color is deterministic from slot number, so it does not need to be persisted. Export a `SLOT_COLORS` constant map from `apps/web` (presentation layer only — the API and engine have no use for CSS colors). The web derives color from `player.slot` via `buildPlayerColorMap(state)` at render time.

**Q: What exactly is the new majority win condition?**
> **blanks < (1st_place_score − 2nd_place_score)**

Where `blanks` = cells with `markedBy === null`, and scores are sorted descending over all players in the match (players with 0 marks contribute a score of 0). This is mathematically equivalent to: *even if second place claimed every remaining blank cell, they still could not reach first place's score.* The condition is only ever compared against 1st and 2nd place; third/fourth place do not participate in the trigger check.

Backward-compatibility check with 2 players (host=13, guest=0, blanks=12): `12 < 13−0 = 12 < 13` → triggers ✓. The rule produces the same outcome as the old ≥13 threshold for the common 2-player case where only one player has marks.

**Q: What is the minimum player count to start?**
Two. The host can start a match with 2, 3, or 4 players — whoever has joined and readied up.

**Q: How does timer expiry work with 4 players?**
Count cells per player, sort descending. If the top scorer is unique → they win. If two or more players are tied for the top score → draw (`winnerId: null`).

**Q: What constitutes a draw at timer expiry in FFA?**
Tied for *first place only*. If players 1 and 2 are tied but player 3 is behind, it is still a draw between 1 and 2.

**Q: How does the abandon timer work with 4 players?**
No change needed. `allDisconnected = players.every(p => !p.connected)` is already n-agnostic.

**Q: Is REMATCH available with 4 players?**
Yes, with the same rule: all players must be connected. (If someone has permanently left, the host uses "Back to Lobby" and re-invites.)

**Q: What ranking style for the player panel standings?**
Dense ranking (1, 2, 2, 3 — not 1, 2, 2, 4). More intuitive in a fast-paced game.

**Q: Is `isAllPlayersReady` already n-agnostic?**
Yes. It checks `players.length < 2` and `players.every(p => readyStates[p.playerId] === true)`. No change needed.

**Q: Does the line win check need changing for 4 players?**
No. A line is still 5 consecutive cells all owned by the *same* player. The check is player-count–agnostic — see Phase 2 for the extensibility-safe implementation.

**Q: Do we need to change the lobby UI for FFA?**
The lobby's `@for (player of playersWithLocalStatus(); ...)` already renders an arbitrary number of player cards. No structural change needed. Slot colors in the lobby (a nice-to-have preview of each player's color) are out of scope for this plan.

### Open / Watch

- **What happens if a player disconnects mid-FFA match?** Their marks remain on the board. If they reconnect before the match ends, they can continue. This is the existing behavior — no change needed.
- **Should 3rd/4th place be shown in the results overlay?** Yes — all players are shown ranked by cell count.

---

## Extensibility Considerations (team vs team)

The three decisions below differ from the naive implementation specifically to avoid lock-in for a future team mode. Everything else is unchanged.

### 1. Engine — extract `resolveOwnerGroup` and `collectScoresByOwner`

The entire engine's notion of "who owns this cell for purposes of winning" flows through one private function:

```ts
// FFA: the group is the player themselves.
// Team mode: replace with player.teamId lookup.
function resolveOwnerGroup(markedBy: string, _state: MatchState): string {
  return markedBy;
}
```

Score aggregation also goes through one function:

```ts
// FFA: counts cells per player.
// Team mode: counts cells per team (sum across all teammates).
function collectScoresByOwner(state: MatchState): Map<string, number> { ... }
```

Both the line-win check and the majority check call these two helpers. For team mode, only these functions change — the win logic itself is untouched.

### 2. Web — `BingoCellComponent` takes `playerColorMap`, not `playerSlotMap`

The cell component receives a pre-resolved `Record<string, string>` (playerId → CSS color) from its parent. It never knows whether colors came from slots, team assignments, or any other source. For FFA the parent uses `buildPlayerColorMap(state)`; for team mode it would use `buildTeamColorMap(state)` — zero changes to `BingoCellComponent` either way.

This is the most impactful extensibility decision. If the cell took `playerSlotMap: Record<string, Slot>` instead, two players on the same team (different slots) would always render in different colors, which is wrong for team mode.

### 3. Shared — `matchMode` field on `MatchState`

Adding `matchMode: 'ffa'` to `MatchState` now costs one field. Without it, adding team mode later requires a schema migration against all existing persisted `state_json` rows (which would lack the field). With it, the default fallback logic is never needed.

The engine, API, and web can all read `state.matchMode` to dispatch on mode-specific behavior when team mode arrives.

### What changes for team mode (deferred, not in scope)

| Concern | What changes |
|---|---|
| `packages/shared` | `Player` grows `teamId?: string`; `MatchResult.winnerId` semantics shift to a group identifier (currently a playerId — for teams it would be a teamId or team name) |
| `packages/engine` | `resolveOwnerGroup` returns `player.teamId`; `checkWin` line priority: `winnerId` becomes a teamId; `resolveTimerWinner` requires no changes — it delegates to `collectScoresByOwner` which already routes through `resolveOwnerGroup` |
| `apps/api` | Join route enforces team-based slot distribution; `expireCountdown` already calls `resolveTimerWinner` — no changes needed here |
| `apps/web` | Replace `buildPlayerColorMap` with `buildTeamColorMap`; `getPlayerRankings` becomes `getTeamRankings`; results overlay shows team scores |

---

## Phase 1 — Shared Types

**Goal:** Widen the `Slot` union; add `matchMode` to `MatchState` as the mode-dispatch anchor.

### Files

#### `packages/shared/src/match.ts`

```ts
// Before
export type Slot = 1 | 2;

// After
export type Slot = 1 | 2 | 3 | 4;
```

Add `matchMode` to `MatchState`:
```ts
export type MatchMode = 'ffa'; // | 'teams_2v2' when team mode is added

export interface MatchState {
  matchId: string;
  matchMode: MatchMode; // new — dispatch point for mode-specific logic
  status: MatchStatus;
  players: Player[];
  // ... rest unchanged
}
```

#### `apps/api/src/routes/index.ts` (initial state construction)

Add `matchMode: 'ffa'` when building the initial state in `POST /matches`:
```ts
const state: MatchState = {
  matchId,
  matchMode: 'ffa',
  // ... rest unchanged
};
```

### Tests

Type-level change — no new unit tests needed. Existing tests will catch regressions at compile time. All `makeState()` factory functions in test files need `matchMode: 'ffa'` added.

---

## Phase 2 — Engine

**Goal:** Update `validateEvent` to accept 2–4 players for `START_MATCH`; rewrite `checkWin` using the `resolveOwnerGroup` / `collectScoresByOwner` abstraction with the new majority condition.

**Prerequisites:** Phase 1 complete.

### Files

#### `packages/engine/src/engine.ts`

**Change 1 — `validateEvent / START_MATCH`:**
```ts
// Before
if (state.players.length !== 2)
  throw new EngineError('INVALID_STATE', 'Two players required to start');

// After
if (state.players.length < 2 || state.players.length > 4)
  throw new EngineError('INVALID_STATE', 'Two to four players required to start');
```

**Change 2 — extract private helpers above `checkWin`:**

```ts
/**
 * Maps a cell's markedBy (playerId) to its "owner group" for win evaluation.
 * FFA: the group is the player. Team mode: return player.teamId instead.
 * This is the single extension point for team-based ownership.
 */
function resolveOwnerGroup(markedBy: string, _state: MatchState): string {
  return markedBy;
}

/**
 * Aggregates cell counts by owner group across all players.
 * FFA: one entry per player (including 0-count players).
 * Team mode: one entry per team (sum of all teammates' cells).
 */
function collectScoresByOwner(state: MatchState): Map<string, number> {
  const counts = new Map<string, number>(
    state.players.map((p) => [resolveOwnerGroup(p.playerId, state), 0]),
  );
  for (const cell of state.card.cells) {
    if (cell.markedBy !== null) {
      const group = resolveOwnerGroup(cell.markedBy, state);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
  }
  return counts;
}
```

**Change 3 — add exported `resolveTimerWinner`:**

```ts
/**
 * Determines the winner when the countdown timer expires.
 * Uses collectScoresByOwner so team mode gets consistent behavior
 * by only changing resolveOwnerGroup — no changes needed here.
 * Returns a MatchResult with reason 'timer_expiry'.
 */
export function resolveTimerWinner(state: MatchState): MatchResult {
  const ownerScores = collectScoresByOwner(state);
  const sorted = [...ownerScores.entries()].sort((a, b) => b[1] - a[1]);
  const topCount = sorted[0]?.[1] ?? 0;
  const topOwners = sorted.filter(([, count]) => count === topCount);
  const winnerId = topOwners.length === 1 ? topOwners[0]![0] : null;
  return { winnerId, reason: 'timer_expiry' };
}
```

Placing this in the engine (alongside `checkWin`) keeps all win-condition logic in one pure, tested layer and removes the parallel score-aggregation code in `apps/api`.

**Change 4 — rewrite `checkWin`:**

```ts
export function checkWin(state: MatchState): MatchResult | null {
  if (state.status !== 'InProgress') return null;

  const { cells } = state.card;

  // ── Line win ──────────────────────────────────────────────────────────────
  for (const line of LINES) {
    const firstMarkedBy = cells[line[0]!]?.markedBy;
    if (!firstMarkedBy) continue;
    const firstGroup = resolveOwnerGroup(firstMarkedBy, state);
    if (line.every((i) => {
      const m = cells[i]?.markedBy;
      return m != null && resolveOwnerGroup(m, state) === firstGroup;
    })) {
      return { winnerId: firstMarkedBy, reason: 'line' };
    }
  }

  // ── Majority win ──────────────────────────────────────────────────────────
  const ownerScores = collectScoresByOwner(state);
  const scores = [...ownerScores.values()].sort((a, b) => b - a);
  const blanks = cells.filter((c) => c.markedBy === null).length;

  if (scores.length >= 2 && blanks < scores[0]! - scores[1]!) {
    const [winnerId] = [...ownerScores.entries()].find(([, count]) => count === scores[0]!)!;
    return { winnerId: winnerId!, reason: 'majority' };
  }

  return null;
}
```

Key properties:
- `resolveOwnerGroup` returns the playerId unchanged for FFA — the line check remains identical in behavior to the current code.
- `collectScoresByOwner` seeds the map with all players at 0 — players with no marks are included in the ranking, so the majority condition correctly compares against the full field.
- Since the trigger condition requires `blanks < scores[0]! - scores[1]!`, `scores[0]! > scores[1]!` is guaranteed, so exactly one group holds `scores[0]!` — the `find` is safe.
- Tie at 0 marks: difference = 0, `blanks < 0` is always false. Safe.

### Tests (`packages/engine/src/__tests__/engine.test.ts`)

Add `matchMode: 'ffa'` to the `makeState()` factory.

#### Update existing tests

| Test | Change |
|---|---|
| `START_MATCH — throws INVALID_STATE with only 1 player` | Still valid, keep as-is |
| `START_MATCH — passes when host, 2 players, all ready` | Still valid, keep as-is |
| `START_MATCH — throws INVALID_STATE if not in Lobby` | Still valid, keep as-is |
| `checkWin — 13 cells for one player (no line) returns majority win` | Keep as-is. HOST=13, GUEST=0, blanks=12: `12 < 13−0=13` → still triggers ✓ |
| `checkWin — 12 cells for one player returns null` | Keep as-is. HOST=12, GUEST=0, blanks=13: `13 < 12` → false ✓ |
| `checkWin — marks split evenly returns null` | Keep as-is. HOST=12, GUEST=12, blanks=1: `1 < 0` → false ✓ |
| `checkWin — line win takes priority over simultaneous majority win` | Keep as-is. Line fires before majority check ✓ |

#### Add new tests

**In `validateEvent / START_MATCH` block:**
```ts
it('passes with 3 players all ready', () => {
  const p3: Player = { playerId: 'player-3', clientId: 'client-3', slot: 3, alias: null, connected: true };
  const state = makeState({
    players: [HOST, GUEST, p3],
    readyStates: { [HOST_ID]: true, [GUEST_ID]: true, 'player-3': true },
  });
  expect(() => validateEvent(state, startMatch())).not.toThrow();
});

it('passes with 4 players all ready', () => {
  const p3: Player = { playerId: 'player-3', clientId: 'client-3', slot: 3, alias: null, connected: true };
  const p4: Player = { playerId: 'player-4', clientId: 'client-4', slot: 4, alias: null, connected: true };
  const state = makeState({
    players: [HOST, GUEST, p3, p4],
    readyStates: { [HOST_ID]: true, [GUEST_ID]: true, 'player-3': true, 'player-4': true },
  });
  expect(() => validateEvent(state, startMatch())).not.toThrow();
});
```

**In `checkWin` block — new majority condition tests:**
```ts
it('majority triggers when blanks < (1st_score - 2nd_score)', () => {
  // HOST=10, GUEST=3, blanks=12: 12 < 10-3=7 → false. Need blanks < 7.
  // HOST=10, GUEST=3, remaining 6 cells blank → total=19 → impossible with 25 cells.
  // Use: HOST=10, GUEST=3, 6 blanks → 10+3+6=19 ≠ 25. Add 6 more to GUEST or HOST.
  // Cleanest: HOST=10, GUEST=3, 6 blanks, 6 extra marked by HOST → HOST=16, GUEST=3, blanks=6
  // Simpler: just set up HOST=10, GUEST=3 with exactly 12 total marked (blanks=13), that's no-win.
  // For a triggering case: HOST=14, GUEST=5, blanks=6: 6 < 14-5=9 → triggers.
  const cells = Array.from({ length: 25 }, (_, i) =>
    makeCell(i, i < 14 ? HOST_ID : i < 19 ? GUEST_ID : null),
  );
  // HOST=14, GUEST=5, blanks=6: diff=9, 6<9 → triggers
  const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
  expect(checkWin(state)).toEqual({ winnerId: HOST_ID, reason: 'majority' });
});

it('majority does not trigger when blanks equals (1st_score - 2nd_score)', () => {
  // HOST=10, GUEST=5, blanks=10: diff=5, 10<5=false (boundary — exactly equal, no win)
  const cells = Array.from({ length: 25 }, (_, i) =>
    makeCell(i, i < 10 ? HOST_ID : i < 15 ? GUEST_ID : null),
  );
  const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
  expect(checkWin(state)).toBeNull();
});

it('majority triggers for leading player in a 3-player match', () => {
  const P3_ID = 'player-3';
  const p3: Player = { playerId: P3_ID, clientId: 'client-3', slot: 3, alias: null, connected: true };
  // HOST=12, GUEST=4, P3=2, blanks=7: diff=12-4=8, 7<8 → triggers HOST win
  const cells = Array.from({ length: 25 }, (_, i) =>
    makeCell(i, i < 12 ? HOST_ID : i < 16 ? GUEST_ID : i < 18 ? P3_ID : null),
  );
  const state = makeState({
    status: 'InProgress',
    players: [HOST, GUEST, p3],
    card: makeCard({ cells }),
  });
  expect(checkWin(state)).toEqual({ winnerId: HOST_ID, reason: 'majority' });
});

it('majority does not trigger in 3-player match when 2nd place is close enough', () => {
  const P3_ID = 'player-3';
  const p3: Player = { playerId: P3_ID, clientId: 'client-3', slot: 3, alias: null, connected: true };
  // HOST=10, GUEST=6, P3=4, blanks=5: diff=10-6=4, 5<4=false
  const cells = Array.from({ length: 25 }, (_, i) =>
    makeCell(i, i < 10 ? HOST_ID : i < 16 ? GUEST_ID : i < 20 ? P3_ID : null),
  );
  const state = makeState({
    status: 'InProgress',
    players: [HOST, GUEST, p3],
    card: makeCard({ cells }),
  });
  expect(checkWin(state)).toBeNull();
});
```

**`resolveTimerWinner` tests:**
```ts
describe('resolveTimerWinner', () => {
  it('returns the player with the most cells as winner', () => {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 10 ? HOST_ID : i < 13 ? GUEST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    expect(resolveTimerWinner(state)).toEqual({ winnerId: HOST_ID, reason: 'timer_expiry' });
  });

  it('returns winnerId null on a tie for first', () => {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 8 ? HOST_ID : i < 16 ? GUEST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    expect(resolveTimerWinner(state)).toEqual({ winnerId: null, reason: 'timer_expiry' });
  });

  it('returns winner in a 3-player match', () => {
    const P3_ID = 'player-3';
    const p3: Player = { playerId: P3_ID, clientId: 'client-3', slot: 3, alias: null, connected: true };
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 10 ? HOST_ID : i < 16 ? GUEST_ID : i < 19 ? P3_ID : null),
    );
    const state = makeState({ status: 'InProgress', players: [HOST, GUEST, p3], card: makeCard({ cells }) });
    expect(resolveTimerWinner(state)).toEqual({ winnerId: HOST_ID, reason: 'timer_expiry' });
  });

  it('returns null when multiple players tie for first in a 3-player match', () => {
    const P3_ID = 'player-3';
    const p3: Player = { playerId: P3_ID, clientId: 'client-3', slot: 3, alias: null, connected: true };
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 8 ? HOST_ID : i < 16 ? GUEST_ID : null),
    );
    // HOST=8, GUEST=8, P3=0 — HOST and GUEST tied for first
    const state = makeState({ status: 'InProgress', players: [HOST, GUEST, p3], card: makeCard({ cells }) });
    expect(resolveTimerWinner(state)).toEqual({ winnerId: null, reason: 'timer_expiry' });
  });

  it('returns null on an empty board', () => {
    const state = makeState({ status: 'InProgress' });
    // all players at 0 — tie for first
    expect(resolveTimerWinner(state)).toEqual({ winnerId: null, reason: 'timer_expiry' });
  });
});
```

Also add `resolveTimerWinner` to the exports in `packages/engine/src/index.ts`.

---

## Phase 3 — API

**Goal:** Allow up to 4 players to join a match; generalize timer-expiry win logic to n players.

**Prerequisites:** Phase 1 complete (Slot type, matchMode field), Phase 2 complete (engine validation accepts 2–4 players).

### Files

#### `apps/api/src/routes/index.ts`

**Change 1 — `POST /matches/:id/join`: allow up to 4 players**

```ts
// Before
if (state.players.length >= 2) {
  res.status(409).json({ code: 'MATCH_FULL', message: 'Match already has two players' });
  return;
}

// After
if (state.players.length >= 4) {
  res.status(409).json({ code: 'MATCH_FULL', message: 'Match is full' });
  return;
}
```

**Change 2 — atomic slot assignment inside the transaction**

Slot must be computed from the DB inside the transaction, not from the in-memory state. Computing it application-side (`state.players.length + 1`) is a TOCTOU race: two clients joining simultaneously can both read the same `players.length`, compute the same slot number, and both INSERT — either double-assigning a slot or crashing with a constraint violation.

`FOR UPDATE` on `match_players` serializes concurrent joins for the same match; the second joiner blocks until the first transaction commits and then reads the correctly incremented MAX.

```ts
// Inside the BEGIN/COMMIT block, before the INSERT:
const { rows: slotRows } = await client.query<{ next_slot: number }>(
  `SELECT COALESCE(MAX(slot), 0) + 1 AS next_slot
   FROM match_players WHERE match_id = $1
   FOR UPDATE`,
  [matchId],
);
const slot = slotRows[0]!.next_slot as Slot;
const player: Player = { playerId, clientId, slot, alias, connected: false };
```

The pre-transaction guard (`state.players.length >= 4`) still uses in-memory state as a fast-path rejection and is correct for that purpose — it prevents most over-joins without hitting the DB. The DB query is the authoritative check for the actual slot number.

> **Note on disconnect safety:** disconnect does not remove a player from `state.players` — it only sets `connected: false`. The disconnected player's slot remains occupied in `match_players`, so `MAX(slot)` always reflects the true high-water mark regardless of connection status.

#### `apps/api/src/ws/match-timers.ts`

**Change — replace inline score logic with `resolveTimerWinner` from engine**

```ts
import { resolveTimerWinner } from '@bingo/engine';

// Before (hardcoded to 2 players)
const [p1, p2] = entry.state.players;
// ... 8 lines of manual count/compare logic ...

// After
const result = resolveTimerWinner(entry.state);
const newState = { ...entry.state, status: 'Completed' as const, result };
```

All n-player score aggregation and tie-breaking lives in the engine. `expireCountdown` is responsible only for persisting the result and broadcasting.

### Tests (`apps/api/src/__tests__/routes.test.ts`)

Update the `makeState()` factory to include `matchMode: 'ffa'`.

#### Update existing tests

| Test | Change |
|---|---|
| `POST /matches/:id/join — 409 when match already has 2 players` | Update state to have 4 players (full); update error message assertion to `'Match is full'` |

#### Add new tests

```ts
it('POST /matches/:id/join — 200 when match has 3 players (not yet full)', async () => {
  // state with 3 players in Lobby, attempt to join as 4th
  // expect: 200, slot: 4 on the returned player
});

it('POST /matches/:id/join — 409 MATCH_FULL when match has 4 players', async () => {
  // state with 4 players
  // expect: 409 with code MATCH_FULL and message 'Match is full'
});

it('POST /matches/:id/join — assigns correct slot based on current player count', async () => {
  // state with 2 players → joining player gets slot 3
});
```

---

## Phase 4 — Web

**Goal:** Show each player's cell claims in their color; add a live player panel left of the board; update the results overlay for n-player rankings.

**Prerequisites:** Phase 1 complete (Slot type, matchMode importable from shared).

The sub-tasks below are largely independent and can be done in any order within this phase.

### 4-A: Color Infrastructure in `match.helpers.ts`

Add to `apps/web/src/app/core/match.helpers.ts`:

```ts
import type { Slot, MatchState } from '@bingo/shared';

/** One canonical color per player slot, used consistently across all UI surfaces. */
export const SLOT_COLORS: Record<Slot, string> = {
  1: '#4a9eff', // blue
  2: '#ff6b6b', // red
  3: '#51cf66', // green
  4: '#fcc419', // yellow
};

/**
 * Returns a map of playerId → CSS color for all players in the match.
 *
 * This is the single extension point for mode-specific color logic.
 * FFA: color derived from player slot.
 * Team mode: replace with buildTeamColorMap() where teammates share a color.
 * BingoCellComponent and any other consumer receives the result of this function
 * and is entirely agnostic about how colors were determined.
 */
export function buildPlayerColorMap(state: MatchState): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of state.players) {
    map[p.playerId] = SLOT_COLORS[p.slot];
  }
  return map;
}

export interface PlayerRankEntry {
  playerId: string;
  alias: string;
  slot: Slot;
  color: string;
  score: number;
  rank: number; // dense ranking (1,2,2,3)
  isMe: boolean;
}

/** Computes dense rankings for all players by current cell count. */
export function getPlayerRankings(state: MatchState, myPlayerId: string): PlayerRankEntry[] {
  const counts: Record<string, number> = {};
  for (const cell of state.card.cells) {
    if (cell.markedBy) {
      counts[cell.markedBy] = (counts[cell.markedBy] ?? 0) + 1;
    }
  }

  const scored = state.players.map((p) => ({
    playerId: p.playerId,
    alias: p.alias ?? 'Unknown',
    slot: p.slot,
    color: SLOT_COLORS[p.slot],
    score: counts[p.playerId] ?? 0,
    isMe: p.playerId === myPlayerId,
  }));

  scored.sort((a, b) => b.score - a.score);

  let rank = 1;
  return scored.map((entry, i) => {
    if (i > 0 && entry.score < scored[i - 1]!.score) rank = i + 1;
    return { ...entry, rank };
  });
}

/** Returns ordinal label for a rank number (1→'1st', 2→'2nd', etc.) */
export function ordinalLabel(rank: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = rank % 100;
  return rank + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]!);
}
```

#### Tests (`apps/web/src/app/core/match.helpers.spec.ts`)

Add tests for:
- `buildPlayerColorMap` — returns correct colors keyed by playerId
- `getPlayerRankings` — correct scores, dense ranking, `isMe` flag
  - 2 players, no tie
  - 3 players, tied for 2nd (both get rank 2, next gets rank 3)
  - 4 players
- `ordinalLabel` — 1→'1st', 2→'2nd', 3→'3rd', 4→'4th', 11→'11th'

### 4-B: Update `BingoCellComponent`

**File:** `apps/web/src/app/shared/bingo-cell/bingo-cell.ts`

The cell receives a pre-resolved `playerColorMap: Record<string, string>` (playerId → CSS color). It never knows whether colors came from slots, team assignments, or anything else. This makes the component fully mode-agnostic.

**New inputs:**
- Remove: `myPlayerId: input.required<string>()`
- Add: `playerColorMap: input.required<Record<string, string>>()` — maps playerId → CSS color string

**New computed:**
```ts
protected cellColor(): string | null {
  const m = this.cell().markedBy;
  return m ? (this.playerColorMap()[m] ?? null) : null;
}

protected cellStyle(): { '--cell-color': string } | Record<string, never> {
  const color = this.cellColor();
  return color ? { '--cell-color': color } : {};
}
```

**Updated template:**
```html
<button
  class="bingo-cell"
  [class.bingo-cell--marked]="cell().markedBy !== null"
  [style]="cellStyle()"
  [class.bingo-cell--inactive]="!isActive()"
  (click)="onClick()"
>
  <span class="bingo-cell__goal">{{ cell().goal }}</span>
</button>
```

CSS:
```css
.bingo-cell--marked {
  background-color: var(--cell-color, #ccc);
}
```

**Update `MatchComponent`** to compute `playerColorMap` via the helper and pass it down:
```ts
readonly playerColorMap = computed<Record<string, string>>(() => {
  const s = this.state();
  return s ? buildPlayerColorMap(s) : {};
});
```

Updated template binding:
```html
<app-bingo-cell
  [cell]="cell"
  [playerColorMap]="playerColorMap()"
  [isActive]="isActive()"
  (cellClick)="onCellClick($event)"
/>
```

`onCellClick` in MatchComponent is unchanged — ownership check uses `playerId()` directly, which is already correct for FFA.

#### Tests (`apps/web/src/app/shared/bingo-cell/bingo-cell.spec.ts`)

- Remove tests for `isSelf()` / `isOpponent()` class bindings
- Add tests:
  - Unmarked cell: no `bingo-cell--marked` class, no `--cell-color` style
  - Marked by player with color `'#4a9eff'`: has `bingo-cell--marked`, `--cell-color` is `'#4a9eff'`
  - Marked by player with color `'#51cf66'`: `--cell-color` is `'#51cf66'`
  - `cellClick` not emitted when `isActive = false`
  - `cellClick` emitted with correct index when `isActive = true`

### 4-C: New `PlayerPanelComponent`

**File:** `apps/web/src/app/shared/player-panel/player-panel.ts`

```ts
@Component({
  selector: 'app-player-panel',
  standalone: true,
  template: `
    <div class="player-panel">
      @for (entry of rankings(); track entry.playerId) {
        <div class="player-panel__entry" [class.player-panel__entry--me]="entry.isMe">
          <span class="player-panel__rank">{{ ordinal(entry.rank) }}</span>
          <span class="player-panel__color-swatch" [style.background-color]="entry.color"></span>
          <span class="player-panel__alias">{{ entry.alias }}</span>
          <span class="player-panel__score">{{ entry.score }}</span>
        </div>
      }
    </div>
  `,
})
export class PlayerPanelComponent {
  private readonly sessionStore = inject(SessionStoreService);

  private readonly state    = computed(() => this.sessionStore.matchState());
  private readonly playerId = computed(() => this.sessionStore.playerId());

  readonly rankings = computed(() => {
    const s  = this.state();
    const id = this.playerId();
    return s && id ? getPlayerRankings(s, id) : [];
  });

  protected ordinal = ordinalLabel;
}
```

#### Tests (`apps/web/src/app/shared/player-panel/player-panel.spec.ts`)

- With 2 players, leader renders first with rank "1st"
- Tied players both show same rank label
- "Me" player has `player-panel__entry--me` class
- Color swatch `background-color` matches the player's slot color

### 4-D: Update `MatchComponent` Layout

**File:** `apps/web/src/app/pages/match/match.ts`

Import `PlayerPanelComponent` and wrap the board in a flex layout:

```html
<div class="match-page">
  <div class="match-header">
    <div class="match-timer">{{ displayTimer$ | async }}</div>
  </div>

  <div class="match-layout">
    <app-player-panel />

    <div class="bingo-board">
      @for (cell of cells(); track cell.index) {
        <app-bingo-cell
          [cell]="cell"
          [playerColorMap]="playerColorMap()"
          [isActive]="isActive()"
          (cellClick)="onCellClick($event)"
        />
      }
    </div>
  </div>

  @if (isActive() && amHost()) { ... }
  @if (isCompleted()) { ... }
</div>
```

CSS: `.match-layout { display: flex; align-items: flex-start; gap: 1rem; }`. The player panel is a fixed-width sidebar.

#### Tests (`apps/web/src/app/pages/match/match.spec.ts`)

- `app-player-panel` renders when match is `InProgress`
- `app-bingo-cell` receives `playerColorMap` computed from state

### 4-E: Update `ResultsOverlayComponent`

**File:** `apps/web/src/app/shared/results-overlay/results-overlay.ts`

**Change 1 — n-player headline:**

```ts
readonly headline = computed(() => {
  const result = this.result();
  if (!result) return '';
  if (result.winnerId === null) return "It's a draw!";
  if (result.winnerId === this.playerId()) return 'You won!';
  const s   = this.state();
  const pid = this.playerId()!;
  if (!s) return 'You lost.';
  const myRank = getPlayerRankings(s, pid).find(r => r.playerId === pid)?.rank ?? 2;
  return `You came ${ordinalLabel(myRank)}!`;
});
```

**Change 2 — sort score summary descending:**

```ts
readonly scoreSummary = computed(() =>
  this.players()
    .map(p => ({
      playerId: p.playerId,
      alias:    p.alias ?? 'Unknown',
      count:    this.cellCounts()[p.playerId] ?? 0,
    }))
    .sort((a, b) => b.count - a.count),
);
```

#### Tests (`apps/web/src/app/shared/results-overlay/results-overlay.spec.ts`)

- Draw: headline is "It's a draw!"
- Winner viewing their result: "You won!"
- 2nd-place player (3-player match): "You came 2nd!"
- 3rd-place player (3-player match): "You came 3rd!"
- Score summary renders all players sorted by count descending

---

## Implementation Order

```
Phase 1 (shared types + matchMode)
  └─► Phase 2 (engine)
  │     └─► Phase 3 (API)
  └─► Phase 4-A (web helpers) — can start in parallel with Phase 2
        ├─► Phase 4-B (bingo cell)
        ├─► Phase 4-C (player panel)
        ├─► Phase 4-D (match layout)
        └─► Phase 4-E (results overlay)
```

Phase 3 must be deployed before doing real end-to-end testing, but web work can proceed against mocked state in unit tests. The engine unit tests in Phase 2 are the highest-priority safety net and should be green before any other phase is considered done.

---

## Cross-Cutting Notes

- **`isAllPlayersReady`** in `match.helpers.ts`: already n-agnostic. No change needed.
- **Lobby component**: already uses `@for` over `players` array. No change needed.
- **`handleDisconnect`** in `ws/index.ts`: already n-agnostic. No change needed.
- **Abandon timer**: `players.every(p => !p.connected)` is already n-agnostic. No change needed.
- **DB schema**: no changes needed. `match_players.slot` is an integer column and accepts 3 or 4 without a migration. The new `matchMode` field lives in `state_json` (JSONB), not in a typed column, so no migration is needed there either.
- **`docs/todos.md`**: After implementing, remove any FFA-related entries added during work and add any new deferred items discovered.
