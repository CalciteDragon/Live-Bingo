import type { BingoCard, Cell } from '@bingo/shared';
import { GOALS } from './goals.js';

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
 * Generate a deterministic 5×5 bingo card from a numeric seed.
 * The same seed always produces the same board.
 * @throws if the goals list has fewer than 25 entries (programming error)
 */
export function generateBoard(seed: number): BingoCard {
  if (GOALS.length < 25) {
    throw new Error(`goals list has only ${GOALS.length} entries; need at least 25`);
  }

  const rand = mulberry32(seed);
  const pool = [...GOALS];
  shuffle(pool, rand);

  const cells: Cell[] = pool.slice(0, 25).map((goal, index) => ({
    index,
    goal,
    markedBy: null,
  }));

  return { seed, cells };
}
