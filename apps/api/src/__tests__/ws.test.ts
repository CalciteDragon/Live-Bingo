import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';

vi.mock('../db/index.js', () => ({
  db: { query: vi.fn(), connect: vi.fn() },
}));

import { db } from '../db/index.js';
import { handleUpgrade } from '../ws/index.js';
import { getMatch, setMatch, deleteMatch } from '../match-registry.js';
import type { MatchState } from '@bingo/shared';

// ─── Constants ───────────────────────────────────────────────────────────────

const MATCH_ID       = '00000000-0000-0000-0000-000000000001';
const HOST_CLIENT_ID = '00000000-0000-0000-0000-000000000002';
const HOST_PLAYER_ID = '00000000-0000-0000-0000-000000000003';
const GUEST_CLIENT_ID = '00000000-0000-0000-0000-000000000004';
const GUEST_PLAYER_ID = '00000000-0000-0000-0000-000000000005';
const EVENT_ID       = '00000000-0000-0000-0000-000000000010';

// ─── MockWebSocket ───────────────────────────────────────────────────────────

class MockWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  send = vi.fn();

  /** Simulate incoming message from the remote peer */
  receive(data: unknown): void {
    this.emit('message', JSON.stringify(data));
  }

  /** All messages sent so far, parsed from JSON */
  sent(): unknown[] {
    return this.send.mock.calls.map((args: unknown[]) => JSON.parse(args[0] as string));
  }

  /** Most recently sent message */
  lastSent(): Record<string, unknown> {
    const all = this.sent();
    return all[all.length - 1] as Record<string, unknown>;
  }
}

// ─── Infrastructure helpers ──────────────────────────────────────────────────

function makeTransactionClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
}

function makeMockWss(ws: MockWebSocket): WebSocketServer {
  return {
    handleUpgrade: vi.fn((_r: unknown, _s: unknown, _h: unknown, cb: (w: MockWebSocket) => void) => cb(ws)),
    emit: vi.fn(),
  } as unknown as WebSocketServer;
}

function makeReq(matchId: string, clientId: string): IncomingMessage {
  return { url: `/ws?matchId=${matchId}&clientId=${clientId}` } as IncomingMessage;
}

function makeSocket(): Duplex {
  return { write: vi.fn(), destroy: vi.fn() } as unknown as Duplex;
}

/** Flush pending microtasks for async chains behind event handlers */
async function flush(): Promise<void> {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

// ─── State factories ─────────────────────────────────────────────────────────

const BLANK_CELLS = Array.from({ length: 25 }, (_, i) => ({
  index: i, goal: `Goal ${i}`, markedBy: null as string | null,
}));

function makeLobbyState(overrides: Partial<MatchState> = {}): MatchState {
  return {
    matchId: MATCH_ID,
    status: 'Lobby',
    players: [{ playerId: HOST_PLAYER_ID, clientId: HOST_CLIENT_ID, slot: 1, alias: 'Host', connected: false }],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card: { seed: 1, cells: BLANK_CELLS.map(c => ({ ...c })) },
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
    ...overrides,
  };
}

function makeTwoPlayerLobbyState(overrides: Partial<MatchState> = {}): MatchState {
  return makeLobbyState({
    players: [
      { playerId: HOST_PLAYER_ID,  clientId: HOST_CLIENT_ID,  slot: 1, alias: 'Host',  connected: false },
      { playerId: GUEST_PLAYER_ID, clientId: GUEST_CLIENT_ID, slot: 2, alias: 'Guest', connected: false },
    ],
    ...overrides,
  });
}

function makeInProgressState(overrides: Partial<MatchState> = {}): MatchState {
  return makeTwoPlayerLobbyState({
    status: 'InProgress',
    readyStates: { [HOST_PLAYER_ID]: true, [GUEST_PLAYER_ID]: true },
    timer: { mode: 'stopwatch', startedAt: '2024-01-01T00:00:00.000Z', countdownDurationMs: null },
    ...overrides,
  });
}

// ─── Connection helper ───────────────────────────────────────────────────────

/**
 * Simulates a client connecting via WebSocket upgrade.
 * Returns the MockWebSocket with event handlers attached and send cleared.
 */
async function connectClient(clientId: string): Promise<MockWebSocket> {
  const ws = new MockWebSocket();
  handleUpgrade(makeMockWss(ws), makeReq(MATCH_ID, clientId), makeSocket(), Buffer.alloc(0));
  await flush();
  ws.send.mockClear();
  return ws;
}

// ─── Global setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (db as any).query.mockResolvedValue({ rows: [] });
  (db as any).connect.mockResolvedValue(makeTransactionClient());
});

