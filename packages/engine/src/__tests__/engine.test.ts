import { describe, it, expect } from 'vitest';
import { applyEvent, validateEvent, checkWin, EngineError } from '../engine.js';
import type { MatchState, Cell, Player, BingoCard } from '@bingo/shared';
import type { ClientMessage } from '@bingo/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST_CLIENT = 'client-host';
const GUEST_CLIENT = 'client-guest';
const HOST_ID = 'player-host';
const GUEST_ID = 'player-guest';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const HOST: Player = { playerId: HOST_ID, clientId: HOST_CLIENT, slot: 1, alias: null, connected: true };
const GUEST: Player = { playerId: GUEST_ID, clientId: GUEST_CLIENT, slot: 2, alias: null, connected: true };

function makeCell(index: number, markedBy: string | null = null): Cell {
  return { index, goal: `Goal ${index}`, markedBy };
}

function makeCard(overrides?: Partial<BingoCard>): BingoCard {
  return {
    seed: 42,
    cells: Array.from({ length: 25 }, (_, i) => makeCell(i)),
    ...overrides,
  };
}

function makeState(overrides?: Partial<MatchState>): MatchState {
  return {
    matchId: 'match-id',
    status: 'Lobby',
    players: [HOST, GUEST],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: makeCard(),
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

const BASE = { matchId: 'match-id', eventId: 'evt-id' };

const sync = (clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'SYNC_STATE', clientId, payload: {} });

const setReady = (ready: boolean, clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'SET_READY', clientId, payload: { ready } });

const startMatch = (clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'START_MATCH', clientId, payload: {} });

const markCell = (cellIndex: number, clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'MARK_CELL', clientId, payload: { cellIndex } });

const unmarkCell = (cellIndex: number, clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'UNMARK_CELL', clientId, payload: { cellIndex } });

const reshuffleBoard = (clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'RESHUFFLE_BOARD', clientId, payload: {} });

const backToLobby = (clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'BACK_TO_LOBBY', clientId, payload: {} });

const rematch = (clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'REMATCH', clientId, payload: {} });

// ---------------------------------------------------------------------------
// Error assertion helper
// ---------------------------------------------------------------------------

