import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { JoinComponent } from './join';
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

function setup(code: string, initialAlias: string | null = 'TestAlias') {
  const aliasSignal      = signal(initialAlias);
  const matchIdSignal    = signal<string | null>(null);
  const playerIdSignal   = signal<string | null>(null);
  const joinCodeSignal   = signal<string | null>(null);
  const matchStateSignal = signal<MatchState | null>(null);

  const mockResolveCode = vi.fn();
  const mockJoinMatch   = vi.fn();
  const mockNavigate    = vi.fn();

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
        },
      },
      {
        provide: MatchApiService,
        useValue: { resolveJoinCode: mockResolveCode, joinMatch: mockJoinMatch },
      },
      { provide: Router, useValue: { navigate: mockNavigate } },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: of(convertToParamMap({ code })) },
      },
    ],
  });

  // Component constructor runs here
  const fixture = TestBed.createComponent(JoinComponent);
  const comp    = fixture.componentInstance;

  return {
    fixture, comp,
    aliasSignal, matchIdSignal, playerIdSignal, joinCodeSignal, matchStateSignal,
    mockResolveCode, mockJoinMatch, mockNavigate,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.clearAllMocks();
});

describe('JoinComponent — null alias redirect', () => {
  it('redirects to / with joinCode query param when alias is null', () => {
    const { mockNavigate } = setup('ABC123', null);
    expect(mockNavigate).toHaveBeenCalledWith(['/'], { queryParams: { joinCode: 'ABC123' } });
  });

  it('does not call resolveJoinCode when alias is null', () => {
    const { mockResolveCode } = setup('ABC123', null);
    expect(mockResolveCode).not.toHaveBeenCalled();
  });
});

describe('JoinComponent — successful join', () => {
  it('writes session; effect navigates to lobby on success (socket connected by guard)', () => {
    const mockResolveCode  = vi.fn().mockReturnValue(of({ matchId: 'match-1' }));
    const mockJoinMatch    = vi.fn().mockReturnValue(of({ matchId: 'match-1', playerId: 'p2', state: makeState() }));
    const mockNavigate     = vi.fn();
    const aliasSignal      = signal<string | null>('TestAlias');
    const matchIdSignal    = signal<string | null>(null);
    const playerIdSignal   = signal<string | null>(null);
    const joinCodeSignal   = signal<string | null>(null);
    const matchStateSignal = signal<MatchState | null>(null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionStoreService,
          useValue: { alias: aliasSignal, matchId: matchIdSignal, playerId: playerIdSignal, joinCode: joinCodeSignal, matchState: matchStateSignal },
        },
        { provide: MatchApiService, useValue: { resolveJoinCode: mockResolveCode, joinMatch: mockJoinMatch } },
        { provide: Router, useValue: { navigate: mockNavigate } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ code: 'XYZABC' })) } },
      ],
    });
    TestBed.createComponent(JoinComponent);
    TestBed.flushEffects();

    expect(mockResolveCode).toHaveBeenCalledWith('XYZABC');
    expect(mockJoinMatch).toHaveBeenCalledWith('match-1', 'TestAlias', 'XYZABC');
    expect(matchIdSignal()).toBe('match-1');
    expect(playerIdSignal()).toBe('p2');
    expect(joinCodeSignal()).toBe('XYZABC');
    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-1']);
  });
});