afterEach(() => {
  deleteMatch(MATCH_ID);
  vi.useRealTimers();
});

// =============================================================================
// handleUpgrade — connection-time validation
// =============================================================================

describe('handleUpgrade', () => {
  it('rejects missing matchId with 400', () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const socket = makeSocket();
    const req = { url: `/ws?clientId=${HOST_CLIENT_ID}` } as IncomingMessage;
    handleUpgrade(makeMockWss(new MockWebSocket()), req, socket, Buffer.alloc(0));
    expect((socket as any).write).toHaveBeenCalledWith(expect.stringContaining('400'));
    expect((socket as any).destroy).toHaveBeenCalled();
  });

  it('rejects non-UUID matchId with 400', () => {
    const socket = makeSocket();
    const req = { url: `/ws?matchId=not-a-uuid&clientId=${HOST_CLIENT_ID}` } as IncomingMessage;
    handleUpgrade(makeMockWss(new MockWebSocket()), req, socket, Buffer.alloc(0));
    expect((socket as any).write).toHaveBeenCalledWith(expect.stringContaining('400'));
    expect((socket as any).destroy).toHaveBeenCalled();
  });

  it('rejects unknown match with 403', () => {
    // Registry is empty (no setMatch call)
    const socket = makeSocket();
    handleUpgrade(makeMockWss(new MockWebSocket()), makeReq(MATCH_ID, HOST_CLIENT_ID), socket, Buffer.alloc(0));
    expect((socket as any).write).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect((socket as any).destroy).toHaveBeenCalled();
  });

  it('rejects clientId that is not a player with 403', () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const socket = makeSocket();
    const strangerClientId = '00000000-0000-0000-0000-000000000099';
    handleUpgrade(makeMockWss(new MockWebSocket()), makeReq(MATCH_ID, strangerClientId), socket, Buffer.alloc(0));
    expect((socket as any).write).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect((socket as any).destroy).toHaveBeenCalled();
  });

  it('marks connecting player as connected in the registry', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    await connectClient(HOST_CLIENT_ID);
    const player = getMatch(MATCH_ID)!.state.players.find(p => p.clientId === HOST_CLIENT_ID)!;
    expect(player.connected).toBe(true);
  });

  it('sends STATE_SYNC to the connecting client', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const ws = new MockWebSocket();
    handleUpgrade(makeMockWss(ws), makeReq(MATCH_ID, HOST_CLIENT_ID), makeSocket(), Buffer.alloc(0));
    await flush();
    const sync = ws.sent().find((m: any) => m.type === 'STATE_SYNC') as any;
    expect(sync).toBeDefined();
    expect(sync.payload.state.matchId).toBe(MATCH_ID);
  });

  it('broadcasts PRESENCE_UPDATE to existing sockets on connection', async () => {
    // Two-player match; connect host first, then guest — host should receive PRESENCE_UPDATE
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);

    // Now guest connects; host should get PRESENCE_UPDATE
    await connectClient(GUEST_CLIENT_ID);

    const presence = hostWs.sent().find((m: any) => m.type === 'PRESENCE_UPDATE') as any;
    expect(presence).toBeDefined();
    expect(presence.payload.players).toHaveLength(2);
  });

  it('clears a pending abandon timer on reconnect', async () => {
    vi.useFakeTimers();
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });

    const hostWs = await connectClient(HOST_CLIENT_ID);
    await connectClient(GUEST_CLIENT_ID);

    // Both disconnect → abandon timer starts
    hostWs.emit('close');
    await flush();
    const guestWs = (await import('../match-registry.js')).getMatch(MATCH_ID)?.sockets.get(GUEST_CLIENT_ID);
    if (guestWs) guestWs.emit('close');
    await flush();

    expect(getMatch(MATCH_ID)!.abandonTimer).toBeDefined();

    // Guest reconnects → timer should be cleared
    vi.useRealTimers();
    setMatch(MATCH_ID, {
      ...getMatch(MATCH_ID)!,
      state: {
        ...getMatch(MATCH_ID)!.state,
        players: makeTwoPlayerLobbyState().players, // reset connected flags for re-entry
      },
    });
    // Re-add guest as player so handleUpgrade accepts the reconnect
    const existing = getMatch(MATCH_ID)!;
    setMatch(MATCH_ID, {
      ...existing,
      state: {
        ...existing.state,
        players: existing.state.players.map(p =>
          p.clientId === GUEST_CLIENT_ID ? { ...p, connected: false } : p,
        ),
      },
    });
    await connectClient(GUEST_CLIENT_ID);
    expect(getMatch(MATCH_ID)!.abandonTimer).toBeUndefined();
  });
});

