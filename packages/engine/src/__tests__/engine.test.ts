import { describe, it, expect } from 'vitest';
import { applyEvent, validateEvent, checkWin, resolveTimerWinner, EngineError } from '../engine.js';
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
    matchMode: 'ffa',
    status: 'Lobby',
    players: [HOST, GUEST],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: makeCard(),
    timer: { mode: 'stopwatch', startedAt: null, stoppedAt: null, countdownDurationMs: null },
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

const kickPlayer = (playerId: string, clientId = HOST_CLIENT): ClientMessage =>
  ({ ...BASE, type: 'KICK_PLAYER', clientId, payload: { playerId } });

const setLobbySettings = (
  timerMode: 'stopwatch' | 'countdown',
  countdownDurationMs?: number,
  clientId = HOST_CLIENT,
): ClientMessage =>
  ({ ...BASE, type: 'SET_LOBBY_SETTINGS', clientId, payload: { timerMode, countdownDurationMs } });

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

  describe('SET_LOBBY_SETTINGS', () => {
    it('passes for host in Lobby', () => {
      expect(() => validateEvent(makeState(), setLobbySettings('stopwatch'))).not.toThrow();
    });
    it('passes for countdown with duration', () => {
      expect(() => validateEvent(makeState(), setLobbySettings('countdown', 300000))).not.toThrow();
    });
    it('throws INVALID_STATE when not in Lobby', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'InProgress' }), setLobbySettings('stopwatch')),
        'INVALID_STATE',
      );
    });
    it('throws NOT_AUTHORIZED for guest', () => {
      expectEngineError(
        () => validateEvent(makeState(), setLobbySettings('stopwatch', undefined, GUEST_CLIENT)),
        'NOT_AUTHORIZED',
      );
    });
    it('throws INVALID_EVENT for countdown without duration', () => {
      expectEngineError(
        () => validateEvent(makeState(), setLobbySettings('countdown')),
        'INVALID_EVENT',
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

  describe('KICK_PLAYER', () => {
    it('passes for host kicking a guest in Lobby', () => {
      expect(() => validateEvent(makeState(), kickPlayer(GUEST_ID))).not.toThrow();
    });
    it('throws INVALID_STATE when not in Lobby', () => {
      expectEngineError(
        () => validateEvent(makeState({ status: 'InProgress' }), kickPlayer(GUEST_ID)),
        'INVALID_STATE',
      );
    });
    it('throws NOT_AUTHORIZED for guest', () => {
      expectEngineError(
        () => validateEvent(makeState(), kickPlayer(HOST_ID, GUEST_CLIENT)),
        'NOT_AUTHORIZED',
      );
    });
    it('throws INVALID_EVENT when target player not found', () => {
      expectEngineError(
        () => validateEvent(makeState(), kickPlayer('00000000-0000-0000-0000-000000000099')),
        'INVALID_EVENT',
      );
    });
    it('throws INVALID_EVENT when trying to kick the host (slot 1)', () => {
      expectEngineError(
        () => validateEvent(makeState(), kickPlayer(HOST_ID)),
        'INVALID_EVENT',
      );
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
  it('SET_LOBBY_SETTINGS — updates lobbySettings and timer mode to stopwatch', () => {
    const state = makeState({ lobbySettings: { timerMode: 'countdown', countdownDurationMs: 300000 } });
    const next = applyEvent(state, setLobbySettings('stopwatch'));
    expect(next.lobbySettings).toEqual({ timerMode: 'stopwatch', countdownDurationMs: null });
    expect(next.timer.mode).toBe('stopwatch');
    expect(next.timer.countdownDurationMs).toBeNull();
  });

  it('SET_LOBBY_SETTINGS — updates lobbySettings and timer mode to countdown', () => {
    const next = applyEvent(makeState(), setLobbySettings('countdown', 600000));
    expect(next.lobbySettings).toEqual({ timerMode: 'countdown', countdownDurationMs: 600000 });
    expect(next.timer.mode).toBe('countdown');
    expect(next.timer.countdownDurationMs).toBe(600000);
  });

  it('SET_LOBBY_SETTINGS — does not affect other state', () => {
    const state = makeState({ readyStates: { [HOST_ID]: true } });
    const next = applyEvent(state, setLobbySettings('stopwatch'));
    expect(next.readyStates).toEqual(state.readyStates);
    expect(next.players).toEqual(state.players);
    expect(next.card).toEqual(state.card);
  });

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

  it('KICK_PLAYER — removes target from players array', () => {
    const state = makeState({ readyStates: { [GUEST_ID]: true } });
    const next = applyEvent(state, kickPlayer(GUEST_ID));
    expect(next.players).toHaveLength(1);
    expect(next.players[0]?.playerId).toBe(HOST_ID);
  });

  it('KICK_PLAYER — removes target from readyStates', () => {
    const state = makeState({ readyStates: { [HOST_ID]: true, [GUEST_ID]: true } });
    const next = applyEvent(state, kickPlayer(GUEST_ID));
    expect(next.readyStates[GUEST_ID]).toBeUndefined();
    expect(next.readyStates[HOST_ID]).toBe(true);
  });

  it('KICK_PLAYER — host and other state unaffected', () => {
    const state = makeState();
    const next = applyEvent(state, kickPlayer(GUEST_ID));
    expect(next.status).toBe('Lobby');
    expect(next.card).toEqual(state.card);
    expect(next.players.find((p) => p.playerId === HOST_ID)).toBeDefined();
  });

  it('KICK_PLAYER — does not mutate input state', () => {
    const state = makeState();
    applyEvent(state, kickPlayer(GUEST_ID));
    expect(state.players).toHaveLength(2);
    expect(Object.keys(state.readyStates)).toHaveLength(0);
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

  it('majority triggers when blanks < (1st_score - 2nd_score)', () => {
    // HOST=14, GUEST=5, blanks=6: diff=9, 6<9 → triggers
    // Cells avoid completing any row/column/diagonal for either player.
    // HOST: 1-4, 6-9, 11-14, 16-17; GUEST: 5,15,18,19,20; blank: 0,10,21-24
    const hostCells = new Set([1,2,3,4, 6,7,8,9, 11,12,13,14, 16,17]);
    const guestCells = new Set([5,15,18,19,20]);
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, hostCells.has(i) ? HOST_ID : guestCells.has(i) ? GUEST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    expect(checkWin(state)).toEqual({ winnerId: HOST_ID, reason: 'majority' });
  });

  it('majority does not trigger when blanks equals (1st_score - 2nd_score)', () => {
    // HOST=10, GUEST=5, blanks=10: diff=5, 10<5=false (boundary — exactly equal, no win)
    // HOST: 0-3, 5-8, 10-11; GUEST: 12-14, 16-17; blank: 4,9,15,18-24
    const hostCells = new Set([0,1,2,3, 5,6,7,8, 10,11]);
    const guestCells = new Set([12,13,14, 16,17]);
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, hostCells.has(i) ? HOST_ID : guestCells.has(i) ? GUEST_ID : null),
    );
    const state = makeState({ status: 'InProgress', card: makeCard({ cells }) });
    expect(checkWin(state)).toBeNull();
  });

  it('majority triggers for leading player in a 3-player match', () => {
    const P3_ID = 'player-3';
    const p3: Player = { playerId: P3_ID, clientId: 'client-3', slot: 3, alias: null, connected: true };
    // HOST=12, GUEST=4, P3=2, blanks=7: diff=12-4=8, 7<8 → triggers HOST win
    // HOST: 0-3, 5-8, 10-13; GUEST: 15-18; P3: 19,20; blank: 4,9,14,21-24
    const hostCells = new Set([0,1,2,3, 5,6,7,8, 10,11,12,13]);
    const guestCells = new Set([15,16,17,18]);
    const p3Cells = new Set([19,20]);
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, hostCells.has(i) ? HOST_ID : guestCells.has(i) ? GUEST_ID : p3Cells.has(i) ? P3_ID : null),
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
    // HOST: 0-3, 5-6, 10-13; GUEST: 7-9, 14-16; P3: 17-20; blank: 4,21-24
    const hostCells = new Set([0,1,2,3, 5,6, 10,11,12,13]);
    const guestCells = new Set([7,8,9, 14,15,16]);
    const p3Cells = new Set([17,18,19,20]);
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, hostCells.has(i) ? HOST_ID : guestCells.has(i) ? GUEST_ID : p3Cells.has(i) ? P3_ID : null),
    );
    const state = makeState({
      status: 'InProgress',
      players: [HOST, GUEST, p3],
      card: makeCard({ cells }),
    });
    expect(checkWin(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveTimerWinner
// ---------------------------------------------------------------------------

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
    // HOST=8, GUEST=8, P3=0 — HOST and GUEST tied for first
    const cells = Array.from({ length: 25 }, (_, i) =>
      makeCell(i, i < 8 ? HOST_ID : i < 16 ? GUEST_ID : null),
    );
    const state = makeState({ status: 'InProgress', players: [HOST, GUEST, p3], card: makeCard({ cells }) });
    expect(resolveTimerWinner(state)).toEqual({ winnerId: null, reason: 'timer_expiry' });
  });

  it('returns null on an empty board', () => {
    const state = makeState({ status: 'InProgress' });
    // all players at 0 — tie for first
    expect(resolveTimerWinner(state)).toEqual({ winnerId: null, reason: 'timer_expiry' });
  });
});
