import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db/index.js', () => ({
  db: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../match-registry.js', () => ({
  getMatch: vi.fn(),
  setMatch: vi.fn(),
  broadcastToMatch: vi.fn(),
}));

import request from 'supertest';
import { db } from '../db/index.js';
import { getMatch } from '../match-registry.js';
import { createApp } from '../app.js';
import type { MatchState } from '@bingo/shared';

const app = createApp();

const HOST_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const GUEST_CLIENT_ID = '00000000-0000-0000-0000-000000000002';
const HOST_PLAYER_ID = '00000000-0000-0000-0000-000000000010';
const MATCH_ID = '00000000-0000-0000-0000-000000000099';

function makeState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: MATCH_ID,
    matchMode: 'ffa',
    status: 'Lobby',
    players: [{ playerId: HOST_PLAYER_ID, clientId: HOST_CLIENT_ID, slot: 1, alias: 'Host', connected: false }],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: {
      seed: 12345,
      cells: Array.from({ length: 25 }, (_, i) => ({ index: i, goal: `Goal ${i}`, markedBy: null })),
    },
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function makeTransactionClient() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
}

describe('POST /matches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db as any).connect.mockResolvedValue(makeTransactionClient());
  });

  it('returns 201 with matchId, joinCode, and initial Lobby state defaulting to stopwatch', async () => {
    const res = await request(app)
      .post('/matches')
      .set('X-Client-Id', HOST_CLIENT_ID)
      .send({ alias: 'HostPlayer' });

    expect(res.status).toBe(201);
    expect(res.body.matchId).toBeDefined();
    expect(res.body.joinCode).toBeDefined();
    expect(res.body.joinUrl).toBeDefined();
    expect(res.body.state.status).toBe('Lobby');
    expect(res.body.state.players).toHaveLength(1);
    expect(res.body.state.players[0].alias).toBe('HostPlayer');
    expect(res.body.state.players[0].slot).toBe(1);
    expect(res.body.state.lobbySettings.timerMode).toBe('stopwatch');
    expect(res.body.state.lobbySettings.countdownDurationMs).toBeNull();
  });

  it('returns 400 when X-Client-Id header is missing', async () => {
    const res = await request(app)
      .post('/matches')
      .send({ alias: 'HostPlayer' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when alias is empty', async () => {
    const res = await request(app)
      .post('/matches')
      .set('X-Client-Id', HOST_CLIENT_ID)
      .send({ alias: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when X-Client-Id is not a UUID', async () => {
    const res = await request(app)
      .post('/matches')
      .set('X-Client-Id', 'not-a-uuid')
      .send({ alias: 'HostPlayer' });

    expect(res.status).toBe(400);
  });
});

describe('POST /matches/:id/join', () => {
  const validJoinCode = 'ABC123';
  const futureExpiry = new Date(Date.now() + 30 * 60 * 1000);
  const pastExpiry = new Date(Date.now() - 1000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 and adds guest player to state', async () => {
    const state = makeState();
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: futureExpiry }],
    });
    (db as any).connect.mockResolvedValue(makeTransactionClient());
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({ alias: 'GuestPlayer' });

    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe(MATCH_ID);
    expect(res.body.playerId).toBeDefined();
    expect(res.body.state.players).toHaveLength(2);
    expect(res.body.state.players[1].alias).toBe('GuestPlayer');
    expect(res.body.state.players[1].slot).toBe(2);
  });

  it('accepts when provided joinCode matches', async () => {
    const state = makeState();
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: futureExpiry }],
    });
    (db as any).connect.mockResolvedValue(makeTransactionClient());
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({ alias: 'GuestPlayer', joinCode: validJoinCode });

    expect(res.status).toBe(200);
  });

  it('returns 404 when match does not exist', async () => {
    (db as any).query.mockResolvedValueOnce({ rows: [] });
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({ alias: 'GuestPlayer' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MATCH_NOT_FOUND');
  });

  it('returns 409 when match is not in Lobby', async () => {
    const state = makeState({ status: 'InProgress' });
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: futureExpiry }],
    });
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({ alias: 'GuestPlayer' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATCH_NOT_JOINABLE');
  });

  it('returns 409 when match already has two players', async () => {
    const state = makeState({
      players: [
        { playerId: HOST_PLAYER_ID, clientId: HOST_CLIENT_ID, slot: 1, alias: 'Host', connected: false },
        { playerId: '00000000-0000-0000-0000-000000000011', clientId: GUEST_CLIENT_ID, slot: 2, alias: 'Guest', connected: false },
      ],
    });
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: futureExpiry }],
    });
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', '00000000-0000-0000-0000-000000000003')
      .send({ alias: 'ThirdPlayer' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MATCH_FULL');
  });

  it('returns 409 when clientId is already a participant', async () => {
    const state = makeState();
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: futureExpiry }],
    });
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', HOST_CLIENT_ID) // same as host
      .send({ alias: 'SameClient' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CLIENT_CONFLICT');
  });

  it('returns 410 when join code has expired', async () => {
    const state = makeState();
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: pastExpiry }],
    });
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({ alias: 'GuestPlayer' });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('JOIN_CODE_EXPIRED');
  });

  it('returns 400 when provided joinCode does not match', async () => {
    const state = makeState();
    (db as any).query.mockResolvedValueOnce({
      rows: [{ state_json: state, join_code: validJoinCode, join_code_expires_at: futureExpiry }],
    });
    (getMatch as any).mockReturnValue(undefined);

    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({ alias: 'GuestPlayer', joinCode: 'WRONG1' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('JOIN_CODE_INVALID');
  });

  it('returns 400 when alias is missing', async () => {
    const res = await request(app)
      .post(`/matches/${MATCH_ID}/join`)
      .set('X-Client-Id', GUEST_CLIENT_ID)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /matches/by-code/:code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with matchId when code is valid', async () => {
    (db as any).query.mockResolvedValueOnce({
      rows: [{ match_id: MATCH_ID, join_code_expires_at: new Date(Date.now() + 10_000) }],
    });

    const res = await request(app)
      .get('/matches/by-code/ABC123')
      .set('X-Client-Id', HOST_CLIENT_ID);

    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe(MATCH_ID);
  });

  it('returns 404 MATCH_NOT_FOUND when no match has this code', async () => {
    (db as any).query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/matches/by-code/BADCOD')
      .set('X-Client-Id', HOST_CLIENT_ID);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MATCH_NOT_FOUND');
  });

  it('returns 410 JOIN_CODE_EXPIRED when code is expired', async () => {
    (db as any).query.mockResolvedValueOnce({
      rows: [{ match_id: MATCH_ID, join_code_expires_at: new Date(Date.now() - 1000) }],
    });

    const res = await request(app)
      .get('/matches/by-code/EXPCOD')
      .set('X-Client-Id', HOST_CLIENT_ID);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('JOIN_CODE_EXPIRED');
  });

  it('returns 400 when X-Client-Id is missing', async () => {
    const res = await request(app).get('/matches/by-code/ABC123');
    expect(res.status).toBe(400);
  });
});

