import { WebSocket } from 'ws';
import { ClientMessageSchema } from '@bingo/shared';
import type { ClientMessage, ServerMessage, MatchState, Player, MatchResult } from '@bingo/shared';
import { validateEvent, applyEvent, checkWin, EngineError, generateBoard } from '@bingo/engine';
import { db } from '../db/index.js';
import { getMatch, setMatch, broadcastToMatch } from '../match-registry.js';
import { cancelCountdownTimer, scheduleCountdownTimer } from './match-timers.js';

// ─── Shared send helper ───────────────────────────────────────────────────────

function sendTo(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ─── Stage 1: Parse and schema-validate ──────────────────────────────────────

type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; errorMessage: string };

function parseAndValidateSchema(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errorMessage: 'Invalid JSON' };
  }

  const result = ClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, errorMessage: result.error.errors[0]?.message ?? 'Invalid message' };
  }

  return { ok: true, message: result.data };
}

// ─── Stage 2: Envelope identity check ────────────────────────────────────────

function envelopeMatchesConnection(
  message: ClientMessage,
  matchId: string,
  clientId: string,
): boolean {
  return message.matchId === matchId && message.clientId === clientId;
}

// ─── Stage 5: Deduplication ───────────────────────────────────────────────────

async function isDuplicateEvent(matchId: string, eventId: string): Promise<boolean> {
  const { rows } = await db.query<{ event_id: string }>(
    'SELECT event_id FROM match_events WHERE match_id = $1 AND event_id = $2',
    [matchId, eventId],
  );
  return rows.length > 0;
}

// ─── Stage 6: Engine validation ──────────────────────────────────────────────

type EngineValidationResult =
  | { ok: true }
  | { ok: false; engineError: EngineError };

function validateEngineRules(state: MatchState, message: ClientMessage): EngineValidationResult {
  try {
    validateEvent(state, message);
    return { ok: true };
  } catch (err) {
    if (err instanceof EngineError) {
      return { ok: false, engineError: err };
    }
    throw err;
  }
}

// ─── Stage 7: Apply event and check win ──────────────────────────────────────

function buildEngineContext(message: ClientMessage) {
  const needsNewCard =
    message.type === 'START_MATCH' ||
    message.type === 'RESHUFFLE_BOARD' ||
    message.type === 'REMATCH';
  const newCard = needsNewCard
    ? generateBoard(Math.floor(Math.random() * 2 ** 32))
    : undefined;
  return {
    nowIso: new Date().toISOString(),
    ...(newCard !== undefined ? { newCard } : {}),
  };
}

function applyAndCheckWin(
  state: MatchState,
  message: ClientMessage,
  ctx: ReturnType<typeof buildEngineContext>,
): { newState: MatchState; winResult: MatchResult | null } {
  let newState = applyEvent(state, message, ctx);
  const winResult = checkWin(newState) ?? null;
  if (winResult) {
    newState = { ...newState, status: 'Completed', result: winResult };
  }
  return { newState, winResult };
}

// ─── Stage 8: Persist (transactional) ────────────────────────────────────────

async function persistEventTransaction(
  matchId: string,
  caller: Player,
  clientId: string,
  message: ClientMessage,
  newState: MatchState,
  winResult: MatchResult | null,
): Promise<void> {
  const isStarting = message.type === 'START_MATCH' || message.type === 'REMATCH';
  const isEnding = winResult !== null;

  const dbConn = await db.connect();
  try {
    await dbConn.query('BEGIN');
    await dbConn.query(
      `INSERT INTO match_events (match_id, seq, event_id, type, payload_json, player_id, client_id, created_at)
       VALUES ($1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM match_events WHERE match_id = $1), $2, $3, $4, $5, $6, NOW())`,
      [matchId, message.eventId, message.type, JSON.stringify(message.payload), caller.playerId, clientId],
    );
    await dbConn.query(
      `UPDATE matches
       SET state_json = $1,
           status = $2,
           started_at = CASE WHEN $4 THEN NOW() ELSE started_at END,
           ended_at   = CASE WHEN $5 THEN NOW() ELSE ended_at END
       WHERE match_id = $3`,
      [JSON.stringify(newState), newState.status, matchId, isStarting, isEnding],
    );
    await dbConn.query('COMMIT');
  } catch (err) {
    await dbConn.query('ROLLBACK');
    throw err;
  } finally {
    dbConn.release();
  }
}

// ─── Stage 9: Registry commit ─────────────────────────────────────────────────