// =============================================================================
// processMessage — parse, schema, and envelope validation
// =============================================================================

describe('processMessage — parse and validation', () => {
  beforeEach(async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
  });

  it('sends INVALID_EVENT error on malformed JSON', async () => {
    const hostWs = await connectClient(HOST_CLIENT_ID);
    hostWs.emit('message', '{not valid json');
    await flush();
    const err = hostWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('INVALID_EVENT');
  });

  it('sends INVALID_EVENT error when message fails schema validation', async () => {
    const hostWs = await connectClient(HOST_CLIENT_ID);
    hostWs.receive({ type: 'UNKNOWN_TYPE', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: {} });
    await flush();
    const err = hostWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('INVALID_EVENT');
  });

  it('sends NOT_AUTHORIZED when message matchId does not match connection', async () => {
    const hostWs = await connectClient(HOST_CLIENT_ID);
    const differentMatchId = '00000000-0000-0000-0000-000000000099';
    hostWs.receive({ type: 'SYNC_STATE', matchId: differentMatchId, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: {} });
    await flush();
    const err = hostWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('NOT_AUTHORIZED');
  });

  it('sends NOT_AUTHORIZED when message clientId does not match connection', async () => {
    const hostWs = await connectClient(HOST_CLIENT_ID);
    hostWs.receive({ type: 'SYNC_STATE', matchId: MATCH_ID, clientId: GUEST_CLIENT_ID, eventId: EVENT_ID, payload: {} });
    await flush();
    const err = hostWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('NOT_AUTHORIZED');
  });

  it('drops message silently if match was evicted after connection', async () => {
    const hostWs = await connectClient(HOST_CLIENT_ID);
    deleteMatch(MATCH_ID); // evict
    hostWs.receive({ type: 'SYNC_STATE', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: {} });
    await flush();
    expect(hostWs.send).not.toHaveBeenCalled();
  });
});

// =============================================================================
// processMessage — SYNC_STATE
// =============================================================================

describe('processMessage — SYNC_STATE', () => {
  it('responds with STATE_SYNC to caller only and makes no DB calls', async () => {
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);
    const guestWs = await connectClient(GUEST_CLIENT_ID);

    // Clear everything from the second connection setup
    hostWs.send.mockClear();
    guestWs.send.mockClear();
    vi.clearAllMocks();
    (db as any).query.mockResolvedValue({ rows: [] });

    hostWs.receive({ type: 'SYNC_STATE', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: {} });
    await flush();

    // Host receives STATE_SYNC
    expect(hostWs.send).toHaveBeenCalledTimes(1);
    const msg = hostWs.lastSent() as any;
    expect(msg.type).toBe('STATE_SYNC');
    expect(msg.payload.state.matchId).toBe(MATCH_ID);

    // Guest receives nothing
    expect(guestWs.send).not.toHaveBeenCalled();

    // No dedup SELECT or transaction
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });
});

// =============================================================================
// processMessage — deduplication
// =============================================================================

describe('processMessage — deduplication', () => {
  it('sends DUPLICATE_EVENT error when eventId was already processed', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);

    // Make the dedup SELECT return a row (event already exists)
    (db as any).query.mockResolvedValue({ rows: [{ event_id: EVENT_ID }] });

    hostWs.receive({ type: 'SET_READY', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: { ready: true } });
    await flush();

    const err = hostWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('DUPLICATE_EVENT');
    expect(err.payload.rejectedEventId).toBe(EVENT_ID);

    // No transaction should have been opened
    expect(db.connect).not.toHaveBeenCalled();
  });
});

