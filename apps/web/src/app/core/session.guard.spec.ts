import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { type ActivatedRouteSnapshot, type RouterStateSnapshot, Router, convertToParamMap } from '@angular/router';
import { of, throwError, type Observable } from 'rxjs';
import { sessionGuard } from './session.guard';
import { SessionStoreService } from './session-store.service';
import { MatchApiService } from './match-api.service';
import { MatchSocketService } from './match-socket.service';
import type { MatchState } from '@bingo/shared';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
    matchMode: 'ffa',
    status: 'Lobby',
    players: [{ playerId: 'p1', clientId: 'c1', slot: 1, alias: 'Host', connected: false }],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: { seed: 1, cells: [] },
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function makeRoute(matchId: string): ActivatedRouteSnapshot {
  return { paramMap: convertToParamMap({ matchId }) } as unknown as ActivatedRouteSnapshot;
}

function setupGuard(opts: {
  sessionMatchId?: string | null;
  getMatchReturn?: unknown;
  socketStatus?: 'connected' | 'connecting' | 'disconnected';
  persistedJoinCode?: string;
}) {
  const matchIdSignal       = signal<string | null>(opts.sessionMatchId ?? null);
  const playerIdSignal      = signal<string | null>(null);
  const joinCodeSignal      = signal<string | null>(null);
  const matchStateSignal    = signal<MatchState | null>(null);
  const connectionStatus    = signal(opts.socketStatus ?? 'connected');
  const mockGetMatch        = vi.fn();
  const mockConnect         = vi.fn();
  const mockNavigate        = vi.fn();
  const mockGetPersistedSession = vi.fn().mockReturnValue(
    opts.persistedJoinCode ? { matchId: opts.sessionMatchId ?? 'match-1', route: '/lobby', joinCode: opts.persistedJoinCode } : null,
  );

  if (opts.getMatchReturn !== undefined) {
    mockGetMatch.mockReturnValue(opts.getMatchReturn);
  }

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          matchId:              matchIdSignal,
          playerId:             playerIdSignal,
          joinCode:             joinCodeSignal,
          matchState:           matchStateSignal,
          alias:                signal(null),
          clear:                vi.fn(),
          saveAlias:            vi.fn(),
          saveSession:          vi.fn(),
          getPersistedSession:  mockGetPersistedSession,
        },
      },
      { provide: MatchApiService,    useValue: { getMatch: mockGetMatch } },
      { provide: MatchSocketService, useValue: { connect: mockConnect, disconnect: vi.fn(), connectionStatus } },
      { provide: Router,             useValue: { navigate: mockNavigate } },
    ],
  });

  return { matchIdSignal, playerIdSignal, joinCodeSignal, matchStateSignal, mockGetMatch, mockConnect, mockNavigate, mockGetPersistedSession };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

describe('sessionGuard — pass-through', () => {
  it('returns true synchronously when session matchId matches route', () => {
    setupGuard({ sessionMatchId: 'match-1' });
    const result = TestBed.runInInjectionContext(() => sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot));
    expect(result).toBe(true);
  });

  it('does not call getMatch when session already matches', () => {
    const { mockGetMatch } = setupGuard({ sessionMatchId: 'match-1' });
    void TestBed.runInInjectionContext(() => sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot));
    expect(mockGetMatch).not.toHaveBeenCalled();
  });
});

describe('sessionGuard — reconnect on re-entry', () => {
  it('reconnects socket when matchId matches but socket is disconnected', () => {
    const { mockConnect } = setupGuard({ sessionMatchId: 'match-1', socketStatus: 'disconnected' });
    void TestBed.runInInjectionContext(() => sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot));
    expect(mockConnect).toHaveBeenCalledWith('match-1');
  });

  it('does not reconnect when matchId matches and socket is already connected', () => {
    const { mockConnect } = setupGuard({ sessionMatchId: 'match-1', socketStatus: 'connected' });
    void TestBed.runInInjectionContext(() => sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('does not reconnect when matchId matches and socket is still connecting', () => {
    const { mockConnect } = setupGuard({ sessionMatchId: 'match-1', socketStatus: 'connecting' });
    void TestBed.runInInjectionContext(() => sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot));
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('sessionGuard — hydration (empty store)', () => {
  it('calls getMatch with the route matchId', () => {
    const state = makeState();
    const { mockGetMatch } = setupGuard({ getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state }) });
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
    );
    expect(mockGetMatch).toHaveBeenCalledWith('match-1');
  });

  it('writes matchId, playerId, matchState to store on success', () => {
    const state = makeState();
    const { matchIdSignal, playerIdSignal, matchStateSignal } = setupGuard({
      getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state }),
    });
    let allowed: boolean | undefined;
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(v => (allowed = v)),
    );
    expect(allowed).toBe(true);
    expect(matchIdSignal()).toBe('match-1');
    expect(playerIdSignal()).toBe('p1');
    expect(matchStateSignal()).toEqual(state);
  });

  it('connects the socket on success', () => {
    const state = makeState();
    const { mockConnect } = setupGuard({
      getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state }),
    });
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
    );
    expect(mockConnect).toHaveBeenCalledWith('match-1');
  });

  it('restores joinCode from persisted session when present', () => {
    const state = makeState();
    const { joinCodeSignal } = setupGuard({
      getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state }),
      persistedJoinCode: 'SAVED1',
    });
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
    );
    expect(joinCodeSignal()).toBe('SAVED1');
  });

  it('does not set joinCode when persisted session has none', () => {
    const state = makeState();
    const { joinCodeSignal } = setupGuard({
      getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state }),
    });
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
    );
    expect(joinCodeSignal()).toBeNull();
  });
});

describe('sessionGuard — hydration (mismatched store)', () => {
  it('calls getMatch when session has a different matchId', () => {
    const state = makeState();
    const { mockGetMatch } = setupGuard({
      sessionMatchId: 'other-match',
      getMatchReturn: of({ matchId: 'match-1', playerId: 'p1', state }),
    });
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(),
    );
    expect(mockGetMatch).toHaveBeenCalledWith('match-1');
  });
});

describe('sessionGuard — error cases', () => {
  it('redirects to / with state.error=forbidden and emits false on FORBIDDEN', () => {
    const { mockNavigate } = setupGuard({
      getMatchReturn: throwError(() => ({ code: 'FORBIDDEN', message: '' })),
    });
    let allowed: boolean | undefined;
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(v => (allowed = v)),
    );
    expect(allowed).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith(['/'], { state: { error: 'forbidden' } });
  });

  it('redirects to / without query params and emits false on MATCH_NOT_FOUND', () => {
    const { mockNavigate } = setupGuard({
      getMatchReturn: throwError(() => ({ code: 'MATCH_NOT_FOUND', message: '' })),
    });
    let allowed: boolean | undefined;
    TestBed.runInInjectionContext(() =>
      (sessionGuard(makeRoute('match-1'), null as unknown as RouterStateSnapshot) as Observable<boolean>).subscribe(v => (allowed = v)),
    );
    expect(allowed).toBe(false);
    expect(mockNavigate).toHaveBeenCalledWith(['/']);
  });
});
