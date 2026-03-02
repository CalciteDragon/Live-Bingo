import type { MatchState, Player, ClientMessage, ClientIntentType } from '@bingo/shared';

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
    eventId: crypto.randomUUID(),
    payload,
  } as Extract<ClientMessage, { type: T }>;
}
