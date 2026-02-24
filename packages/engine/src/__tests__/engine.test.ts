import { describe, it, expect } from 'vitest';
import { applyEvent, validateEvent, checkWin } from '../engine.js';

describe('engine stubs', () => {
  it('applyEvent is importable', () => {
    expect(typeof applyEvent).toBe('function');
  });

  it('checkWin is importable', () => {
    expect(typeof checkWin).toBe('function');
  });

  it('validateEvent is importable', () => {
    expect(typeof validateEvent).toBe('function');
  });
});
