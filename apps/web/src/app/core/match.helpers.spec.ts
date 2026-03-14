import { getMyPlayer, isHost, isAllPlayersReady, buildClientMessage } from './match.helpers';
import type { MatchState, Player } from '@bingo/shared';

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
