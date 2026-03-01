import { URL } from 'node:url';
import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { ClientMessageSchema } from '@bingo/shared';
import type { ServerMessage, MatchResult } from '@bingo/shared';
import { validateEvent, applyEvent, checkWin, EngineError, generateBoard } from '@bingo/engine';
import { db } from '../db/index.js';
import {
  getMatch,
  setMatch,
  registerSocket,
  removeSocketIfCurrent,
  broadcastToMatch,
  deleteMatch,
} from '../match-registry.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Schedules (or reschedules) the countdown timer for a match.
 * Called from processMessage after START_MATCH/RESHUFFLE_BOARD/REMATCH,
 * and from startup hydration in src/index.ts.
 */
export function scheduleCountdownTimer(matchId: string, remainingMs: number): void {
  const entry = getMatch(matchId);
  if (!entry) return;
  if (entry.countdownTimer) {
    clearTimeout(entry.countdownTimer);
    entry.countdownTimer = undefined;
  }
  entry.countdownTimer = setTimeout(
    () => expireCountdown(matchId).catch((err) => console.error('[ws] expireCountdown failed:', err)),
    Math.max(0, remainingMs),
  );
}

/**
 * Fires when the countdown reaches zero. Evaluates win-by-time and completes the match.
 * Exits silently if the match was already completed by another means.
 */
async function expireCountdown(matchId: string): Promise<void> {
  const entry = getMatch(matchId);
  if (!entry || entry.state.status !== 'InProgress') return;

  entry.countdownTimer = undefined;

  // Count marked cells per player (always exactly 2 players)
  const [p1, p2] = entry.state.players;
  const count = (playerId: string) =>
    entry.state.card.cells.filter(c => c.markedBy === playerId).length;
  const c1 = count(p1!.playerId);
  const c2 = count(p2!.playerId);

  let winnerId: string | null;
  if (c1 > c2)       winnerId = p1!.playerId;
  else if (c2 > c1)  winnerId = p2!.playerId;
  else               winnerId = null; // draw

  const result: MatchResult = { winnerId, reason: 'timer_expiry' };
  const newState = { ...entry.state, status: 'Completed' as const, result };

  await db.query(
    'UPDATE matches SET state_json = $1, status = $2, ended_at = NOW() WHERE match_id = $3',
    [JSON.stringify(newState), 'Completed', matchId],
  );

  setMatch(matchId, { ...entry, state: newState });

  broadcastToMatch(matchId, {
    type: 'STATE_UPDATE',
    matchId,
    payload: { state: newState },
  });
  broadcastToMatch(matchId, {
    type: 'MATCH_COMPLETED',
    matchId,
    payload: { reason: result.reason, winnerId: result.winnerId },
  });
}

function sendTo(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

export function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const url = new URL(req.url ?? '', 'ws://localhost');
  const matchId = url.searchParams.get('matchId');
  const clientId = url.searchParams.get('clientId');

  if (!matchId || !UUID_RE.test(matchId) || !clientId || !UUID_RE.test(clientId)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const entry = getMatch(matchId);
  if (!entry || !entry.state.players.some((p) => p.clientId === clientId)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket as import('node:stream').Duplex, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req);

    // Register socket (overwrites any stale previous socket for the same clientId)
    registerSocket(matchId, clientId, ws);

    // Re-fetch entry after registerSocket (which mutates entry.sockets in-place)
    const currentEntry = getMatch(matchId)!;

    // Clear abandon timer if a reconnect is happening while one was pending
    if (currentEntry.abandonTimer) {
      clearTimeout(currentEntry.abandonTimer);
      currentEntry.abandonTimer = undefined;
    }

    // Mark player as connected
    const updatedState = {
      ...currentEntry.state,
      players: currentEntry.state.players.map((p) =>
        p.clientId === clientId ? { ...p, connected: true } : p,
      ),
    };
    setMatch(matchId, { ...currentEntry, state: updatedState });

    // Persist connected state (fire-and-forget; errors are logged)
    db.query('UPDATE matches SET state_json = $1 WHERE match_id = $2', [
      JSON.stringify(updatedState),
      matchId,
    ]).catch((err) => console.error('[ws] Failed to persist connect state:', err));

    broadcastToMatch(matchId, {
      type: 'PRESENCE_UPDATE',
      matchId,
      payload: { players: updatedState.players },
    });

    // Send full state to the connecting/reconnecting client
    sendTo(ws, { type: 'STATE_SYNC', matchId, payload: { state: updatedState } });

    handleConnection(ws, matchId, clientId);
  });
}

