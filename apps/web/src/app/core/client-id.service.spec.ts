import { TestBed } from '@angular/core/testing';
import { ClientIdService } from './client-id.service';

const STORAGE_KEY = 'bingo_client_id';

describe('ClientIdService', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('generates a UUID on first use', () => {
    const svc = TestBed.inject(ClientIdService);
    expect(svc.clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('persists the clientId to localStorage', () => {
    const svc = TestBed.inject(ClientIdService);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(svc.clientId);
  });

  it('returns the same clientId on second injection', () => {
    const first  = TestBed.inject(ClientIdService);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const second = TestBed.inject(ClientIdService);
    expect(second.clientId).toBe(first.clientId);
  });
});
