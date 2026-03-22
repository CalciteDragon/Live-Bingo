import { describe, it, expect } from 'vitest';
import { generateBoard } from '../board.js';
import { GOALS } from '../goals.js';

describe('generateBoard', () => {
  it('returns exactly 25 cells', () => {
    const card = generateBoard(1);
    expect(card.cells).toHaveLength(25);
  });

  it('cell indices are 0–24 with no duplicates', () => {
    const card = generateBoard(42);
    const indices = card.cells.map((c) => c.index);
    expect(indices.sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
  });

  it('all goals within a board are unique', () => {
    const card = generateBoard(7);
    const goals = card.cells.map((c) => c.goal);
    expect(new Set(goals).size).toBe(25);
  });

  it('all cells start with markedBy: null', () => {
    const card = generateBoard(99);
    expect(card.cells.every((c) => c.markedBy === null)).toBe(true);
  });

  it('seed is preserved in the returned card', () => {
    const card = generateBoard(123);
    expect(card.seed).toBe(123);
  });

  it('all cells have a difficulty property in [0, 1]', () => {
    const card = generateBoard(77);
    for (const cell of card.cells) {
      expect(cell.difficulty).toBeGreaterThanOrEqual(0);
      expect(cell.difficulty).toBeLessThanOrEqual(1);
    }
  });

  it('each cell difficulty matches its goal difficulty from GOALS', () => {
    const card = generateBoard(55);
    const goalMap = new Map(GOALS.map((g) => [g.text, g.difficulty]));
    for (const cell of card.cells) {
      expect(cell.difficulty).toBe(goalMap.get(cell.goal));
    }
  });

  it('same seed + same settings produces the same board (determinism)', () => {
    const a = generateBoard(5000, 0.5, 0.175);
    const b = generateBoard(5000, 0.5, 0.175);
    expect(a).toEqual(b);
  });

  it('same seed + default settings produces the same board (default args)', () => {
    const a = generateBoard(5000);
    const b = generateBoard(5000, 0.5, 0.175);
    expect(a).toEqual(b);
  });

  it('same seed + different difficulty produces a different board', () => {
    const easy = generateBoard(42, 0.1, 0.175);
    const hard = generateBoard(42, 0.9, 0.175);
    const easyGoals = easy.cells.map((c) => c.goal);
    const hardGoals = hard.cells.map((c) => c.goal);
    expect(easyGoals).not.toEqual(hardGoals);
  });

  it('same seed + different spread produces a different board', () => {
    const narrow = generateBoard(42, 0.5, 0.05);
    const wide   = generateBoard(42, 0.5, 0.5);
    const narrowGoals = narrow.cells.map((c) => c.goal);
    const wideGoals   = wide.cells.map((c) => c.goal);
    expect(narrowGoals).not.toEqual(wideGoals);
  });

  it('different seeds produce different boards', () => {
    const a = generateBoard(1);
    const b = generateBoard(2);
    const aGoals = a.cells.map((c) => c.goal);
    const bGoals = b.cells.map((c) => c.goal);
    expect(aGoals).not.toEqual(bGoals);
  });

  it('center cell (index 12) has higher difficulty than the board average when difficulty < 1.0', () => {
    // With default settings (difficulty=0.5), center target = min(1.0, 0.5+0.175) = 0.675
    // so center should trend harder than the rest. Average over many seeds:
    const SEEDS = [1, 2, 3, 4, 5, 10, 42, 99, 1000, 9999];
    let centerSum = 0;
    let nonCenterSum = 0;
    for (const seed of SEEDS) {
      const card = generateBoard(seed, 0.5, 0.175);
      centerSum += card.cells[12]!.difficulty;
      nonCenterSum += card.cells
        .filter((c) => c.index !== 12)
        .reduce((sum, c) => sum + c.difficulty, 0) / 24;
    }
    const avgCenter    = centerSum / SEEDS.length;
    const avgNonCenter = nonCenterSum / SEEDS.length;
    expect(avgCenter).toBeGreaterThan(avgNonCenter);
  });
});
