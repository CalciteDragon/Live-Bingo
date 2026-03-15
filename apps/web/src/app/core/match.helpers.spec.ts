import {
  getMyPlayer,
  isHost,
  isAllPlayersReady,
  buildClientMessage,
  SLOT_COLORS,
  buildPlayerColorMap,
  getPlayerRankings,
  ordinalLabel,
} from './match.helpers';
import type { MatchState, Player, Cell } from '@bingo/shared';

function makeCell(index: number, markedBy: string | null = null): Cell {
  return { index, goal: `Goal ${index}`, markedBy };
}

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    matchMode: 'ffa',
    status: 'Lobby',
    players: [],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: { seed: 1, cells: [] },
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

const p1: Player = { playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host', connected: true };
const p2: Player = { playerId: 'p2', clientId: 'c2', slot: 2, alias: 'Guest', connected: true };
const p3: Player = { playerId: 'p3', clientId: 'c3', slot: 3, alias: 'Third', connected: true };
const p4: Player = { playerId: 'p4', clientId: 'c4', slot: 4, alias: 'Fourth', connected: true };

describe('getMyPlayer', () => {
  it('returns the matching player', () => {
    const state = makeState({ players: [p1, p2] });
    expect(getMyPlayer(state, 'p1')).toEqual(p1);
  });

  it('returns undefined when player is not in the match', () => {
    const state = makeState({ players: [p1] });
    expect(getMyPlayer(state, 'p2')).toBeUndefined();
  });
});

describe('isHost', () => {
  it('returns true for slot-1 player', () => {
    const state = makeState({ players: [p1, p2] });
    expect(isHost(state, 'p1')).toBe(true);
  });

  it('returns false for slot-2 player', () => {
    const state = makeState({ players: [p1, p2] });
    expect(isHost(state, 'p2')).toBe(false);
  });

  it('returns false for unknown player', () => {
    const state = makeState({ players: [p1] });
    expect(isHost(state, 'unknown')).toBe(false);
  });
});

describe('isAllPlayersReady', () => {
  it('returns false when fewer than 2 players', () => {
    const state = makeState({ players: [p1], readyStates: { p1: true } });
    expect(isAllPlayersReady(state)).toBe(false);
  });

  it('returns false when one player is not ready', () => {
    const state = makeState({
      players: [p1, p2],
      readyStates: { p1: true, p2: false },
    });
    expect(isAllPlayersReady(state)).toBe(false);
  });

  it('returns true when both players are ready', () => {
    const state = makeState({
      players: [p1, p2],
      readyStates: { p1: true, p2: true },
    });
    expect(isAllPlayersReady(state)).toBe(true);
  });
});

describe('buildClientMessage', () => {
  it('includes type, matchId, clientId, eventId, and payload', () => {
    const msg = buildClientMessage('SET_READY', 'match-1', 'c1', { ready: true });
    expect(msg.type).toBe('SET_READY');
    expect(msg.matchId).toBe('match-1');
    expect(msg.clientId).toBe('c1');
    expect(msg.payload).toEqual({ ready: true });
    expect(msg.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a different eventId each call', () => {
    const a = buildClientMessage('SYNC_STATE', 'm', 'c', {});
    const b = buildClientMessage('SYNC_STATE', 'm', 'c', {});
    expect(a.eventId).not.toBe(b.eventId);
  });
});

describe('buildPlayerColorMap', () => {
  it('maps each player to their slot color', () => {
    const state = makeState({ players: [p1, p2] });
    expect(buildPlayerColorMap(state)).toEqual({
      p1: SLOT_COLORS[1],
      p2: SLOT_COLORS[2],
    });
  });

  it('returns empty map with no players', () => {
    const state = makeState({ players: [] });
    expect(buildPlayerColorMap(state)).toEqual({});
  });

  it('maps all 4 players to correct slot colors', () => {
    const state = makeState({ players: [p1, p2, p3, p4] });
    expect(buildPlayerColorMap(state)).toEqual({
      p1: SLOT_COLORS[1],
      p2: SLOT_COLORS[2],
      p3: SLOT_COLORS[3],
      p4: SLOT_COLORS[4],
    });
  });
});

describe('getPlayerRankings', () => {
  it('returns correct scores and ranks for 2 players, no tie', () => {
    const state = makeState({
      players: [p1, p2],
      card: { seed: 1, cells: [makeCell(0, 'p1'), makeCell(1, 'p1'), makeCell(2, 'p2')] },
    });
    const rankings = getPlayerRankings(state, 'p1');
    expect(rankings[0]).toEqual({
      playerId: 'p1', alias: 'Host', slot: 1, color: SLOT_COLORS[1], score: 2, rank: 1, isMe: true,
    });
    expect(rankings[1]).toEqual({
      playerId: 'p2', alias: 'Guest', slot: 2, color: SLOT_COLORS[2], score: 1, rank: 2, isMe: false,
    });
  });

  it('uses dense ranking when players tie for 2nd (both rank 2, next rank 3)', () => {
    const state = makeState({
      players: [p1, p2, p3],
      card: {
        seed: 1,
        cells: [
          makeCell(0, 'p1'), makeCell(1, 'p1'), makeCell(2, 'p1'), // p1: 3
          makeCell(3, 'p2'),                                        // p2: 1
          makeCell(4, 'p3'),                                        // p3: 1
        ],
      },
    });
    const rankings = getPlayerRankings(state, 'p1');
    expect(rankings[0]!.rank).toBe(1);
    expect(rankings[1]!.rank).toBe(2);
    expect(rankings[2]!.rank).toBe(2);
  });

  it('correctly sets isMe flag', () => {
    const state = makeState({ players: [p1, p2] });
    const rankings = getPlayerRankings(state, 'p2');
    expect(rankings.find(r => r.playerId === 'p1')?.isMe).toBe(false);
    expect(rankings.find(r => r.playerId === 'p2')?.isMe).toBe(true);
  });

  it('handles 4 players with correct dense ranking', () => {
    const state = makeState({
      players: [p1, p2, p3, p4],
      card: {
        seed: 1,
        cells: [
          makeCell(0, 'p1'), makeCell(1, 'p1'), // p1: 2
          makeCell(2, 'p2'),                     // p2: 1
          // p3, p4: 0
        ],
      },
    });
    const rankings = getPlayerRankings(state, 'p1');
    expect(rankings[0]!.playerId).toBe('p1');
    expect(rankings[0]!.rank).toBe(1);
    expect(rankings[1]!.rank).toBe(2);
    expect(rankings[2]!.rank).toBe(3);
    expect(rankings[3]!.rank).toBe(3);
  });
});

describe('ordinalLabel', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [21, '21st'],
  ])('rank %i → %s', (rank, expected) => {
    expect(ordinalLabel(rank)).toBe(expected);
  });
});
