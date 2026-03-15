import type { Slot, MatchState, Player, ClientMessage, ClientIntentType } from '@bingo/shared';
import { randomUUID } from './uuid';

export function getMyPlayer(state: MatchState, playerId: string): Player | undefined {
  return state.players.find(p => p.playerId === playerId);
}

export function isHost(state: MatchState, playerId: string): boolean {
  const player = getMyPlayer(state, playerId);
  return player?.slot === 1;
}

export function isAllPlayersReady(state: MatchState): boolean {
  if (state.players.length < 2) return false;
  return state.players.every(p => state.readyStates[p.playerId] === true);
}

export function buildClientMessage<T extends ClientIntentType>(
  type: T,
  matchId: string,
  clientId: string,
  payload: Extract<ClientMessage, { type: T }>['payload'],
): Extract<ClientMessage, { type: T }> {
  return {
    type,
    matchId,
    clientId,
    eventId: randomUUID(),
    payload,
  } as Extract<ClientMessage, { type: T }>;
}

/** One canonical color per player slot, used consistently across all UI surfaces. */
export const SLOT_COLORS: Record<Slot, string> = {
  1: '#4a9eff',
  2: '#ff6b6b',
  3: '#51cf66',
  4: '#fcc419',
};

/**
 * Returns a map of playerId → CSS color for all players in the match.
 *
 * FFA: color derived from player slot.
 * Team mode: replace with buildTeamColorMap() where teammates share a color.
 * BingoCellComponent receives the result of this function and is agnostic
 * about how colors were determined.
 */
export function buildPlayerColorMap(state: MatchState): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of state.players) {
    map[p.playerId] = SLOT_COLORS[p.slot];
  }
  return map;
}

export interface PlayerRankEntry {
  playerId: string;
  alias: string;
  slot: Slot;
  color: string;
  score: number;
  rank: number; // dense ranking (1,2,2,3)
  isMe: boolean;
}

/** Computes dense rankings for all players by current cell count. */
export function getPlayerRankings(state: MatchState, myPlayerId: string): PlayerRankEntry[] {
  const counts: Record<string, number> = {};
  for (const cell of state.card.cells) {
    if (cell.markedBy) {
      counts[cell.markedBy] = (counts[cell.markedBy] ?? 0) + 1;
    }
  }

  const scored = state.players.map((p) => ({
    playerId: p.playerId,
    alias: p.alias ?? 'Unknown',
    slot: p.slot,
    color: SLOT_COLORS[p.slot],
    score: counts[p.playerId] ?? 0,
    isMe: p.playerId === myPlayerId,
  }));

  scored.sort((a, b) => b.score - a.score);

  let rank = 1;
  return scored.map((entry, i) => {
    if (i > 0 && entry.score < scored[i - 1]!.score) rank++;
    return { ...entry, rank };
  });
}

/** Returns ordinal label for a rank number (1→'1st', 2→'2nd', etc.) */
export function ordinalLabel(rank: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = rank % 100;
  return rank + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]!);
}