function commitToRegistry(matchId: string, newState: MatchState): void {
  const entry = getMatch(matchId);
  if (entry) {
    setMatch(matchId, { ...entry, state: newState });
  }
}

// ─── Stage 11: Lifecycle broadcasts ──────────────────────────────────────────

function broadcastLifecycleEvents(
  matchId: string,
  message: ClientMessage,
  winResult: MatchResult | null,
): void {
  if (message.type === 'START_MATCH') {
    broadcastToMatch(matchId, { type: 'MATCH_STARTED', matchId, payload: {} });
  }
  if (winResult) {
    broadcastToMatch(matchId, {
      type: 'MATCH_COMPLETED',
      matchId,
      payload: { reason: winResult.reason, winnerId: winResult.winnerId },
    });
  }
}

// ─── Stage 12: Countdown timer reconciliation ─────────────────────────────────

function reconcileCountdownTimer(
  matchId: string,
  message: ClientMessage,
  newState: MatchState,
  winResult: MatchResult | null,
): void {
  const cancelsTimer =
    winResult !== null ||
    message.type === 'BACK_TO_LOBBY' ||
    message.type === 'RESHUFFLE_BOARD' ||
    message.type === 'REMATCH';

  if (cancelsTimer) {
    cancelCountdownTimer(matchId);
  }

  const startsTimer =
    newState.status === 'InProgress' &&
    newState.timer.mode === 'countdown' &&
    newState.timer.countdownDurationMs !== null &&
    (message.type === 'START_MATCH' || message.type === 'RESHUFFLE_BOARD' || message.type === 'REMATCH');

  if (startsTimer) {
    scheduleCountdownTimer(matchId, newState.timer.countdownDurationMs!);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function processMessage(
  ws: WebSocket,
  matchId: string,
  clientId: string,
  raw: string,
): Promise<void> {
  // Stage 1 — Parse JSON and validate schema
  const parsed = parseAndValidateSchema(raw);
  if (!parsed.ok) {
    sendTo(ws, { type: 'ERROR', matchId, payload: { code: 'INVALID_EVENT', message: parsed.errorMessage } });
    return;
  }

  // Stage 2 — Verify envelope identity (matchId/clientId must match this connection)
  if (!envelopeMatchesConnection(parsed.message, matchId, clientId)) {
    sendTo(ws, { type: 'ERROR', matchId, payload: { code: 'NOT_AUTHORIZED', message: 'matchId or clientId mismatch' } });
    return;
  }

  const { message } = parsed;

  // Stage 3 — Registry lookup (drop silently if match was evicted)
  const entry = getMatch(matchId);
  if (!entry) return;

  // Stage 4 — SYNC_STATE short-circuit (read-only, no side effects)
  if (message.type === 'SYNC_STATE') {
    sendTo(ws, { type: 'STATE_SYNC', matchId, payload: { state: entry.state } });
    return;
  }

  // Stage 5 — Deduplication (at-most-once per eventId per match)
  if (await isDuplicateEvent(matchId, message.eventId)) {
    sendTo(ws, {
      type: 'ERROR',
      matchId,
      payload: { code: 'DUPLICATE_EVENT', message: 'Event already processed', rejectedEventId: message.eventId },
    });
    return;
  }

  // Stage 6 — Engine validation
  const engineCheck = validateEngineRules(entry.state, message);
  if (!engineCheck.ok) {
    sendTo(ws, {
      type: 'ERROR',
      matchId,
      payload: { code: engineCheck.engineError.code, message: engineCheck.engineError.message, rejectedEventId: message.eventId },
    });
    return;
  }

  // Stage 7 — Build engine context, apply event, and check for win
  const ctx = buildEngineContext(message);
  const { newState, winResult } = applyAndCheckWin(entry.state, message, ctx);

  // Stage 8 — Persist to database (transactional)
  const caller = entry.state.players.find((p) => p.clientId === clientId)!;
  await persistEventTransaction(matchId, caller, clientId, message, newState, winResult);

  // Stage 9 — Commit new state to in-memory registry
  commitToRegistry(matchId, newState);

  // Stage 10 — Broadcast full state snapshot to both clients
  broadcastToMatch(matchId, {
    type: 'STATE_UPDATE',
    matchId,
    payload: { state: newState, lastAppliedEventId: message.eventId },
  });

  // Stage 11 — Broadcast lifecycle events (MATCH_STARTED, MATCH_COMPLETED)
  broadcastLifecycleEvents(matchId, message, winResult);

  // Stage 12 — Reconcile countdown timers (cancel on reset, start on InProgress)
  reconcileCountdownTimer(matchId, message, newState, winResult);
}
