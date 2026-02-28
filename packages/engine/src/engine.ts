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
      if (state.players.length !== 2)
        throw new EngineError('INVALID_STATE', 'Two players required to start');
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
        timer: { ...state.timer, startedAt: ctx.nowIso ?? null },
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
        timer: { ...state.timer, startedAt: ctx.nowIso ?? null },
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
        timer: { ...state.timer, startedAt: null },
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
        timer: { ...state.timer, startedAt: ctx.nowIso ?? null },
        result: null,
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
 * Checks for line or majority win conditions.
 * Returns MatchResult if a win is detected; null otherwise.
 * Line takes priority over majority if both trigger simultaneously.
 * Does not evaluate timer expiry — that is handled server-side.
 */
export function checkWin(state: MatchState): MatchResult | null {
  if (state.status !== 'InProgress') return null;

  const { cells } = state.card;

  for (const line of LINES) {
    const first = cells[line[0]!]?.markedBy;
    if (first !== null && first !== undefined && line.every((i) => cells[i]?.markedBy === first)) {
      return { winnerId: first, reason: 'line' };
    }
  }

  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.markedBy !== null) {
      counts.set(cell.markedBy, (counts.get(cell.markedBy) ?? 0) + 1);
    }
  }
  for (const [playerId, count] of counts) {
    if (count >= 13) {
      return { winnerId: playerId, reason: 'majority' };
    }
  }

  return null;
}
