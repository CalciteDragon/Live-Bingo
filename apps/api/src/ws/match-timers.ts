import { resolveTimerWinner } from '@bingo/engine';
import { db } from '../db/index.js';
import { getMatch, setMatch, broadcastToMatch, deleteMatch, removeSocket } from '../match-registry.js';

// ─── Countdown timer ──────────────────────────────────────────────────────────

/**
 * Schedules (or reschedules) the countdown timer for a match.
 * Called after START_MATCH/RESHUFFLE_BOARD/REMATCH, and from startup hydration.
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
 * Cancels the active countdown timer for a match, if any.
 */
export function cancelCountdownTimer(matchId: string): void {
  const entry = getMatch(matchId);
  if (!entry) return;
  if (entry.countdownTimer) {
    clearTimeout(entry.countdownTimer);
    entry.countdownTimer = undefined;
  }
}

/**
 * Fires when the countdown reaches zero. Evaluates win-by-time and completes the match.
 * Exits silently if the match was already completed by another means.
 */
async function expireCountdown(matchId: string): Promise<void> {
  const entry = getMatch(matchId);
  if (!entry || entry.state.status !== 'InProgress') return;

  entry.countdownTimer = undefined;

  const result = resolveTimerWinner(entry.state);
  const newState = { ...entry.state, status: 'Completed' as const, result };

  await db.query(
    'UPDATE matches SET state_json = $1, status = $2, ended_at = NOW() WHERE match_id = $3',
    [JSON.stringify(newState), 'Completed', matchId],
  );

  setMatch(matchId, { ...entry, state: newState });

  broadcastToMatch(matchId, { type: 'STATE_UPDATE', matchId, payload: { state: newState } });
  broadcastToMatch(matchId, {
    type: 'MATCH_COMPLETED',
    matchId,
    payload: { reason: result.reason, winnerId: result.winnerId },
  });
}

// ─── Lobby kick timer ─────────────────────────────────────────────────────────

const LOBBY_KICK_DELAY_MS = 30_000;

/**
 * Schedules (or resets) the 30-second auto-kick timer for a non-host player
 * who disconnected while the match is in Lobby state.
 */
export function scheduleLobbyKickTimer(matchId: string, playerId: string): void {
  const entry = getMatch(matchId);
  if (!entry) return;
  if (!entry.lobbyKickTimers) entry.lobbyKickTimers = new Map();
  const existing = entry.lobbyKickTimers.get(playerId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(
    () => autoKickPlayer(matchId, playerId).catch((err) => console.error('[ws] autoKickPlayer failed:', err)),
    LOBBY_KICK_DELAY_MS,
  );
  entry.lobbyKickTimers.set(playerId, timer);
}

/**
 * Cancels the pending auto-kick timer for a player. Called when they reconnect.
 */
export function cancelLobbyKickTimer(matchId: string, playerId: string): void {
  const entry = getMatch(matchId);
  if (!entry?.lobbyKickTimers) return;
  const timer = entry.lobbyKickTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    entry.lobbyKickTimers.delete(playerId);
  }
}

/**
 * Fires after LOBBY_KICK_DELAY_MS: removes the disconnected player from the match.
 * No-ops if the match started, the player reconnected, or the player was already removed.
 */
async function autoKickPlayer(matchId: string, playerId: string): Promise<void> {
  const entry = getMatch(matchId);
  if (!entry) return;
  if (entry.state.status !== 'Lobby') return;

  const target = entry.state.players.find((p) => p.playerId === playerId);
  if (!target || target.connected) return; // reconnected or already gone

  // Clean up timer entry now that it has fired
  entry.lobbyKickTimers?.delete(playerId);

  const newReadyStates = { ...entry.state.readyStates };
  delete newReadyStates[playerId];
  const newState = {
    ...entry.state,
    players: entry.state.players.filter((p) => p.playerId !== playerId),
    readyStates: newReadyStates,
  };

  const dbConn = await db.connect();
  try {
    await dbConn.query('BEGIN');
    await dbConn.query('DELETE FROM match_players WHERE player_id = $1', [playerId]);
    await dbConn.query('UPDATE matches SET state_json = $1 WHERE match_id = $2', [
      JSON.stringify(newState),
      matchId,
    ]);
    await dbConn.query('COMMIT');
  } catch (err) {
    await dbConn.query('ROLLBACK');
    throw err;
  } finally {
    dbConn.release();
  }

  // Remove socket if somehow still registered (edge case)
  removeSocket(matchId, target.clientId);

  setMatch(matchId, { ...entry, state: newState });

  broadcastToMatch(matchId, { type: 'STATE_UPDATE', matchId, payload: { state: newState } });
  broadcastToMatch(matchId, {
    type: 'PRESENCE_UPDATE',
    matchId,
    payload: { players: newState.players, readyStates: newState.readyStates },
  });
}

// ─── Abandon timer ────────────────────────────────────────────────────────────

/**
 * Schedules the 10-minute abandon timer. Called when all players disconnect.
 */
export function scheduleAbandonTimer(matchId: string): void {
  const entry = getMatch(matchId);
  if (!entry) return;
  entry.abandonTimer = setTimeout(
    () => abandonMatch(matchId).catch((err) => console.error('[ws] Abandon failed:', err)),
    10 * 60 * 1000,
  );
}

/**
 * Cancels the pending abandon timer. Called when a player reconnects.
 */
export function cancelAbandonTimer(matchId: string): void {
  const entry = getMatch(matchId);
  if (!entry) return;
  if (entry.abandonTimer) {
    clearTimeout(entry.abandonTimer);
    entry.abandonTimer = undefined;
  }
}

/**
 * Runs after the 10-minute abandon timeout: deletes the match from the database and evicts it from memory.
 */
async function abandonMatch(matchId: string): Promise<void> {
  const entry = getMatch(matchId);
  if (!entry) return;

  cancelCountdownTimer(matchId);

  await db.query('DELETE FROM matches WHERE match_id = $1', [matchId]);

  deleteMatch(matchId);
}
