export type MatchStatus = 'Lobby' | 'InProgress' | 'Completed' | 'Abandoned';

export type TimerMode = 'stopwatch' | 'countdown';

export type Slot = 1 | 2 | 3 | 4;

export type MatchMode = 'ffa'; // | 'teams_2v2' when team mode is added

export type WinReason = 'line' | 'majority' | 'timer_expiry' | 'draw';

export interface Player {
  playerId: string;
  clientId: string;
  slot: Slot;
  alias: string | null;
  connected: boolean;
}

/** A single square on the 5×5 board. Index is row-major (0–24). */
export interface Cell {
  index: number;
  goal: string;
  markedBy: string | null; // playerId of the player who marked it, or null
}

export interface BingoCard {
  seed: number;
  cells: Cell[]; // length 25, row-major order
}

export interface LobbySettings {
  timerMode: TimerMode;
  countdownDurationMs: number | null; // null in stopwatch mode
}

export interface TimerState {
  mode: TimerMode;
  startedAt: string | null; // ISO 8601 timestamp, null until match starts
  stoppedAt: string | null; // ISO 8601 timestamp, null until match completes
  countdownDurationMs: number | null; // null in stopwatch mode
}

export interface MatchResult {
  winnerId: string | null; // playerId of winner, null on draw
  reason: WinReason;
}

/**
 * Authoritative snapshot of the entire match at a point in time.
 * This is what gets persisted as state_json and broadcast over WebSocket.
 */
export interface MatchState {
  matchId: string;
  matchMode: MatchMode; // dispatch point for mode-specific logic
  status: MatchStatus;
  players: Player[];
  readyStates: Record<string, boolean>; // playerId → ready
  lobbySettings: LobbySettings;
  card: BingoCard;
  timer: TimerState;
  result: MatchResult | null;
}
