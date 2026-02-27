import { describe, it, expect } from 'vitest';
import { generateBoard } from '../board.js';

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

  it('same seed produces the same board (determinism)', () => {
    const a = generateBoard(5000);
    const b = generateBoard(5000);
    expect(a).toEqual(b);
  });

  it('different seeds produce different boards', () => {
    const a = generateBoard(1);
    const b = generateBoard(2);
    const aGoals = a.cells.map((c) => c.goal);
    const bGoals = b.cells.map((c) => c.goal);
    expect(aGoals).not.toEqual(bGoals);
  });
});
