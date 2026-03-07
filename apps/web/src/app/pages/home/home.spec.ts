import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError, EMPTY } from 'rxjs';
import { HomeComponent } from './home';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchApiService } from '../../core/match-api.service';
import { MatchSocketService } from '../../core/match-socket.service';
import type { MatchState } from '@bingo/shared';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: 'match-1',
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

function setup(
  queryParams: Record<string, string> = {},
  initialAlias: string | null = 'TestAlias',
  persistedSession: { matchId: string; route: '/lobby' | '/match' } | null = null,
) {
  const aliasSignal      = signal(initialAlias);
  const matchIdSignal    = signal<string | null>(null);
  const playerIdSignal   = signal<string | null>(null);
  const joinCodeSignal   = signal<string | null>(null);
  const matchStateSignal = signal<MatchState | null>(null);

  const mockSaveAlias           = vi.fn((a: string) => aliasSignal.set(a));
  const mockClear               = vi.fn();
  const mockGetPersistedSession = vi.fn(() => persistedSession);
  const mockClearSession        = vi.fn();
  const mockCreateMatch            = vi.fn();
  const mockResolveCode            = vi.fn();
  const mockJoinMatch              = vi.fn();
  const mockConnect                = vi.fn();
  const mockDisconnect             = vi.fn();
  const mockNavigate               = vi.fn();

  TestBed.configureTestingModule({
    providers: [
      {
        provide: SessionStoreService,
        useValue: {
          alias:      aliasSignal,
          matchId:    matchIdSignal,
          playerId:   playerIdSignal,
          joinCode:   joinCodeSignal,
          matchState: matchStateSignal,
          saveAlias:           mockSaveAlias,
          clear:               mockClear,
          getPersistedSession: mockGetPersistedSession,
          clearSession:        mockClearSession,
        },
      },
      {
        provide: MatchApiService,
        useValue: {
          createMatch:     mockCreateMatch,
          joinMatch:       mockJoinMatch,
          resolveJoinCode: mockResolveCode,
          getMatch:        vi.fn(),
        },
      },
      {
        provide: MatchSocketService,
        useValue: {
          connect:          mockConnect,
          disconnect:       mockDisconnect,
          connectionStatus: signal('disconnected'),
          messages$:        EMPTY,
        },
      },
      { provide: Router, useValue: { navigate: mockNavigate } },
      {
        provide: ActivatedRoute,
        useValue: { queryParamMap: of(convertToParamMap(queryParams)) },
      },
    ],
  });

  const fixture = TestBed.createComponent(HomeComponent);
  const comp    = fixture.componentInstance;

  return {
    fixture, comp,
    aliasSignal, matchIdSignal, playerIdSignal, joinCodeSignal, matchStateSignal,
    mockSaveAlias, mockClear, mockGetPersistedSession,
    mockClearSession, mockCreateMatch, mockResolveCode, mockJoinMatch,
    mockConnect, mockDisconnect, mockNavigate,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

describe('HomeComponent — alias initialisation', () => {
  it('does not generate alias when one is already stored', () => {
    const { mockSaveAlias } = setup({}, 'StoredAlias');
    expect(mockSaveAlias).not.toHaveBeenCalled();
  });

  it('generates and saves alias when store has none', () => {
    const { mockSaveAlias } = setup({}, null);
    expect(mockSaveAlias).toHaveBeenCalledOnce();
    expect(typeof mockSaveAlias.mock.calls[0]![0]).toBe('string');
    expect((mockSaveAlias.mock.calls[0]![0] as string).length).toBeGreaterThan(0);
  });

  it('onAliasChange saves trimmed value to store', () => {
    const { comp, mockSaveAlias } = setup();
    comp.onAliasChange({ target: { value: '  NewName  ' } } as unknown as Event);
    expect(mockSaveAlias).toHaveBeenCalledWith('NewName');
  });

  it('onAliasChange does not save empty value', () => {
    const { comp, mockSaveAlias } = setup();
    comp.onAliasChange({ target: { value: '   ' } } as unknown as Event);
    expect(mockSaveAlias).not.toHaveBeenCalled();
  });
});

describe('HomeComponent — WebSocket disconnect on init', () => {
  it('always disconnects the socket on load, even without query params', () => {
    const { mockDisconnect } = setup();
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });

  it('disconnects before processing query params', () => {
    const { mockDisconnect } = setup({ abandoned: 'true' });
    expect(mockDisconnect).toHaveBeenCalledOnce();
  });
});

describe('HomeComponent — query param handling', () => {
  it('shows abandoned banner and clears session for ?abandoned=true', () => {
    const { comp, mockClear, mockDisconnect } = setup({ abandoned: 'true' });
    expect(comp.abandonedBanner()).toBe(true);
    expect(mockClear).toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('pre-fills join code and switches to join mode for ?joinCode param', () => {
    const { comp } = setup({ joinCode: 'abc123' });
    expect(comp.joinCodeInput()).toBe('ABC123');
    expect(comp.mode()).toBe('join');
  });
});

describe('HomeComponent — rejoin banner', () => {
  it('shows rejoin banner when a valid persisted lobby session exists', () => {
    const { comp } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/lobby' });
    expect(comp.rejoinSession()).toEqual({ matchId: 'match-old', route: '/lobby' });
  });

  it('shows rejoin banner when a valid persisted match session exists', () => {
    const { comp } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/match' });
    expect(comp.rejoinSession()).toEqual({ matchId: 'match-old', route: '/match' });
  });

  it('does not show rejoin banner when no persisted session', () => {
    const { comp } = setup({}, 'TestAlias', null);
    expect(comp.rejoinSession()).toBeNull();
  });

  it('rejoin() navigates to /lobby/:matchId for a lobby session', () => {
    const { comp, mockNavigate } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/lobby' });
    comp.rejoin();
    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-old']);
  });

  it('rejoin() navigates to /match/:matchId for a match session', () => {
    const { comp, mockNavigate } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/match' });
    comp.rejoin();
    expect(mockNavigate).toHaveBeenCalledWith(['/match', 'match-old']);
  });

  it('dismissRejoin() clears session and hides banner', () => {
    const { comp, mockClearSession } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/lobby' });
    comp.dismissRejoin();
    expect(mockClearSession).toHaveBeenCalledOnce();
    expect(comp.rejoinSession()).toBeNull();
  });
});

describe('HomeComponent — create flow', () => {
  it('calls createMatch, writes session, connects socket, and navigates to lobby', () => {
    const state = makeState();
    const { comp, mockCreateMatch, mockConnect, mockNavigate,
            matchIdSignal, playerIdSignal, joinCodeSignal } = setup();
    mockCreateMatch.mockReturnValue(of({ matchId: 'match-1', joinCode: 'XYZ123', joinUrl: '/join/XYZ123', state }));

    comp.createMatch();

    expect(mockCreateMatch).toHaveBeenCalledWith('TestAlias');
    expect(matchIdSignal()).toBe('match-1');
    expect(playerIdSignal()).toBe('p1');
    expect(joinCodeSignal()).toBe('XYZ123');
    expect(mockConnect).toHaveBeenCalledWith('match-1');
    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-1']);
  });

  it('shows error message and clears loading on failure', () => {
    const { comp, mockCreateMatch } = setup();
    mockCreateMatch.mockReturnValue(throwError(() => ({ code: 'MATCH_NOT_FOUND', message: 'Unexpected error' })));

    comp.createMatch();

    expect(comp.createError()).toBe('Unexpected error');
    expect(comp.loading()).toBe(false);
  });
});

describe('HomeComponent — join-by-code flow', () => {
  it('resolves code then joins, writes session, connects socket, and navigates to lobby', () => {
    const state = makeState({ matchId: 'match-2' });
    const { comp, mockResolveCode, mockJoinMatch, mockConnect, mockNavigate,
            matchIdSignal, playerIdSignal } = setup();
    mockResolveCode.mockReturnValue(of({ matchId: 'match-2' }));
    mockJoinMatch.mockReturnValue(of({ matchId: 'match-2', playerId: 'p2', state }));

    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();

    expect(mockResolveCode).toHaveBeenCalledWith('ABCDEF');
    expect(mockJoinMatch).toHaveBeenCalledWith('match-2', 'TestAlias', 'ABCDEF');
    expect(matchIdSignal()).toBe('match-2');
    expect(playerIdSignal()).toBe('p2');
    expect(mockConnect).toHaveBeenCalledWith('match-2');
    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-2']);
  });

  it('shows validation error when code is shorter than 6 chars without calling API', () => {
    const { comp, mockResolveCode } = setup();
    comp.joinCodeInput.set('AB');
    comp.joinByCode();
    expect(mockResolveCode).not.toHaveBeenCalled();
    expect(comp.joinError()).toBeTruthy();
  });

  it('shows MATCH_NOT_FOUND error message', () => {
    const { comp, mockResolveCode } = setup();
    mockResolveCode.mockReturnValue(throwError(() => ({ code: 'MATCH_NOT_FOUND', message: '' })));
    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();
    expect(comp.joinError()).toBe('This match no longer exists.');
    expect(comp.loading()).toBe(false);
  });

  it('shows MATCH_FULL error message', () => {
    const { comp, mockResolveCode } = setup();
    mockResolveCode.mockReturnValue(throwError(() => ({ code: 'MATCH_FULL', message: '' })));
    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();
    expect(comp.joinError()).toBe('This match is already full.');
  });

  it('shows JOIN_CODE_EXPIRED error message', () => {
    const { comp, mockResolveCode } = setup();
    mockResolveCode.mockReturnValue(throwError(() => ({ code: 'JOIN_CODE_EXPIRED', message: '' })));
    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();
    expect(comp.joinError()).toBe('This invite link has expired.');
  });

  it('shows CLIENT_CONFLICT error message', () => {
    const { comp, mockResolveCode, mockJoinMatch } = setup();
    mockResolveCode.mockReturnValue(of({ matchId: 'match-1' }));
    mockJoinMatch.mockReturnValue(throwError(() => ({ code: 'CLIENT_CONFLICT', message: '' })));
    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();
    expect(comp.joinError()).toBe('You are already in this match.');
  });

  it('onJoinCodeInput uppercases the value', () => {
    const { comp } = setup();
    comp.onJoinCodeInput({ target: { value: 'abc123' } } as unknown as Event);
    expect(comp.joinCodeInput()).toBe('ABC123');
  });
});
