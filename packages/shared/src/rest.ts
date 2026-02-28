import { z } from 'zod';
import type { MatchState } from './match.js';

// ---------------------------------------------------------------------------
// Zod schemas for incoming REST data (trust boundary)
// ---------------------------------------------------------------------------

/** Validates the X-Client-Id header required on all REST requests. */
export const ClientIdHeaderSchema = z.string().uuid();

/** POST /matches — create a new match. */
export const CreateMatchBodySchema = z
  .object({
    alias: z.string().min(1).max(32),
    timerMode: z.enum(['stopwatch', 'countdown']),
    countdownDurationMs: z.number().int().positive().optional(),
  })
  .refine((data) => data.timerMode !== 'countdown' || data.countdownDurationMs != null, {
    message: 'countdownDurationMs is required when timerMode is countdown',
    path: ['countdownDurationMs'],
  });
export type CreateMatchBody = z.infer<typeof CreateMatchBodySchema>;

/** POST /matches/:id/join — join an existing match. */
export const JoinMatchBodySchema = z.object({
  alias: z.string().min(1).max(32),
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
