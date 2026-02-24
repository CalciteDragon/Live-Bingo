import type { MatchState, MatchResult } from '@bingo/shared';
import type { ClientMessage } from '@bingo/shared';

export function validateEvent(_state: MatchState, _event: ClientMessage): void {
  // TODO: validate event against current state; throw on rejection
}

export function applyEvent(state: MatchState, _event: ClientMessage): MatchState {
  // TODO: return new state derived from applying event
  return state;
}

export function checkWin(_state: MatchState): MatchResult | null {
  // TODO: detect line, majority, or timer-expiry win conditions
  return null;
}
