import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatchApiService, type ApiError } from './match-api.service';
import { clientIdInterceptor } from './client-id.interceptor';
import { environment } from '../../environments/environment';
import type { CreateMatchResponse, JoinMatchResponse, GetMatchResponse, ResolveJoinCodeResponse, MatchState } from '@bingo/shared';

const BASE = environment.apiBaseUrl;

const mockMatchState: MatchState = {
  matchId: 'abc',
  matchMode: 'ffa',
  status: 'Lobby',
  players: [],
  readyStates: {},
  lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
  card: { seed: 1, cells: [] },
  timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
  result: null,
};

describe('MatchApiService', () => {
  let svc: MatchApiService;
  let controller: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([clientIdInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    svc        = TestBed.inject(MatchApiService);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    controller.verify();
    localStorage.clear();
  });

  it('createMatch posts to /matches and returns response', () => {
    const resp: CreateMatchResponse = { matchId: 'abc', joinCode: 'XYZ123', joinUrl: '/join/XYZ123', state: mockMatchState };
    let result: CreateMatchResponse | undefined;
    svc.createMatch('Player1').subscribe(r => (result = r));
    const req = controller.expectOne(`${BASE}/matches`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ alias: 'Player1' });
    req.flush(resp);
    expect(result).toEqual(resp);
  });

  it('joinMatch posts to /matches/:id/join', () => {
    const resp: JoinMatchResponse = { matchId: 'abc', playerId: 'p1', state: mockMatchState };
    let result: JoinMatchResponse | undefined;
    svc.joinMatch('abc', 'Player2', 'XYZ123').subscribe(r => (result = r));
    const req = controller.expectOne(`${BASE}/matches/abc/join`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ alias: 'Player2', joinCode: 'XYZ123' });
    req.flush(resp);
    expect(result).toEqual(resp);
  });

  it('getMatch calls GET /matches/:id', () => {
    const resp: GetMatchResponse = { matchId: 'abc', playerId: 'p1', state: mockMatchState };
    let result: GetMatchResponse | undefined;
    svc.getMatch('abc').subscribe(r => (result = r));
    const req = controller.expectOne(`${BASE}/matches/abc`);
    expect(req.request.method).toBe('GET');
    req.flush(resp);
    expect(result).toEqual(resp);
  });

  it('resolveJoinCode calls GET /matches/by-code/:code', () => {
    const resp: ResolveJoinCodeResponse = { matchId: 'abc' };
    let result: ResolveJoinCodeResponse | undefined;
    svc.resolveJoinCode('XYZ123').subscribe(r => (result = r));
    const req = controller.expectOne(`${BASE}/matches/by-code/XYZ123`);
    expect(req.request.method).toBe('GET');
    req.flush(resp);
    expect(result).toEqual(resp);
  });

  it('maps REST error codes including FORBIDDEN', () => {
    let err: ApiError | undefined;
    svc.getMatch('abc').subscribe({ error: (e: ApiError) => { err = e; } });
    const req = controller.expectOne(`${BASE}/matches/abc`);
    req.flush({ code: 'FORBIDDEN', message: 'Not a participant' }, { status: 403, statusText: 'Forbidden' });
    expect(err!.code).toBe('FORBIDDEN');
    expect(err!.message).toBe('Not a participant');
  });

  it('maps MATCH_NOT_FOUND error', () => {
    let err: ApiError | undefined;
    svc.getMatch('xyz').subscribe({ error: (e: ApiError) => { err = e; } });
    const req = controller.expectOne(`${BASE}/matches/xyz`);
    req.flush({ code: 'MATCH_NOT_FOUND', message: 'Not found' }, { status: 404, statusText: 'Not Found' });
    expect(err!.code).toBe('MATCH_NOT_FOUND');
  });
});
