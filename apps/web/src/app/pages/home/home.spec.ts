import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HomeComponent } from './home';
import { SessionStoreService } from '../../core/session-store.service';
import { MatchApiService } from '../../core/match-api.service';
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
  persistedSession: { matchId: string; route: '/lobby' | '/match'; joinCode?: string } | null = null,
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
  const mockCreateMatch         = vi.fn();
  const mockNavigate            = vi.fn();

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
        useValue: { createMatch: mockCreateMatch },
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
    mockClearSession, mockCreateMatch, mockNavigate,
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

describe('HomeComponent — query param handling', () => {
  it('shows abandoned banner and clears session for ?abandoned=true', () => {
    const { comp, mockClear } = setup({ abandoned: 'true' });
    expect(comp.abandonedBanner()).toBe(true);
    expect(mockClear).toHaveBeenCalled();
  });

  it('shows forbidden banner and clears session for ?error=forbidden', () => {
    const { comp, mockClear } = setup({ error: 'forbidden' });
    expect(comp.forbiddenBanner()).toBe(true);
    expect(mockClear).toHaveBeenCalled();
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
    expect(comp.rejoinSession()).toMatchObject({ matchId: 'match-old', route: '/lobby' });
  });

  it('shows rejoin banner when a valid persisted match session exists', () => {
    const { comp } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/match' });
    expect(comp.rejoinSession()).toMatchObject({ matchId: 'match-old', route: '/match' });
  });

  it('does not show rejoin banner when no persisted session', () => {
    const { comp } = setup({}, 'TestAlias', null);
    expect(comp.rejoinSession()).toBeNull();
  });

  it('rejoin() navigates to /join/:code when joinCode is available', () => {
    const { comp, mockNavigate } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/lobby', joinCode: 'XYZ123' });
    comp.rejoin();
    expect(mockNavigate).toHaveBeenCalledWith(['/join', 'XYZ123']);
  });

  it('rejoin() falls back to direct route navigation when joinCode is absent', () => {
    const { comp, mockNavigate } = setup({}, 'TestAlias', { matchId: 'match-old', route: '/lobby' });
    comp.rejoin();
    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-old']);
  });

  it('rejoin() falls back to /match route when joinCode absent and route is /match', () => {
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

describe('HomeComponent — alias validation', () => {
  it('shows aliasError and does not navigate when alias is empty on create', () => {
    const { comp, mockCreateMatch } = setup({}, '');
    comp.createMatch();
    expect(comp.aliasError()).toBeTruthy();
    expect(mockCreateMatch).not.toHaveBeenCalled();
  });

  it('shows aliasError and does not navigate when alias is empty on join', () => {
    const { comp, mockNavigate } = setup({}, '');
    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();
    expect(comp.aliasError()).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clears aliasError when a valid alias is entered via onAliasChange', () => {
    const { comp } = setup({}, '');
    comp.createMatch(); // triggers aliasError
    expect(comp.aliasError()).toBeTruthy();
    comp.onAliasChange({ target: { value: 'ValidName' } } as unknown as Event);
    expect(comp.aliasError()).toBeNull();
  });
});

describe('HomeComponent — create flow', () => {
  it('calls createMatch, writes session, and navigates to lobby', () => {
    const state = makeState();
    const { comp, mockCreateMatch, mockNavigate,
            matchIdSignal, playerIdSignal, joinCodeSignal } = setup();
    mockCreateMatch.mockReturnValue(of({ matchId: 'match-1', joinCode: 'XYZ123', joinUrl: '/join/XYZ123', state }));

    comp.createMatch();

    expect(mockCreateMatch).toHaveBeenCalledWith('TestAlias');
    expect(matchIdSignal()).toBe('match-1');
    expect(playerIdSignal()).toBe('p1');
    expect(joinCodeSignal()).toBe('XYZ123');
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
  it('navigates to /join/:code when alias and code are valid', () => {
    const { comp, mockNavigate } = setup();
    comp.joinCodeInput.set('ABCDEF');
    comp.joinByCode();
    expect(mockNavigate).toHaveBeenCalledWith(['/join', 'ABCDEF']);
  });

  it('shows validation error when code is shorter than 6 chars without navigating', () => {
    const { comp, mockNavigate } = setup();
    comp.joinCodeInput.set('AB');
    comp.joinByCode();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(comp.joinError()).toBeTruthy();
  });

  it('onJoinCodeInput uppercases the value', () => {
    const { comp } = setup();
    comp.onJoinCodeInput({ target: { value: 'abc123' } } as unknown as Event);
    expect(comp.joinCodeInput()).toBe('ABC123');
  });
});
