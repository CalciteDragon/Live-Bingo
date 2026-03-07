import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatchComponent } from './match';
import { SessionStoreService } from '../../core/session-store.service';
import type { MatchState } from '@bingo/shared';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    status: 'InProgress',
    players: [
      { playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host',  connected: true },
      { playerId: 'p2', clientId: 'c2', slot: 2, alias: 'Guest', connected: true },
    ],
    readyStates: { p1: true, p2: true },
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: { seed: 42, cells: [] },
    timer: { mode: 'stopwatch', startedAt: '2024-01-01T00:00:00.000Z', countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function setup(initialState: MatchState | null = makeState()) {
  const matchStateSignal = signal<MatchState | null>(initialState);
  const matchIdSignal    = signal<string | null>(initialState?.matchId ?? null);
  const mockNavigate     = vi.fn();
  const mockSaveSession  = vi.fn();
  const mockClearSession = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          matchState:    matchStateSignal,
          matchId:       matchIdSignal,
          saveSession:   mockSaveSession,
          clearSession:  mockClearSession,
        },
      },
      { provide: Router, useValue: { navigate: mockNavigate } },
    ],
  });

  TestBed.createComponent(MatchComponent);

  return { matchStateSignal, matchIdSignal, mockNavigate, mockSaveSession, mockClearSession };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

describe('MatchComponent — session persistence', () => {
  it('saves /match session on load when status is InProgress', () => {
    const { mockSaveSession } = setup(makeState({ status: 'InProgress' }));
    expect(mockSaveSession).toHaveBeenCalledWith('match-1', '/match');
  });

  it('does not save session on load when status is not InProgress', () => {
    const { mockSaveSession } = setup(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));
    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it('does not save session on load when matchState is null', () => {
    const { mockSaveSession } = setup(null);
    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it('clears session when status becomes Completed', () => {
    const { matchStateSignal, mockClearSession } = setup();

    matchStateSignal.set(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));
    TestBed.flushEffects();

    expect(mockClearSession).toHaveBeenCalledOnce();
  });

  it('does not clear session when status is InProgress', () => {
    const { mockClearSession } = setup();
    TestBed.flushEffects();
    expect(mockClearSession).not.toHaveBeenCalled();
  });
});

describe('MatchComponent — status-route effect', () => {
  it('navigates to /lobby/:matchId when status becomes Lobby', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Lobby' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-1']);
  });

  it('navigates to / with ?abandoned=true when status becomes Abandoned', () => {
    const { matchStateSignal, mockNavigate } = setup();

    matchStateSignal.set(makeState({ matchId: 'match-1', status: 'Abandoned' }));
    TestBed.flushEffects();

    expect(mockNavigate).toHaveBeenCalledWith(['/'], { queryParams: { abandoned: true } });
  });

  it('does not navigate when status is InProgress', () => {
    const { mockNavigate } = setup(makeState({ status: 'InProgress' }));

    TestBed.flushEffects();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when status is Completed', () => {
    const { mockNavigate } = setup(makeState({ status: 'Completed', result: { winnerId: 'p1', reason: 'line' } }));

    TestBed.flushEffects();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate when matchState is null', () => {
    const { mockNavigate } = setup(null);

    TestBed.flushEffects();

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
