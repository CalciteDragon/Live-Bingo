import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import { generateBoard } from '@bingo/engine';
import type {
  MatchState,
  Player,
  Slot,
  CreateMatchResponse,
  JoinMatchResponse,
  GetMatchResponse,
  ResolveJoinCodeResponse,
} from '@bingo/shared';
import { CreateMatchBodySchema, JoinMatchBodySchema } from '@bingo/shared';
import { db } from '../db/index.js';
import { getMatch, setMatch } from '../match-registry.js';
import { clientIdMiddleware } from '../middleware/client-id.js';

export const matchRouter = Router();

matchRouter.use(clientIdMiddleware);

// POST /matches — create a new match
matchRouter.post('/', async (req, res) => {
  const body = CreateMatchBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: body.error.errors[0]?.message ?? 'Invalid request body' });
    return;
  }

  const clientId = res.locals['clientId'] as string;
  const { alias } = body.data;

  const matchId = randomUUID();
  const playerId = randomUUID();
  const seed = Math.floor(Math.random() * 2 ** 32);
  const joinCode = randomBytes(3).toString('hex').toUpperCase();
  const joinCodeExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  const card = generateBoard(seed);
  const state: MatchState = {
    matchId,
    matchMode: 'ffa',
    status: 'Lobby',
    players: [{ playerId, clientId, slot: 1, alias, connected: false }],
    readyStates: {},
    lobbySettings: { timerMode: 'stopwatch', countdownDurationMs: null },
    card,
    timer: { mode: 'stopwatch', startedAt: null, countdownDurationMs: null },
    result: null,
  };

  const dbConn = await db.connect();
  try {
    await dbConn.query('BEGIN');
    await dbConn.query(
      `INSERT INTO matches (match_id, status, seed, join_code, join_code_expires_at, timer_mode, countdown_duration_ms, state_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [matchId, 'Lobby', seed, joinCode, joinCodeExpiresAt, 'stopwatch', null, JSON.stringify(state)],
    );
    await dbConn.query(
      `INSERT INTO match_players (player_id, match_id, client_id, slot, alias, connected, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [playerId, matchId, clientId, 1, alias, false],
    );
    await dbConn.query('COMMIT');
  } catch (err) {
    await dbConn.query('ROLLBACK');
    throw err;
  } finally {
    dbConn.release();
  }

  setMatch(matchId, { state, sockets: new Map() });

  const joinUrl = `${process.env['CLIENT_ORIGIN'] ?? ''}/join/${joinCode}`;
  const response: CreateMatchResponse = { matchId, joinCode, joinUrl, state };
  res.status(201).json(response);
});

// POST /matches/:id/join — join an existing match
matchRouter.post('/:id/join', async (req, res) => {
  const body = JoinMatchBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ message: body.error.errors[0]?.message ?? 'Invalid request body' });
    return;
  }

  const clientId = res.locals['clientId'] as string;
  const { alias, joinCode: providedJoinCode } = body.data;
  const matchId = req.params['id'] as string;

  // Always query DB for join code metadata (not stored in MatchState) and as state fallback
  const { rows } = await db.query<{ state_json: MatchState; join_code: string; join_code_expires_at: Date }>(
    'SELECT state_json, join_code, join_code_expires_at FROM matches WHERE match_id = $1',
    [matchId],
  );
  if (rows.length === 0) {
    res.status(404).json({ code: 'MATCH_NOT_FOUND', message: 'Match not found' });
    return;
  }

  const { join_code, join_code_expires_at, state_json } = rows[0];

  // Prefer registry state (more up-to-date) over persisted state_json
  const entry = getMatch(matchId);
  const state = entry?.state ?? state_json;

  if (state.status !== 'Lobby') {
    res.status(409).json({ code: 'MATCH_NOT_JOINABLE', message: 'Match is not in lobby' });
    return;
  }
  if (state.players.some((p) => p.clientId === clientId)) {
    res.status(409).json({ code: 'CLIENT_CONFLICT', message: 'Client already joined this match' });
    return;
  }
  if (state.players.length >= 4) {
    res.status(409).json({ code: 'MATCH_FULL', message: 'Match is full' });
    return;
  }
  if (join_code_expires_at < new Date()) {
    res.status(410).json({ code: 'JOIN_CODE_EXPIRED', message: 'Join code has expired' });
    return;
  }
  if (providedJoinCode !== undefined && providedJoinCode !== join_code) {
    res.status(400).json({ code: 'JOIN_CODE_INVALID', message: 'Invalid join code' });
    return;
  }

  const playerId = randomUUID();
  let updatedState: MatchState;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: slotRows } = await client.query<{ next_slot: number }>(
      `SELECT COALESCE(MAX(slot), 0) + 1 AS next_slot
       FROM (SELECT slot FROM match_players WHERE match_id = $1 FOR UPDATE) AS locked`,
      [matchId],
    );
    const slot = slotRows[0]!.next_slot as Slot;
    const player: Player = { playerId, clientId, slot, alias, connected: false };
    updatedState = { ...state, players: [...state.players, player] };
    await client.query(
      `INSERT INTO match_players (player_id, match_id, client_id, slot, alias, connected, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [playerId, matchId, clientId, slot, alias, false],
    );
    await client.query('UPDATE matches SET state_json = $1 WHERE match_id = $2', [
      JSON.stringify(updatedState),
      matchId,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  setMatch(matchId, { ...(entry ?? { sockets: new Map() }), state: updatedState });

  const response: JoinMatchResponse = { matchId, playerId, state: updatedState };
  res.status(200).json(response);
});

// GET /matches/by-code/:code — resolve a join code to a matchId
matchRouter.get('/by-code/:code', async (req, res) => {
  const code = req.params['code'] as string;

  const { rows } = await db.query<{ match_id: string; join_code_expires_at: Date }>(
    'SELECT match_id, join_code_expires_at FROM matches WHERE join_code = $1',
    [code],
  );

  if (rows.length === 0) {
    res.status(404).json({ code: 'MATCH_NOT_FOUND', message: 'No match found for this join code' });
    return;
  }

  if (rows[0]!.join_code_expires_at < new Date()) {
    res.status(410).json({ code: 'JOIN_CODE_EXPIRED', message: 'Join code has expired' });
    return;
  }

  const response: ResolveJoinCodeResponse = { matchId: rows[0]!.match_id };
  res.status(200).json(response);
});

// GET /matches/:id — initial state hydration
matchRouter.get('/:id', async (req, res) => {
  const clientId = res.locals['clientId'] as string;
  const matchId = req.params['id'] as string;

  const entry = getMatch(matchId);
  let state: MatchState;

  if (entry) {
    state = entry.state;
  } else {
    const { rows } = await db.query<{ state_json: MatchState }>(
      'SELECT state_json FROM matches WHERE match_id = $1',
      [matchId],
    );
    if (rows.length === 0) {
      res.status(404).json({ code: 'MATCH_NOT_FOUND', message: 'Match not found' });
      return;
    }
    state = rows[0].state_json;
  }

  const player = state.players.find((p) => p.clientId === clientId);
  if (!player) {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Not a participant in this match' });
    return;
  }

  const response: GetMatchResponse = { matchId, playerId: player.playerId, state };
  res.status(200).json(response);
});
