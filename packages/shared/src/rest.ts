import { z } from 'zod';
import type { MatchState } from './match.js';

// ---------------------------------------------------------------------------
// Zod schemas for incoming REST data (trust boundary)
// ---------------------------------------------------------------------------

/** Validates the X-Client-Id header required on all REST requests. */
export const ClientIdHeaderSchema = z.string().uuid();

/** POST /matches/:id/join — only REST endpoint with a request body. */
export const JoinMatchBodySchema = z.object({
  joinCode: z.string().min(1).optional(),
});
export type JoinMatchBody = z.infer<typeof JoinMatchBodySchema>;

// ---------------------------------------------------------------------------
// Plain TypeScript for REST response shapes (server-generated, trusted)
// ---------------------------------------------------------------------------

export interface CreateMatchResponse {
  matchId: string;
  joinCode: string;
  joinUrl: string;
  state: MatchState;
}

export interface JoinMatchResponse {
  matchId: string;
  playerId: string;
  state: MatchState;
}

export interface GetMatchResponse {
  matchId: string;
  playerId: string;
  state: MatchState;
}