function handleConnection(ws: WebSocket, matchId: string, clientId: string): void {
  ws.on('message', (data) => {
    processMessage(ws, matchId, clientId, data.toString()).catch((err) =>
      console.error('[ws] Unhandled error in processMessage:', err),
    );
  });

  ws.on('close', () => {
    handleDisconnect(ws, matchId, clientId).catch((err) =>
      console.error('[ws] Unhandled error in handleDisconnect:', err),
    );
  });
}

async function processMessage(
  ws: WebSocket,
  matchId: string,
  clientId: string,
  raw: string,
): Promise<void> {
  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendTo(ws, {
      type: 'ERROR',
      matchId,
      payload: { code: 'INVALID_EVENT', message: 'Invalid JSON' },
    });
    return;
  }

  // Schema validation
  const result = ClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    sendTo(ws, {
      type: 'ERROR',
      matchId,
      payload: {
        code: 'INVALID_EVENT',
        message: result.error.errors[0]?.message ?? 'Invalid message',
      },
    });
    return;
  }

  const message = result.data;

  // Verify the message is addressed to this connection's match and client
  if (message.matchId !== matchId || message.clientId !== clientId) {
    sendTo(ws, {
      type: 'ERROR',
      matchId,
      payload: { code: 'NOT_AUTHORIZED', message: 'matchId or clientId mismatch' },
    });
    return;
  }

  // 1. Look up MatchEntry — drop silently if match was evicted
  const entry = getMatch(matchId);
  if (!entry) return;

  const { state } = entry;

  // 2. SYNC_STATE → respond to caller only, no further processing
  if (message.type === 'SYNC_STATE') {
    sendTo(ws, { type: 'STATE_SYNC', matchId, payload: { state } });
    return;
  }

  // 3. Deduplication — at-most-once per eventId per match
  const { rows: dupRows } = await db.query<{ event_id: string }>(
    'SELECT event_id FROM match_events WHERE match_id = $1 AND event_id = $2',
    [matchId, message.eventId],
  );
  if (dupRows.length > 0) {
    sendTo(ws, {
      type: 'ERROR',
      matchId,
      payload: {
        code: 'DUPLICATE_EVENT',
        message: 'Event already processed',
        rejectedEventId: message.eventId,
      },
    });
    return;
  }

  // 4. Validate — engine enforces all state-machine rules
  try {
    validateEvent(state, message);
  } catch (err) {
    if (err instanceof EngineError) {
      sendTo(ws, {
        type: 'ERROR',
        matchId,
        payload: { code: err.code, message: err.message, rejectedEventId: message.eventId },
      });
    }
    return;
  }

  // 5. Build EngineContext — generate a fresh board for events that need one
  const needsNewCard =
    message.type === 'START_MATCH' ||
    message.type === 'RESHUFFLE_BOARD' ||
    message.type === 'REMATCH';
  const newCard = needsNewCard
    ? generateBoard(Math.floor(Math.random() * 2 ** 32))
    : undefined;

  const ctx = {
    nowIso: new Date().toISOString(),
    ...(newCard !== undefined ? { newCard } : {}),
  };

  // 6. Apply event
  let newState = applyEvent(state, message, ctx);

  // 7. Check for win conditions
  const winResult = checkWin(newState);

  // 8. Complete match on win
  if (winResult) {
    newState = { ...newState, status: 'Completed', result: winResult };
  }

  // 9. Persist in a single transaction
  const caller = state.players.find((p) => p.clientId === clientId)!;
  const isStarting = message.type === 'START_MATCH' || message.type === 'REMATCH';
  const isEnding = !!winResult;

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

  // 10. Update registry
  const latestEntry = getMatch(matchId);
  if (latestEntry) {
    setMatch(matchId, { ...latestEntry, state: newState });
  }

  // 11. Broadcast full state snapshot
  broadcastToMatch(matchId, {
    type: 'STATE_UPDATE',
    matchId,
    payload: { state: newState, lastAppliedEventId: message.eventId },
  });

  // 12. Extra convenience broadcast on match start
  if (message.type === 'START_MATCH') {
    broadcastToMatch(matchId, { type: 'MATCH_STARTED', matchId, payload: {} });
  }

  // 13. Broadcast win
  if (winResult) {
    broadcastToMatch(matchId, {
      type: 'MATCH_COMPLETED',
      matchId,
      payload: { reason: winResult.reason, winnerId: winResult.winnerId },
    });
  }

  // 14. Manage countdown timer
  const timerEntry = getMatch(matchId);
  if (timerEntry) {
    // Cancel the running timer on events that end or reset the match
    if (winResult || message.type === 'BACK_TO_LOBBY' || message.type === 'RESHUFFLE_BOARD' || message.type === 'REMATCH') {
      if (timerEntry.countdownTimer) {
        clearTimeout(timerEntry.countdownTimer);
        timerEntry.countdownTimer = undefined;
      }
    }
    // Start or restart the countdown when a countdown match enters InProgress
    if (
      newState.status === 'InProgress' &&
      newState.timer.mode === 'countdown' &&
      newState.timer.countdownDurationMs !== null &&
      (message.type === 'START_MATCH' || message.type === 'RESHUFFLE_BOARD' || message.type === 'REMATCH')
    ) {
      timerEntry.countdownTimer = setTimeout(
        () => expireCountdown(matchId).catch((err) => console.error('[ws] expireCountdown failed:', err)),
        newState.timer.countdownDurationMs,
      );
    }
  }
}

