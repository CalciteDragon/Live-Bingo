import { TestBed } from '@angular/core/testing';
import { SessionStoreService } from './session-store.service';

const ALIAS_KEY = 'bingo_alias';

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
});