// =============================================================================
// processMessage — engine validation failures
// =============================================================================

describe('processMessage — engine validation', () => {
  it('sends INVALID_STATE error when event is not valid in current state', async () => {
    // SET_READY requires Lobby, so using InProgress should fail
    setMatch(MATCH_ID, { state: makeInProgressState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);

    hostWs.receive({ type: 'SET_READY', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: { ready: true } });
    await flush();

    const err = hostWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('INVALID_STATE');
    expect(err.payload.rejectedEventId).toBe(EVENT_ID);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('sends NOT_AUTHORIZED error when guest attempts a host-only event', async () => {
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });
    await connectClient(HOST_CLIENT_ID);
    const guestWs = await connectClient(GUEST_CLIENT_ID);

    // RESHUFFLE_BOARD requires InProgress and host; use BACK_TO_LOBBY (InProgress + host-only)
    // Let's use SET_LOBBY_SETTINGS which is host-only in Lobby
    const guestEventId = '00000000-0000-0000-0000-000000000011';
    guestWs.receive({
      type: 'SET_LOBBY_SETTINGS',
      matchId: MATCH_ID,
      clientId: GUEST_CLIENT_ID,
      eventId: guestEventId,
      payload: { timerMode: 'stopwatch' },
    });
    await flush();

    const err = guestWs.lastSent() as any;
    expect(err.type).toBe('ERROR');
    expect(err.payload.code).toBe('NOT_AUTHORIZED');
    expect(err.payload.rejectedEventId).toBe(guestEventId);
  });
});

// =============================================================================
// processMessage — accepted events (happy path)
// =============================================================================

describe('processMessage — accepted events', () => {
  it('SET_READY: persists event, updates registry, broadcasts STATE_UPDATE with lastAppliedEventId', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);
    const txClient = makeTransactionClient();
    (db as any).connect.mockResolvedValue(txClient);

    hostWs.receive({ type: 'SET_READY', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: EVENT_ID, payload: { ready: true } });
    await flush();

    // Transaction was opened and committed
    expect(db.connect).toHaveBeenCalled();
    expect(txClient.query.mock.calls[0][0]).toBe('BEGIN');
    expect(txClient.query.mock.calls[1][0]).toContain('INSERT INTO match_events');
    expect(txClient.query.mock.calls[2][0]).toContain('UPDATE matches');
    expect(txClient.query.mock.calls[3][0]).toBe('COMMIT');
    expect(txClient.release).toHaveBeenCalled();

    // Registry state reflects the ready toggle
    expect(getMatch(MATCH_ID)!.state.readyStates[HOST_PLAYER_ID]).toBe(true);

    // STATE_UPDATE broadcast to host
    const update = hostWs.lastSent() as any;
    expect(update.type).toBe('STATE_UPDATE');
    expect(update.payload.lastAppliedEventId).toBe(EVENT_ID);
    expect(update.payload.state.readyStates[HOST_PLAYER_ID]).toBe(true);
  });

  it('START_MATCH: generates a fresh board, persists with started_at, broadcasts STATE_UPDATE then MATCH_STARTED', async () => {
    const readyState = makeTwoPlayerLobbyState({
      readyStates: { [HOST_PLAYER_ID]: true, [GUEST_PLAYER_ID]: true },
    });
    setMatch(MATCH_ID, { state: readyState, sockets: new Map() });

    const hostWs = await connectClient(HOST_CLIENT_ID);
    const guestWs = await connectClient(GUEST_CLIENT_ID);
    hostWs.send.mockClear();
    guestWs.send.mockClear();

    const txClient = makeTransactionClient();
    (db as any).connect.mockResolvedValue(txClient);

    const startEventId = '00000000-0000-0000-0000-000000000020';
    hostWs.receive({ type: 'START_MATCH', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId: startEventId, payload: {} });
    await flush();

    // Registry state is InProgress
    expect(getMatch(MATCH_ID)!.state.status).toBe('InProgress');

    // started_at flag passed to UPDATE query
    const updateCall = txClient.query.mock.calls.find(
      (args: unknown[]) => (args[0] as string).includes('UPDATE matches'),
    )!;
    expect(updateCall[1][3]).toBe(true);  // isStarting = true

    // Both players receive STATE_UPDATE then MATCH_STARTED
    for (const ws of [hostWs, guestWs]) {
      const msgs = ws.sent() as any[];
      expect(msgs[0].type).toBe('STATE_UPDATE');
      expect(msgs[0].payload.state.status).toBe('InProgress');
      expect(msgs[1].type).toBe('MATCH_STARTED');
    }
  });

  it('MARK_CELL completing a line: broadcasts STATE_UPDATE then MATCH_COMPLETED with correct winner', async () => {
    // Pre-mark cells 4, 9, 14, 19 for host (right column minus last cell)
    const cellsWithLine = BLANK_CELLS.map(c =>
      [4, 9, 14, 19].includes(c.index) ? { ...c, markedBy: HOST_PLAYER_ID } : { ...c },
    );
    setMatch(MATCH_ID, {
      state: makeInProgressState({ card: { seed: 1, cells: cellsWithLine } }),
      sockets: new Map(),
    });

    const txClient = makeTransactionClient();
    (db as any).connect.mockResolvedValue(txClient);

    const hostWs = await connectClient(HOST_CLIENT_ID);
    await connectClient(GUEST_CLIENT_ID);
    hostWs.send.mockClear();

    const markEventId = '00000000-0000-0000-0000-000000000030';
    hostWs.receive({
      type: 'MARK_CELL',
      matchId: MATCH_ID,
      clientId: HOST_CLIENT_ID,
      eventId: markEventId,
      payload: { cellIndex: 24 },
    });
    await flush();

    // Registry reflects Completed
    const finalState = getMatch(MATCH_ID)!.state;
    expect(finalState.status).toBe('Completed');
    expect(finalState.result?.reason).toBe('line');
    expect(finalState.result?.winnerId).toBe(HOST_PLAYER_ID);

    // Broadcast order: STATE_UPDATE then MATCH_COMPLETED
    const msgs = hostWs.sent() as any[];
    expect(msgs[0].type).toBe('STATE_UPDATE');
    expect(msgs[0].payload.state.status).toBe('Completed');
    expect(msgs[1].type).toBe('MATCH_COMPLETED');
    expect(msgs[1].payload.reason).toBe('line');
    expect(msgs[1].payload.winnerId).toBe(HOST_PLAYER_ID);

    // ended_at flag set in transaction
    const updateCall = txClient.query.mock.calls.find((args: unknown[]) => (args[0] as string).includes('UPDATE matches'));
    expect(updateCall?.[1][4]).toBe(true); // isEnding = true
  });

  it('BACK_TO_LOBBY: state transitions back to Lobby, STATE_UPDATE broadcast', async () => {
    setMatch(MATCH_ID, { state: makeInProgressState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);
    await connectClient(GUEST_CLIENT_ID);
    hostWs.send.mockClear();

    const eventId = '00000000-0000-0000-0000-000000000040';
    hostWs.receive({ type: 'BACK_TO_LOBBY', matchId: MATCH_ID, clientId: HOST_CLIENT_ID, eventId, payload: {} });
    await flush();

    expect(getMatch(MATCH_ID)!.state.status).toBe('Lobby');
    const update = hostWs.sent().find((m: any) => m.type === 'STATE_UPDATE') as any;
    expect(update.payload.state.status).toBe('Lobby');
    expect(update.payload.state.readyStates).toEqual({});
  });

  it('SET_LOBBY_SETTINGS: updates timerMode in registry state', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);

    const eventId = '00000000-0000-0000-0000-000000000050';
    hostWs.receive({
      type: 'SET_LOBBY_SETTINGS',
      matchId: MATCH_ID,
      clientId: HOST_CLIENT_ID,
      eventId,
      payload: { timerMode: 'countdown', countdownDurationMs: 600000 },
    });
    await flush();

    const state = getMatch(MATCH_ID)!.state;
    expect(state.lobbySettings.timerMode).toBe('countdown');
    expect(state.lobbySettings.countdownDurationMs).toBe(600000);
  });

  // Stub: countdown timer lifecycle is Phase 5
  it.todo('START_MATCH in countdown mode: starts countdownTimer on MatchEntry');
  it.todo('BACK_TO_LOBBY cancels the active countdownTimer');
  it.todo('REMATCH in countdown mode: cancels old timer and starts a new one');
});