function expectEngineError(fn: () => void, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(EngineError);
  expect((thrown as EngineError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// validateEvent
// ---------------------------------------------------------------------------

describe('validateEvent', () => {
  describe('SYNC_STATE', () => {
    it('passes in Lobby', () => {
      expect(() => validateEvent(makeState(), sync())).not.toThrow();
    });
    it('passes in InProgress', () => {
      expect(() => validateEvent(makeState({ status: 'InProgress' }), sync())).not.toThrow();
    });
    it('passes in Completed', () => {
      expect(() => validateEvent(makeState({ status: 'Completed' }), sync())).not.toThrow();
    });
  });

  describe('SET_READY', () => {
    it('passes in Lobby', () => {
      expect(() => validateEvent(makeState(), setReady(true))).not.toThrow();
    });
    it('throws INVALID_STATE in InProgress', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'InProgress' }), setReady(true)),
        'INVALID_STATE',
      );
    });
  });

  describe('START_MATCH', () => {
    function readyState(): MatchState {
      return makeState({
        readyStates: { [HOST_ID]: true, [GUEST_ID]: true },
      });
    }

    it('passes when host, 2 players, all ready', () => {
      expect(() => validateEvent(readyState(), startMatch())).not.toThrow();
    });
    it('throws NOT_AUTHORIZED for guest', () => {
      expectEngineError(() => validateEvent(readyState(), startMatch(GUEST_CLIENT)), 'NOT_AUTHORIZED');
    });
    it('throws INVALID_STATE when a player is not ready', () => {
      const state = makeState({ readyStates: { [HOST_ID]: true } });
      expectEngineError(() => validateEvent(state, startMatch()), 'INVALID_STATE');
    });
    it('throws INVALID_STATE with only 1 player', () => {
      const state = makeState({
        players: [HOST],
        readyStates: { [HOST_ID]: true },
      });
      expectEngineError(() => validateEvent(state, startMatch()), 'INVALID_STATE');
    });
    it('throws INVALID_STATE if not in Lobby', () => {
      const state = makeState({
        status: 'InProgress',
        readyStates: { [HOST_ID]: true, [GUEST_ID]: true },
      });
      expectEngineError(() => validateEvent(state, startMatch()), 'INVALID_STATE');
    });
  });

  describe('MARK_CELL', () => {
    it('passes on an unmarked cell in InProgress', () => {
      expect(() =>
        validateEvent(makeState({ status: 'InProgress' }), markCell(0)),
      ).not.toThrow();
    });
    it('throws INVALID_STATE on an already-marked cell', () => {
      const cells = Array.from({ length: 25 }, (_, i) =>
        makeCell(i, i === 5 ? HOST_ID : null),
      );
      const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
      expectEngineError(() => validateEvent(state, markCell(5)), 'INVALID_STATE');
    });
    it('throws INVALID_STATE in Lobby', () => {
      expectEngineError(() => validateEvent(makeState(), markCell(0)), 'INVALID_STATE');
    });
  });

  describe('UNMARK_CELL', () => {
    it('passes when caller owns the mark', () => {
      const cells = Array.from({ length: 25 }, (_, i) =>
        makeCell(i, i === 3 ? HOST_ID : null),
      );
      const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
      expect(() => validateEvent(state, unmarkCell(3))).not.toThrow();
    });
    it('throws INVALID_STATE when another player owns the cell', () => {
      const cells = Array.from({ length: 25 }, (_, i) =>
        makeCell(i, i === 3 ? GUEST_ID : null),
      );
      const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
      expectEngineError(() => validateEvent(state, unmarkCell(3)), 'INVALID_STATE');
    });
    it('throws INVALID_STATE on an unmarked cell', () => {
      const state = makeState({ status: 'InProgress' });
      expectEngineError(() => validateEvent(state, unmarkCell(0)), 'INVALID_STATE');
    });
  });

  describe('RESHUFFLE_BOARD', () => {
    it('passes with no cells marked', () => {
      expect(() =>
        validateEvent(makeState({ status: 'InProgress' }), reshuffleBoard()),
      ).not.toThrow();
    });
    it('throws INVALID_STATE if any cell is marked', () => {
      const cells = Array.from({ length: 25 }, (_, i) =>
        makeCell(i, i === 0 ? HOST_ID : null),
      );
      const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
      expectEngineError(() => validateEvent(state, reshuffleBoard()), 'INVALID_STATE');
    });
    it('throws NOT_AUTHORIZED for guest', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'InProgress' }), reshuffleBoard(GUEST_CLIENT)),
        'NOT_AUTHORIZED',
      );
    });
  });

  describe('BACK_TO_LOBBY', () => {
    it('passes from InProgress', () => {
      expect(() =>
        validateEvent(makeState({ status: 'InProgress' }), backToLobby()),
      ).not.toThrow();
    });
    it('passes from Completed', () => {
      expect(() =>
        validateEvent(makeState({ status: 'Completed' }), backToLobby()),
      ).not.toThrow();
    });
    it('throws INVALID_STATE from Lobby', () => {
      expectEngineError(() => validateEvent(makeState(), backToLobby()), 'INVALID_STATE');
    });
    it('throws NOT_AUTHORIZED for guest', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'InProgress' }), backToLobby(GUEST_CLIENT)),
        'NOT_AUTHORIZED',
      );
    });
  });

  describe('REMATCH', () => {
    it('passes from Completed with both connected', () => {
      expect(() =>
        validateEvent(makeState({ status: 'Completed' }), rematch()),
      ).not.toThrow();
    });
    it('throws INVALID_STATE from InProgress', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'InProgress' }), rematch()),
        'INVALID_STATE',
      );
    });
    it('throws NOT_AUTHORIZED for guest', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'Completed' }), rematch(GUEST_CLIENT)),
        'NOT_AUTHORIZED',
      );
    });
    it('throws INVALID_STATE when a player is disconnected', () => {
      const state = makeState({
        status: 'Completed',
        players: [HOST, { ...GUEST, connected: false }],
      });
      expectEngineError(() => validateEvent(state, rematch()), 'INVALID_STATE');
    });
  });

  describe('unknown clientId', () => {
    it('throws INVALID_EVENT', () => {
      expectEngineError(
        () => validateEvent(makeState(), sync('unknown-client')),
        'INVALID_EVENT',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// applyEvent
// ---------------------------------------------------------------------------

describe('applyEvent', () => {
  it('SET_READY — updates ready state for caller; other states unchanged', () => {
    const state = makeState({
      readyStates: { [GUEST_ID]: true },
    });
    const next = applyEvent(state, setReady(true));
    expect(next.readyStates[HOST_ID]).toBe(true);
    expect(next.readyStates[GUEST_ID]).toBe(true);
  });

  it('SET_READY — sets ready to false', () => {
    const state = makeState({ readyStates: { [HOST_ID]: true } });
    const next = applyEvent(state, setReady(false));
    expect(next.readyStates[HOST_ID]).toBe(false);
  });

  it('START_MATCH — status becomes InProgress', () => {
    const newCard = makeCard({ seed: 99 });
    const next = applyEvent(makeState(), startMatch(), { nowIso: '2024-01-01T00:00:00Z', newCard });
    expect(next.status).toBe('InProgress');
  });

  it('START_MATCH — card is replaced by ctx.newCard', () => {
    const newCard = makeCard({ seed: 99 });
    const next = applyEvent(makeState(), startMatch(), { nowIso: '2024-01-01T00:00:00Z', newCard });
    expect(next.card).toEqual(newCard);
  });

  it('START_MATCH — timer.startedAt matches ctx.nowIso', () => {
    const now = '2024-06-15T12:00:00Z';
    const next = applyEvent(makeState(), startMatch(), { nowIso: now, newCard: makeCard() });
    expect(next.timer.startedAt).toBe(now);
  });

  it('MARK_CELL — correct cell markedBy set to caller playerId', () => {
    const state = makeState({ status: 'InProgress' });
    const next = applyEvent(state, markCell(7));
    expect(next.card.cells[7]?.markedBy).toBe(HOST_ID);
  });

  it('MARK_CELL — other cells unchanged', () => {
    const state = makeState({ status: 'InProgress' });
    const next = applyEvent(state, markCell(7));
    const others = next.card.cells.filter((c) => c.index !== 7);
    expect(others.every((c) => c.markedBy === null)).toBe(true);
  });

  it('UNMARK_CELL — cell markedBy becomes null', () => {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i === 3 ? HOST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    const next = applyEvent(state, unmarkCell(3));
    expect(next.card.cells[3]?.markedBy).toBeNull();
  });

  it('RESHUFFLE_BOARD — card replaced by ctx.newCard; timer reset', () => {
    const cells = Array.from({ length: 25 }, (_, i) => makeCell(i));
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    const newCard = makeCard({ seed: 7 });
    const now = '2024-06-15T12:00:00Z';
    const next = applyEvent(state, reshuffleBoard(), { nowIso: now, newCard });
    expect(next.card).toEqual(newCard);
    expect(next.timer.startedAt).toBe(now);
  });

  it('BACK_TO_LOBBY — status becomes Lobby', () => {
    const next = applyEvent(makeState({ status: 'InProgress' }), backToLobby());
    expect(next.status).toBe('Lobby');
  });

  it('BACK_TO_LOBBY — all marks cleared', () => {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i % 2 === 0 ? HOST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    const next = applyEvent(state, backToLobby());
    expect(next.card.cells.every((c) => c.markedBy === null)).toBe(true);
  });

  it('BACK_TO_LOBBY — readyStates cleared', () => {
    const state = makeState({
      status: 'InProgress',
      readyStates: { [HOST_ID]: true, [GUEST_ID]: true },
    });
    const next = applyEvent(state, backToLobby());
    expect(next.readyStates).toEqual({});
  });

  it('BACK_TO_LOBBY — result set to null', () => {
    const state = makeState({
      status: 'Completed',
      result: { winnerId: HOST_ID, reason: 'line' },
    });
    const next = applyEvent(state, backToLobby());
    expect(next.result).toBeNull();
  });

  it('REMATCH — status becomes InProgress', () => {
    const next = applyEvent(makeState({ status: 'Completed' }), rematch(), {
      nowIso: '2024-01-01T00:00:00Z',
    });
    expect(next.status).toBe('InProgress');
  });

  it('REMATCH — marks cleared', () => {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 5 ? HOST_ID : null),
    );
    const state = makeState({ status: 'Completed', card: makeCard({ cells }) });
    const next = applyEvent(state, rematch(), { nowIso: '2024-01-01T00:00:00Z' });
    expect(next.card.cells.every((c) => c.markedBy === null)).toBe(true);
  });

  it('REMATCH — result set to null', () => {
    const state = makeState({
      status: 'Completed',
      result: { winnerId: HOST_ID, reason: 'majority' },
    });
    const next = applyEvent(state, rematch(), { nowIso: '2024-01-01T00:00:00Z' });
    expect(next.result).toBeNull();
  });

  it('REMATCH — uses ctx.newCard when provided', () => {
    const newCard = makeCard({ seed: 999 });
    const state = makeState({ status: 'Completed', card: makeCard({ seed: 55 }) });
    const next = applyEvent(state, rematch(), { nowIso: '2024-01-01T00:00:00Z', newCard });
    expect(next.card).toEqual(newCard);
  });

  it('REMATCH — falls back to clearing marks on existing card when ctx.newCard not provided', () => {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 5 ? HOST_ID : null),
    );
    const state = makeState({ status: 'Completed', card: makeCard({ seed: 55, cells }) });
    const next = applyEvent(state, rematch(), { nowIso: '2024-01-01T00:00:00Z' });
    expect(next.card.seed).toBe(55);
    expect(next.card.cells.every((c) => c.markedBy === null)).toBe(true);
  });

  it('input state is never mutated', () => {
    const state = makeState({ status: 'InProgress' });
    const snapshot = JSON.parse(JSON.stringify(state)) as MatchState;
    applyEvent(state, markCell(0));
    applyEvent(state, setReady(true));
    expect(state).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// checkWin
// ---------------------------------------------------------------------------

describe('checkWin', () => {
  /** Build a board where the given indices are all marked by playerId. */
  function markedState(indices: number[], playerId = HOST_ID): MatchState {
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, indices.includes(i) ? playerId : null),
    );
    return makeState({ status: 'InProgress', card: makeCard({ cells }) });
  }

  it('returns null for an empty board', () => {
    expect(checkWin(makeState({ status: 'InProgress' }))).toBeNull();
  });

  it('returns null in non-InProgress status', () => {
    const cells = Array.from({ length: 25 }, (_, i) => makeCell(i, HOST_ID));
    const state = makeState({ status: 'Lobby', card: makeCard({ cells }) });
    expect(checkWin(state)).toBeNull();
  });

  describe('row wins', () => {
    it.each([
      [0, [0, 1, 2, 3, 4]],
      [1, [5, 6, 7, 8, 9]],
      [2, [10, 11, 12, 13, 14]],
      [3, [15, 16, 17, 18, 19]],
      [4, [20, 21, 22, 23, 24]],
    ])('row %i', (_, indices) => {
      const result = checkWin(markedState(indices));
      expect(result).toEqual({ winnerId: HOST_ID, reason: 'line' });
    });
  });

  describe('column wins', () => {
    it.each([
      [0, [0, 5, 10, 15, 20]],
      [1, [1, 6, 11, 16, 21]],
      [2, [2, 7, 12, 17, 22]],
      [3, [3, 8, 13, 18, 23]],
      [4, [4, 9, 14, 19, 24]],
    ])('column %i', (_, indices) => {
      const result = checkWin(markedState(indices));
      expect(result).toEqual({ winnerId: HOST_ID, reason: 'line' });
    });
  });

  describe('diagonal wins', () => {
    it('top-left to bottom-right diagonal', () => {
      const result = checkWin(markedState([0, 6, 12, 18, 24]));
      expect(result).toEqual({ winnerId: HOST_ID, reason: 'line' });
    });
    it('top-right to bottom-left diagonal', () => {
      const result = checkWin(markedState([4, 8, 12, 16, 20]));
      expect(result).toEqual({ winnerId: HOST_ID, reason: 'line' });
    });
  });

  it('line with mixed ownership returns null', () => {
    // Row 0: cells 0-3 by HOST, cell 4 by GUEST
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 4 ? HOST_ID : i === 4 ? GUEST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    expect(checkWin(state)).toBeNull();
  });

  it('12 cells for one player returns null (no line)', () => {
    // 12 cells spread to avoid any line: rows 0-2 with 4 cells each
    const indices = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13];
    expect(checkWin(markedState(indices))).toBeNull();
  });

  it('13 cells for one player (no line) returns majority win', () => {
    // 4+4+4+1 = 13 cells; no row/column/diagonal completed
    const indices = [0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 15];
    const result = checkWin(markedState(indices));
    expect(result).toEqual({ winnerId: HOST_ID, reason: 'majority' });
  });

  it('line win takes priority over simultaneous majority win', () => {
    // 14 cells including a complete row 0 (line) and majority (14 >= 13)
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15];
    const result = checkWin(markedState(indices));
    expect(result).toEqual({ winnerId: HOST_ID, reason: 'line' });
  });

  it('marks split evenly returns null', () => {
    // Even indices → HOST (12 cells), odd indices → GUEST (12 cells), index 12 → unmarked.
    // Checkerboard pattern guarantees neither player completes any row, column, or diagonal.
    const hostIndices = [0, 2, 4, 6, 8, 10, 14, 16, 18, 20, 22, 24];
    const guestIndices = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(
        i,
        hostIndices.includes(i) ? HOST_ID : guestIndices.includes(i) ? GUEST_ID : null,
      ),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    expect(checkWin(state)).toBeNull();
  });
});