describe('JoinComponent — error states', () => {
  function setupWithError(code: string, errorCode: string) {
    const mockResolveCode = vi.fn().mockReturnValue(throwError(() => ({ code: errorCode, message: '' })));
    const mockNavigate    = vi.fn();
    const aliasSignal     = signal<string | null>('TestAlias');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionStoreService,
          useValue: { alias: aliasSignal, matchId: signal(null), playerId: signal(null), joinCode: signal(null), matchState: signal(null) },
        },
        { provide: MatchApiService, useValue: { resolveJoinCode: mockResolveCode, joinMatch: vi.fn() } },
        { provide: Router, useValue: { navigate: mockNavigate } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ code })) } },
      ],
    });
    const fixture = TestBed.createComponent(JoinComponent);
    return fixture.componentInstance;
  }

  it('MATCH_NOT_FOUND — shows correct message', () => {
    const comp = setupWithError('ABC123', 'MATCH_NOT_FOUND');
    expect(comp.error()).toBe('This match no longer exists.');
    expect(comp.loading()).toBe(false);
  });

  it('MATCH_FULL — shows correct message', () => {
    const comp = setupWithError('ABC123', 'MATCH_FULL');
    expect(comp.error()).toBe('This match is already full.');
  });

  it('JOIN_CODE_EXPIRED — shows correct message', () => {
    const comp = setupWithError('ABC123', 'JOIN_CODE_EXPIRED');
    expect(comp.error()).toBe('This invite link has expired.');
  });

  it('MATCH_NOT_JOINABLE — shows correct message', () => {
    const comp = setupWithError('ABC123', 'MATCH_NOT_JOINABLE');
    expect(comp.error()).toBe('This match has already started.');
  });

  it('JOIN_CODE_INVALID — shows correct message', () => {
    const comp = setupWithError('ABC123', 'JOIN_CODE_INVALID');
    expect(comp.error()).toBe('This invite code is not valid.');
  });

  it('CLIENT_CONFLICT — shows correct message and exposes matchId when getMatch also fails', () => {
    const mockResolveCode = vi.fn().mockReturnValue(of({ matchId: 'match-99' }));
    const mockJoinMatch   = vi.fn().mockReturnValue(throwError(() => ({ code: 'CLIENT_CONFLICT', message: '' })));
    const mockGetMatch    = vi.fn().mockReturnValue(throwError(() => ({ code: 'FORBIDDEN', message: '' })));
    const aliasSignal     = signal<string | null>('TestAlias');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionStoreService,
          useValue: { alias: aliasSignal, matchId: signal(null), playerId: signal(null), joinCode: signal(null), matchState: signal(null) },
        },
        { provide: MatchApiService, useValue: { resolveJoinCode: mockResolveCode, joinMatch: mockJoinMatch, getMatch: mockGetMatch } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ code: 'ABC123' })) } },
      ],
    });
    const comp = TestBed.createComponent(JoinComponent).componentInstance;

    expect(comp.error()).toBe('You are already in this match.');
    expect(comp.conflictMatchId()).toBe('match-99');
    expect(comp.loading()).toBe(false);
  });

  it('CLIENT_CONFLICT — auto-navigates to lobby when getMatch succeeds', () => {
    const state           = makeState();
    const mockResolveCode = vi.fn().mockReturnValue(of({ matchId: 'match-99' }));
    const mockJoinMatch   = vi.fn().mockReturnValue(throwError(() => ({ code: 'CLIENT_CONFLICT', message: '' })));
    const mockGetMatch    = vi.fn().mockReturnValue(of({ matchId: 'match-99', playerId: 'p1', state: makeState({ matchId: 'match-99' }) }));
    const matchIdSignal   = signal<string | null>(null);
    const matchStateSignal = signal<MatchState | null>(null);
    const mockNavigate    = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionStoreService,
          useValue: { alias: signal<string | null>('TestAlias'), matchId: matchIdSignal, playerId: signal(null), joinCode: signal(null), matchState: matchStateSignal },
        },
        { provide: MatchApiService, useValue: { resolveJoinCode: mockResolveCode, joinMatch: mockJoinMatch, getMatch: mockGetMatch } },
        { provide: Router, useValue: { navigate: mockNavigate } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ code: 'ABC123' })) } },
      ],
    });
    TestBed.createComponent(JoinComponent);
    TestBed.flushEffects();

    expect(mockGetMatch).toHaveBeenCalledWith('match-99');
    expect(matchIdSignal()).toBe('match-99');
    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-99']);
  });
});

describe('JoinComponent — navigateToMatch', () => {
  it('navigates to /lobby/:matchId when conflictMatchId is set', () => {
    const mockResolveCode = vi.fn().mockReturnValue(of({ matchId: 'match-99' }));
    const mockJoinMatch   = vi.fn().mockReturnValue(throwError(() => ({ code: 'CLIENT_CONFLICT', message: '' })));
    const mockGetMatch    = vi.fn().mockReturnValue(throwError(() => ({ code: 'FORBIDDEN', message: '' })));
    const mockNavigate    = vi.fn();
    const aliasSignal     = signal<string | null>('TestAlias');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionStoreService,
          useValue: { alias: aliasSignal, matchId: signal(null), playerId: signal(null), joinCode: signal(null), matchState: signal(null) },
        },
        { provide: MatchApiService, useValue: { resolveJoinCode: mockResolveCode, joinMatch: mockJoinMatch, getMatch: mockGetMatch } },
        { provide: Router, useValue: { navigate: mockNavigate } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ code: 'ABC123' })) } },
      ],
    });
    const comp = TestBed.createComponent(JoinComponent).componentInstance;

    // Clear navigate calls from constructor (alias redirect or auto-join)
    mockNavigate.mockClear();
    comp.navigateToMatch();

    expect(mockNavigate).toHaveBeenCalledWith(['/lobby', 'match-99']);
  });
});
