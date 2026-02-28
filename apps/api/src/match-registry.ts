import type { WebSocket } from 'ws';
import type { MatchState } from '@bingo/shared';

export interface MatchEntry {
  state: MatchState;
  sockets: Map<string, WebSocket>; // clientId → WebSocket
  abandonTimer?: NodeJS.Timeout;   // set when both players disconnect
  countdownTimer?: NodeJS.Timeout; // set when match starts in countdown mode
}

const registry = new Map<string, MatchEntry>();

export function getMatch(matchId: string): MatchEntry | undefined {
  return registry.get(matchId);
}

export function setMatch(matchId: string, entry: MatchEntry): void {
  registry.set(matchId, entry);
}

export function deleteMatch(matchId: string): void {
  registry.delete(matchId);
}

export function registerSocket(matchId: string, clientId: string, ws: WebSocket): void {
  const entry = registry.get(matchId);
  if (entry) {
    entry.sockets.set(clientId, ws);
  }
}

export function removeSocket(matchId: string, clientId: string): void {
  const entry = registry.get(matchId);
  if (entry) {
    entry.sockets.delete(clientId);
  }
}
