import { z } from 'zod';
import type { MatchState, Player, WinReason } from './match.js';
import type { WsErrorPayload } from './errors.js';

// ---------------------------------------------------------------------------
// Client → Server: Zod schemas
//
// The server parses every incoming WebSocket message with ClientMessageSchema.
// Discriminating on `type` narrows the `payload` type in switch/if blocks,
// so no casting is needed after a successful parse.
// ---------------------------------------------------------------------------

const baseClientFields = {
  matchId: z.string().uuid(),
  clientId: z.string().uuid(),
  eventId: z.string().uuid(), // Client-generated UUID; used for at-most-once processing
};

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SYNC_STATE'),         ...baseClientFields, payload: z.object({}) }),
  z.object({ type: z.literal('SET_READY'),          ...baseClientFields, payload: z.object({ ready: z.boolean() }) }),
  z.object({ type: z.literal('SET_LOBBY_SETTINGS'), ...baseClientFields, payload: z.object({ timerMode: z.enum(['stopwatch', 'countdown']), countdownDurationMs: z.number().int().positive().optional() }) }),
  z.object({ type: z.literal('START_MATCH'),        ...baseClientFields, payload: z.object({}) }),
  z.object({ type: z.literal('MARK_CELL'),          ...baseClientFields, payload: z.object({ cellIndex: z.number().int().min(0).max(24) }) }),
  z.object({ type: z.literal('UNMARK_CELL'),        ...baseClientFields, payload: z.object({ cellIndex: z.number().int().min(0).max(24) }) }),
  z.object({ type: z.literal('RESHUFFLE_BOARD'),    ...baseClientFields, payload: z.object({}) }),
  z.object({ type: z.literal('BACK_TO_LOBBY'),      ...baseClientFields, payload: z.object({}) }),
  z.object({ type: z.literal('REMATCH'),            ...baseClientFields, payload: z.object({}) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Derived from the union — stays in sync with ClientMessageSchema automatically. */
export type ClientIntentType = ClientMessage['type'];

/** Payload types extracted from the discriminated union. */
export type SetReadyPayload   = Extract<ClientMessage, { type: 'SET_READY'   }>['payload'];
export type MarkCellPayload   = Extract<ClientMessage, { type: 'MARK_CELL'   }>['payload'];
export type UnmarkCellPayload = Extract<ClientMessage, { type: 'UNMARK_CELL' }>['payload'];

// ---------------------------------------------------------------------------
// Server → Client: plain TypeScript
//
// These shapes are constructed by trusted server code. No runtime validation
// is needed — TypeScript enforces correctness at compile time.
// ---------------------------------------------------------------------------

export type ServerMessageType =
  | 'STATE_SYNC'       // Single-recipient hydration response to SYNC_STATE
  | 'STATE_UPDATE'     // Broadcast after every accepted intent
  | 'ERROR'            // Validation failure or rejected intent
  | 'MATCH_STARTED'    // Convenience broadcast on match start
  | 'MATCH_COMPLETED'  // Broadcast with win reason on match end
  | 'PRESENCE_UPDATE'; // Broadcast on join, leave, disconnect, reconnect

export interface StateSyncPayload {
  state: MatchState;
}

export interface StateUpdatePayload {
  state: MatchState;
  lastAppliedEventId?: string;
}

export interface MatchCompletedPayload {
  reason: WinReason;
  winnerId: string | null; // null on draw
}

export interface PresenceUpdatePayload {
  players: Player[];
}

export type ServerMessage =
  | { type: 'STATE_SYNC';      matchId: string; payload: StateSyncPayload }
  | { type: 'STATE_UPDATE';    matchId: string; payload: StateUpdatePayload }
  | { type: 'ERROR';           matchId: string; payload: WsErrorPayload }
  | { type: 'MATCH_STARTED';   matchId: string; payload: Record<string, never> }
  | { type: 'MATCH_COMPLETED'; matchId: string; payload: MatchCompletedPayload }
  | { type: 'PRESENCE_UPDATE'; matchId: string; payload: PresenceUpdatePayload };