describe('GET /matches/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with matchId, playerId, and state (from registry)', async () => {
    const state = makeState();
    (getMatch as any).mockReturnValue({ state, sockets: new Map() });

    const res = await request(app)
      .get(`/matches/${MATCH_ID}`)
      .set('X-Client-Id', HOST_CLIENT_ID);

    expect(res.status).toBe(200);
    expect(res.body.matchId).toBe(MATCH_ID);
    expect(res.body.playerId).toBe(HOST_PLAYER_ID);
    expect(res.body.state).toBeDefined();
  });

  it('returns 200 loading state from DB when not in registry', async () => {
    const state = makeState();
    (getMatch as any).mockReturnValue(undefined);
    (db as any).query.mockResolvedValueOnce({ rows: [{ state_json: state }] });

    const res = await request(app)
      .get(`/matches/${MATCH_ID}`)
      .set('X-Client-Id', HOST_CLIENT_ID);

    expect(res.status).toBe(200);
    expect(res.body.playerId).toBe(HOST_PLAYER_ID);
  });

  it('returns 404 when match not found in registry or DB', async () => {
    (getMatch as any).mockReturnValue(undefined);
    (db as any).query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/matches/${MATCH_ID}`)
      .set('X-Client-Id', HOST_CLIENT_ID);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MATCH_NOT_FOUND');
  });

  it('returns 403 when clientId is not a participant', async () => {
    const state = makeState();
    (getMatch as any).mockReturnValue({ state, sockets: new Map() });

    const res = await request(app)
      .get(`/matches/${MATCH_ID}`)
      .set('X-Client-Id', '00000000-0000-0000-0000-000000000099');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('returns 400 when X-Client-Id header is missing', async () => {
    const res = await request(app).get(`/matches/${MATCH_ID}`);

    expect(res.status).toBe(400);
  });
});
