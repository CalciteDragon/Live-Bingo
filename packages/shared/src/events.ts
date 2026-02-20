import type { MatchState, Player, WinReason } from './match.js';
import type { WsErrorPayload } from './errors.js';

// ---------------------------------------------------------------------------
// Client → Server intent types
// ---------------------------------------------------------------------------

export type ClientIntentType =
  | 'SYNC_STATE'       // Request current state on connect/reconnect
  | 'SET_READY'        // Toggle ready state in lobby
  | 'START_MATCH'      // Host-only: start the match
  | 'MARK_CELL'        // Mark an unmarked cell
  | 'UNMARK_CELL'      // Unmark a cell the caller originally marked
  | 'RESHUFFLE_BOARD'  // Host-only: regenerate board (only if no cells marked)
  | 'BACK_TO_LOBBY'    // Host-only: return to lobby from InProgress or Completed
  | 'REMATCH';         // Host-only: restart from Completed with same seed

// ---------------------------------------------------------------------------
// Client → Server payload shapes
// ---------------------------------------------------------------------------

export interface SetReadyPayload {
  ready: boolean;
}

export interface MarkCellPayload {
  cellIndex: number; // 0–24
}

export interface UnmarkCellPayload {
  cellIndex: number; // 0–24
}

// ---------------------------------------------------------------------------
// Client → Server envelope
// ---------------------------------------------------------------------------

export interface ClientMessage<P = unknown> {
  type: ClientIntentType;
  matchId: string;
  clientId: string;
  eventId: string; // Client-generated UUID; used for at-most-once processing
  payload: P;
}

// ---------------------------------------------------------------------------
// Server → Client message types
// ---------------------------------------------------------------------------

export type ServerMessageType =
  | 'STATE_SYNC'      // Single-recipient hydration response to SYNC_STATE
  | 'STATE_UPDATE'    // Broadcast after every accepted intent
  | 'ERROR'           // Validation failure or rejected intent
  | 'MATCH_STARTED'   // Convenience broadcast on match start
  | 'MATCH_COMPLETED' // Broadcast with win reason on match end
  | 'PRESENCE_UPDATE'; // Broadcast on join, leave, disconnect, reconnect

// ---------------------------------------------------------------------------
// Server → Client payload shapes
// ---------------------------------------------------------------------------

export interface StateSyncPayload {
  state: MatchState;
}

export interface StateUpdatePayload {
  state: MatchState;
  lastAppliedEventId?: string;
}

export interface MatchCompletedPayload {
  reason: WinReason;
  winnerId: string | null; // playerId, null on draw
}

export interface PresenceUpdatePayload {
  players: Player[];
}

// WsErrorPayload is re-exported here for consumers who only import from events
export type { WsErrorPayload };

// ---------------------------------------------------------------------------
// Server → Client envelope
// ---------------------------------------------------------------------------

export interface ServerMessage<P = unknown> {
  type: ServerMessageType;
  matchId: string;
  payload: P;
}
