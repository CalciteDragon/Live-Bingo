import { DEFAULT_DIFFICULTY, DEFAULT_DIFFICULTY_SPREAD, type BingoCard, type Cell } from '@bingo/shared';
import { GOALS } from './goals.js';
import type { Goal } from './goals.js';

const CENTER = 12;

/**
 * mulberry32 — a fast, seedable 32-bit PRNG.
 * Returns a function that yields values in [0, 1) on each call.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Unnormalized Gaussian weight: peaks at 1.0 when difficulty == target.
 * Goals 1σ away get weight ≈ 0.607; 2σ ≈ 0.135; 3σ ≈ 0.011.
 * Never returns exactly 0 (no hard exclusion).
 */
function gaussianWeight(difficulty: number, target: number, spread: number): number {
  const z = (difficulty - target) / spread;
  return Math.exp(-0.5 * z * z);
}

/**
 * Weighted pick: selects one index from the pool proportionally to its weight.
 * Returns the chosen index within `pool`.
 */
function pickWeighted(pool: Goal[], weights: number[], rand: () => number): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return i;
  }
  return pool.length - 1; // floating-point safety fallback
}

/**
 * Fisher-Yates shuffle (in-place) using the provided PRNG.
 */
function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/**
 * Generate a deterministic 5×5 bingo card.
 *
 * Goals are weighted toward `difficulty` via a Gaussian (bell curve).
 * The center cell (index 12) is biased one spread-unit harder than the target.
 *
 * PRNG call order is fixed: center pick → 24 sequential picks → shuffle.
 * The same seed + same settings always produces the same board.
 *
 * @throws if the goals list has fewer than 25 entries (programming error)
 */
export function generateBoard(
  seed: number,
  difficulty = DEFAULT_DIFFICULTY,
  spread = DEFAULT_DIFFICULTY_SPREAD,
): BingoCard {
  if (GOALS.length < 25) {
    throw new Error(`goals list has only ${GOALS.length} entries; need at least 25`);
  }

  const rand = mulberry32(seed);
  const pool: Goal[] = [...GOALS];

  // Phase 1 — Pick center cell with boosted difficulty target
  const centerTarget = Math.min(1.0, difficulty + spread);
  const centerWeights = pool.map((g) => gaussianWeight(g.difficulty, centerTarget, spread));
  const centerIdx = pickWeighted(pool, centerWeights, rand);
  const centerGoal = pool.splice(centerIdx, 1)[0]!;

  // Phase 2 — Pick 24 non-center goals using the base difficulty target
  const selected: Goal[] = [];
  for (let i = 0; i < 24; i++) {
    const weights = pool.map((g) => gaussianWeight(g.difficulty, difficulty, spread));
    const idx = pickWeighted(pool, weights, rand);
    selected.push(pool.splice(idx, 1)[0]!);
  }

  // Phase 3 — Shuffle selected positions (eliminates spatial clustering bias)
  shuffle(selected, rand);

  // Phase 4 — Assign to cells: center goes to index 12, selected fill the rest
  const cells: Cell[] = new Array(25);
  cells[CENTER] = { index: CENTER, goal: centerGoal.text, difficulty: centerGoal.difficulty, markedBy: null };

  let si = 0;
  for (let pos = 0; pos < 25; pos++) {
    if (pos === CENTER) continue;
    const g = selected[si++]!;
    cells[pos] = { index: pos, goal: g.text, difficulty: g.difficulty, markedBy: null };
  }

  return { seed, cells };
}
