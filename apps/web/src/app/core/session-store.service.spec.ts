import { TestBed } from '@angular/core/testing';
import { SessionStoreService } from './session-store.service';

const ALIAS_KEY   = 'bingo_alias';
const SESSION_KEY = 'bingo_session';

describe('SessionStoreService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('alias signal is null when localStorage is empty', () => {
    const svc = TestBed.inject(SessionStoreService);
    expect(svc.alias()).toBeNull();
  });

  it('alias signal is pre-populated from localStorage', () => {
    localStorage.setItem(ALIAS_KEY, 'CoolCreeper');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(SessionStoreService);
    expect(svc.alias()).toBe('CoolCreeper');
  });

  it('saveAlias persists to localStorage and updates signal', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveAlias('SwiftSword');
    expect(localStorage.getItem(ALIAS_KEY)).toBe('SwiftSword');
    expect(svc.alias()).toBe('SwiftSword');
  });

  it('clear() resets matchId, playerId, joinCode, and matchState signals', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.matchId.set('m1');
    svc.playerId.set('p1');
    svc.joinCode.set('ABC123');
    svc.matchState.set({} as any);

    svc.clear();

    expect(svc.matchId()).toBeNull();
    expect(svc.playerId()).toBeNull();
    expect(svc.joinCode()).toBeNull();
    expect(svc.matchState()).toBeNull();
  });

  it('clear() does not reset alias', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveAlias('HeroName');
    svc.clear();
    expect(svc.alias()).toBe('HeroName');
  });

  it('clear() also removes persisted session', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveSession('m1', '/lobby');
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();

    svc.clear();

    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('SessionStoreService — persisted session', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('getPersistedSession() returns null when nothing is stored', () => {
    const svc = TestBed.inject(SessionStoreService);
    expect(svc.getPersistedSession()).toBeNull();
  });

  it('saveSession(/lobby) + getPersistedSession() returns matchId and route', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveSession('match-abc', '/lobby');
    expect(svc.getPersistedSession()).toEqual({ matchId: 'match-abc', route: '/lobby' });
  });

  it('saveSession(/match) + getPersistedSession() returns matchId and route', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveSession('match-abc', '/match');
    expect(svc.getPersistedSession()).toEqual({ matchId: 'match-abc', route: '/match' });
  });

  it('saveSession overwrites a previous entry', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveSession('match-abc', '/lobby');
    svc.saveSession('match-abc', '/match');
    expect(svc.getPersistedSession()).toEqual({ matchId: 'match-abc', route: '/match' });
  });

  it('getPersistedSession() returns null when session is older than 5 minutes', () => {
    const svc = TestBed.inject(SessionStoreService);
    const expired = { matchId: 'old-match', route: '/lobby', savedAt: Date.now() - 6 * 60 * 1000 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(expired));
    expect(svc.getPersistedSession()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('getPersistedSession() returns null on malformed JSON', () => {
    const svc = TestBed.inject(SessionStoreService);
    localStorage.setItem(SESSION_KEY, 'not-json');
    expect(svc.getPersistedSession()).toBeNull();
  });

  it('clearSession() removes the stored entry', () => {
    const svc = TestBed.inject(SessionStoreService);
    svc.saveSession('m1', '/match');
    svc.clearSession();
    expect(svc.getPersistedSession()).toBeNull();
  });
});
