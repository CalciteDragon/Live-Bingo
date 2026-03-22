import type { MatchState, MatchResult, BingoCard } from '@bingo/shared';
import type { ClientMessage } from '@bingo/shared';
import type { WsErrorCode } from '@bingo/shared';

export class EngineError extends Error {
  constructor(
    public readonly code: WsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface EngineContext {
  /** ISO 8601 timestamp — required for START_MATCH, RESHUFFLE_BOARD, REMATCH */
  nowIso?: string;
  /** Pre-generated board — required for START_MATCH, RESHUFFLE_BOARD */
  newCard?: BingoCard;
}

// ---------------------------------------------------------------------------
// validateEvent
// ---------------------------------------------------------------------------

/**
 * Validates that the given event is legal in the current state.
 * Throws EngineError on any violation; returns void on success.
 */
export function validateEvent(state: MatchState, event: ClientMessage): void {
  const caller = state.players.find((p) => p.clientId === event.clientId);
  if (!caller) throw new EngineError('INVALID_EVENT', 'Unknown client');

  const isHost = caller.slot === 1;

  switch (event.type) {
    case 'SYNC_STATE':
      return;

    case 'SET_READY':
      if (state.status !== 'Lobby')
        throw new EngineError('INVALID_STATE', 'SET_READY requires Lobby status');
      return;

    case 'SET_LOBBY_SETTINGS':
      if (state.status !== 'Lobby')
        throw new EngineError('INVALID_STATE', 'SET_LOBBY_SETTINGS requires Lobby status');
      if (!isHost)
        throw new EngineError('NOT_AUTHORIZED', 'Only the host can change lobby settings');
      if (event.payload.timerMode === 'countdown' && event.payload.countdownDurationMs == null)
        throw new EngineError('INVALID_EVENT', 'countdownDurationMs is required when timerMode is countdown');
      return;

    case 'START_MATCH':
      if (state.status !== 'Lobby')
        throw new EngineError('INVALID_STATE', 'START_MATCH requires Lobby status');
      if (!isHost)
        throw new EngineError('NOT_AUTHORIZED', 'Only the host can start the match');
      if (state.players.length < 2 || state.players.length > 4)
        throw new EngineError('INVALID_STATE', 'Two to four players required to start');
      if (!state.players.every((p) => state.readyStates[p.playerId]))
        throw new EngineError('INVALID_STATE', 'All players must be ready');
      return;

    case 'MARK_CELL': {
      if (state.status !== 'InProgress')
        throw new EngineError('INVALID_STATE', 'MARK_CELL requires InProgress status');
      const cell = state.card.cells[event.payload.cellIndex];
      if (!cell || cell.markedBy !== null)
        throw new EngineError('INVALID_STATE', 'Cell is already marked');
      return;
    }

    case 'UNMARK_CELL': {
      if (state.status !== 'InProgress')
        throw new EngineError('INVALID_STATE', 'UNMARK_CELL requires InProgress status');
      const cell = state.card.cells[event.payload.cellIndex];
      if (!cell || cell.markedBy !== caller.playerId)
        throw new EngineError('INVALID_STATE', 'You do not own this cell');
      return;
    }

    case 'RESHUFFLE_BOARD':
      if (state.status !== 'InProgress')
        throw new EngineError('INVALID_STATE', 'RESHUFFLE_BOARD requires InProgress status');
      if (!isHost)
        throw new EngineError('NOT_AUTHORIZED', 'Only the host can reshuffle the board');
      if (state.card.cells.some((c) => c.markedBy !== null))
        throw new EngineError('INVALID_STATE', 'Cannot reshuffle while cells are marked');
      return;

    case 'BACK_TO_LOBBY':
      if (state.status !== 'InProgress' && state.status !== 'Completed')
        throw new EngineError(
          'INVALID_STATE',
          'BACK_TO_LOBBY requires InProgress or Completed status',
        );
      if (!isHost)
        throw new EngineError('NOT_AUTHORIZED', 'Only the host can return to lobby');
      return;

    case 'REMATCH':
      if (state.status !== 'Completed')
        throw new EngineError('INVALID_STATE', 'REMATCH requires Completed status');
      if (!isHost)
        throw new EngineError('NOT_AUTHORIZED', 'Only the host can initiate a rematch');
      if (!state.players.every((p) => p.connected))
        throw new EngineError('INVALID_STATE', 'Both players must be connected for a rematch');
      return;

    case 'KICK_PLAYER': {
      if (state.status !== 'Lobby')
        throw new EngineError('INVALID_STATE', 'KICK_PLAYER requires Lobby status');
      if (!isHost)
        throw new EngineError('NOT_AUTHORIZED', 'Only the host can kick players');
      const target = state.players.find((p) => p.playerId === event.payload.playerId);
      if (!target)
        throw new EngineError('INVALID_EVENT', 'Target player not found');
      if (target.slot === 1)
        throw new EngineError('INVALID_EVENT', 'Cannot kick the host');
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// applyEvent
// ---------------------------------------------------------------------------

/**
 * Applies an event to a state and returns the new state.
 * Never mutates the input state.
 * Caller must call validateEvent first.
 */
export function applyEvent(
  state: MatchState,
  event: ClientMessage,
  ctx: EngineContext = {},
): MatchState {
  const caller = state.players.find((p) => p.clientId === event.clientId)!;

  switch (event.type) {
    case 'SYNC_STATE':
      return state;

    case 'SET_READY':
      return {
        ...state,
        readyStates: { ...state.readyStates, [caller.playerId]: event.payload.ready },
      };

    case 'SET_LOBBY_SETTINGS': {
      const { timerMode, countdownDurationMs } = event.payload;
      const duration = countdownDurationMs ?? null;
      return {
        ...state,
        lobbySettings: { timerMode, countdownDurationMs: duration },
        timer: { ...state.timer, mode: timerMode, countdownDurationMs: duration },
      };
    }

    case 'START_MATCH':
      return {
        ...state,
        status: 'InProgress',
        card: ctx.newCard ?? state.card,
        timer: { ...state.timer, startedAt: ctx.nowIso ?? null, stoppedAt: null },
      };

    case 'MARK_CELL':
      return {
        ...state,
        card: {
          ...state.card,
          cells: state.card.cells.map((c) =>
            c.index === event.payload.cellIndex ? { ...c, markedBy: caller.playerId } : c,
          ),
        },
      };

    case 'UNMARK_CELL':
      return {
        ...state,
        card: {
          ...state.card,
          cells: state.card.cells.map((c) =>
            c.index === event.payload.cellIndex ? { ...c, markedBy: null } : c,
          ),
        },
      };

    case 'RESHUFFLE_BOARD': {
      const newCard = ctx.newCard ?? {
        ...state.card,
        cells: state.card.cells.map((c) => ({ ...c, markedBy: null })),
      };
      return {
        ...state,
        card: newCard,
        timer: { ...state.timer, startedAt: ctx.nowIso ?? null, stoppedAt: null },
      };
    }

    case 'BACK_TO_LOBBY':
      return {
        ...state,
        status: 'Lobby',
        card: {
          ...state.card,
          cells: state.card.cells.map((c) => ({ ...c, markedBy: null })),
        },
        timer: { ...state.timer, startedAt: null, stoppedAt: null },
        readyStates: {},
        result: null,
      };

    case 'REMATCH': {
      const rematchCard = ctx.newCard ?? {
        ...state.card,
        cells: state.card.cells.map((c) => ({ ...c, markedBy: null })),
      };
      return {
        ...state,
        status: 'InProgress',
        card: rematchCard,
        timer: { ...state.timer, startedAt: ctx.nowIso ?? null, stoppedAt: null },
        result: null,
      };
    }

    case 'KICK_PLAYER': {
      const { playerId } = event.payload;
      const newReadyStates = { ...state.readyStates };
      delete newReadyStates[playerId];
      return {
        ...state,
        players: state.players.filter((p) => p.playerId !== playerId),
        readyStates: newReadyStates,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// checkWin
// ---------------------------------------------------------------------------

/** All 15 lines on a 5×5 board (row-major indices). */
const LINES: readonly (readonly number[])[] = [
  // 5 rows
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
  // 5 columns
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
  // 2 diagonals
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

/**
 * Maps a cell's markedBy (playerId) to its "owner group" for win evaluation.
 * FFA: the group is the player. Team mode: return player.teamId instead.
 * This is the single extension point for team-based ownership.
 */
function resolveOwnerGroup(markedBy: string, _state: MatchState): string {
  return markedBy;
}

/**
 * Aggregates cell counts by owner group across all players.
 * FFA: one entry per player (including 0-count players).
 * Team mode: one entry per team (sum of all teammates' cells).
 */
function collectScoresByOwner(state: MatchState): Map<string, number> {
  const counts = new Map<string, number>(
    state.players.map((p) => [resolveOwnerGroup(p.playerId, state), 0]),
  );
  for (const cell of state.card.cells) {
    if (cell.markedBy !== null) {
      const group = resolveOwnerGroup(cell.markedBy, state);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Determines the winner when the countdown timer expires.
 * Uses collectScoresByOwner so team mode gets consistent behavior
 * by only changing resolveOwnerGroup — no changes needed here.
 * Returns a MatchResult with reason 'timer_expiry'.
 */
export function resolveTimerWinner(state: MatchState): MatchResult {
  const ownerScores = collectScoresByOwner(state);
  const sorted = [...ownerScores.entries()].sort((a, b) => b[1] - a[1]);
  const topCount = sorted[0]?.[1] ?? 0;
  const topOwners = sorted.filter(([, count]) => count === topCount);
  const winnerId = topOwners.length === 1 ? topOwners[0]![0] : null;
  return { winnerId, reason: 'timer_expiry' };
}

/**
 * Checks for line or majority win conditions.
 * Returns MatchResult if a win is detected; null otherwise.
 * Line takes priority over majority if both trigger simultaneously.
 * Does not evaluate timer expiry — that is handled server-side.
 */
export function checkWin(state: MatchState): MatchResult | null {
  if (state.status !== 'InProgress') return null;

  const { cells } = state.card;

  // ── Line win ──────────────────────────────────────────────────────────────
  for (const line of LINES) {
    const firstMarkedBy = cells[line[0]!]?.markedBy;
    if (!firstMarkedBy) continue;
    const firstGroup = resolveOwnerGroup(firstMarkedBy, state);
    if (
      line.every((i) => {
        const m = cells[i]?.markedBy;
        return m != null && resolveOwnerGroup(m, state) === firstGroup;
      })
    ) {
      return { winnerId: firstMarkedBy, reason: 'line' };
    }
  }

  // ── Majority win ──────────────────────────────────────────────────────────
  const ownerScores = collectScoresByOwner(state);
  const scores = [...ownerScores.values()].sort((a, b) => b - a);
  const blanks = cells.filter((c) => c.markedBy === null).length;

  if (scores.length >= 2 && blanks < scores[0]! - scores[1]!) {
    const [winnerId] = [...ownerScores.entries()].find(([, count]) => count === scores[0]!)!;
    return { winnerId: winnerId!, reason: 'majority' };
  }

  return null;
}