async function handleDisconnect(ws: WebSocket, matchId: string, clientId: string): Promise<void> {
  // 1. Remove socket only if this closing socket is still current for the client
  const removed = removeSocketIfCurrent(matchId, clientId, ws);
  if (!removed) {
    return;
  }

  const entry = getMatch(matchId);
  if (!entry) return;

  // 2. Mark player disconnected; reset their ready state in Lobby (design spec §6.4)
  const disconnectedPlayer = entry.state.players.find(p => p.clientId === clientId);
  let updatedState = {
    ...entry.state,
    players: entry.state.players.map((p) =>
      p.clientId === clientId ? { ...p, connected: false } : p,
    ),
  };
  if (entry.state.status === 'Lobby' && disconnectedPlayer) {
    updatedState = {
      ...updatedState,
      readyStates: { ...updatedState.readyStates, [disconnectedPlayer.playerId]: false },
    };
  }

  // 3. Persist
  await db.query('UPDATE matches SET state_json = $1 WHERE match_id = $2', [
    JSON.stringify(updatedState),
    matchId,
  ]);

  // 4. Update registry and broadcast
  setMatch(matchId, { ...entry, state: updatedState });
  broadcastToMatch(matchId, {
    type: 'PRESENCE_UPDATE',
    matchId,
    payload: { players: updatedState.players },
  });

  // 5. Start abandon timer if all players are now disconnected
  const allDisconnected = updatedState.players.every((p) => !p.connected);
  if (allDisconnected) {
    const updatedEntry = getMatch(matchId)!;
    updatedEntry.abandonTimer = setTimeout(
      () => abandonMatch(matchId).catch((err) => console.error('[ws] Abandon failed:', err)),
      10 * 60 * 1000,
    );
  }
}

async function abandonMatch(matchId: string): Promise<void> {
  const entry = getMatch(matchId);
  if (!entry) return;

  // Cancel a running countdown timer before evicting the match
  if (entry.countdownTimer) {
    clearTimeout(entry.countdownTimer);
    entry.countdownTimer = undefined;
  }

  const abandonedState = { ...entry.state, status: 'Abandoned' as const };
  await db.query(
    'UPDATE matches SET status = $1, abandoned_at = NOW(), state_json = $2 WHERE match_id = $3',
    ['Abandoned', JSON.stringify(abandonedState), matchId],
  );

  deleteMatch(matchId);
}