// =============================================================================
// handleDisconnect — presence and abandon
// =============================================================================

describe('handleDisconnect', () => {
  it('marks player disconnected, persists, and broadcasts PRESENCE_UPDATE', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);

    hostWs.emit('close');
    await flush();

    // Registry reflects disconnected
    const player = getMatch(MATCH_ID)!.state.players.find(p => p.clientId === HOST_CLIENT_ID)!;
    expect(player.connected).toBe(false);

    // DB persisted the state
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE matches'),
      expect.arrayContaining([MATCH_ID]),
    );
  });

  it('starts 10-minute abandon timer when all players disconnect', async () => {
    vi.useFakeTimers();
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });

    const hostWs = await connectClient(HOST_CLIENT_ID);
    const guestWs = await connectClient(GUEST_CLIENT_ID);

    hostWs.emit('close');
    await flush();
    expect(getMatch(MATCH_ID)!.abandonTimer).toBeUndefined(); // only one disconnected

    guestWs.emit('close');
    await flush();
    expect(getMatch(MATCH_ID)!.abandonTimer).toBeDefined(); // both disconnected
  });

  it('does not broadcast or persist when a stale socket fires close after reconnect', async () => {
    setMatch(MATCH_ID, { state: makeLobbyState(), sockets: new Map() });

    // Connect once, then reconnect with a new socket for the same clientId
    const oldWs = await connectClient(HOST_CLIENT_ID);
    await connectClient(HOST_CLIENT_ID); // replaces oldWs in registry

    vi.clearAllMocks();
    (db as any).query.mockResolvedValue({ rows: [] });

    // Old socket closes — should be a no-op
    oldWs.emit('close');
    await flush();

    // Host should still be marked connected (new socket is current)
    const player = getMatch(MATCH_ID)!.state.players.find(p => p.clientId === HOST_CLIENT_ID)!;
    expect(player.connected).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('broadcasts PRESENCE_UPDATE with updated players on disconnect', async () => {
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });
    const hostWs = await connectClient(HOST_CLIENT_ID);
    await connectClient(GUEST_CLIENT_ID);
    hostWs.send.mockClear();

    // Guest socket is still live; it should receive PRESENCE_UPDATE when host disconnects
    const guestSocket = getMatch(MATCH_ID)!.sockets.get(GUEST_CLIENT_ID) as unknown as MockWebSocket;
    guestSocket.send.mockClear();

    hostWs.emit('close');
    await flush();

    const presence = guestSocket.sent().find((m: any) => m.type === 'PRESENCE_UPDATE') as any;
    expect(presence).toBeDefined();
    expect(presence.payload.players.find((p: any) => p.clientId === HOST_CLIENT_ID).connected).toBe(false);
  });
});

// =============================================================================
// abandonMatch — timer expiry
// =============================================================================

describe('abandonMatch (triggered by abandon timer)', () => {
  it('sets match status to Abandoned in DB and evicts it from registry', async () => {
    vi.useFakeTimers();
    setMatch(MATCH_ID, { state: makeTwoPlayerLobbyState(), sockets: new Map() });

    const hostWs = await connectClient(HOST_CLIENT_ID);
    const guestWs = await connectClient(GUEST_CLIENT_ID);

    // Both disconnect to arm the timer
    hostWs.emit('close');
    await flush();
    guestWs.emit('close');
    await flush();

    expect(getMatch(MATCH_ID)!.abandonTimer).toBeDefined();
    vi.clearAllMocks();
    (db as any).query.mockResolvedValue({ rows: [] });

    // Fire the 10-minute timer and let the async abandonMatch run
    await vi.runAllTimersAsync();
    await flush();

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('abandoned_at'),
      expect.arrayContaining(['Abandoned', MATCH_ID]),
    );
    expect(getMatch(MATCH_ID)).toBeUndefined();
  });
});
