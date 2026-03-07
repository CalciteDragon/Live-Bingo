import type { MatchResult } from '@bingo/shared';
import { db } from '../db/index.js';
import { getMatch, setMatch, broadcastToMatch, deleteMatch } from '../match-registry.js';

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

  const [p1, p2] = entry.state.players;
  const count = (playerId: string) =>
    entry.state.card.cells.filter((c) => c.markedBy === playerId).length;
  const c1 = count(p1!.playerId);
  const c2 = count(p2!.playerId);

  let winnerId: string | null;
  if (c1 > c2)      winnerId = p1!.playerId;
  else if (c2 > c1) winnerId = p2!.playerId;
  else              winnerId = null; // draw

  const result: MatchResult = { winnerId, reason: 'timer_expiry' };
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
