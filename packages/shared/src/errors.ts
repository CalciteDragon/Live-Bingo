/** Error codes returned by REST endpoints. */
export type RestErrorCode =
  | 'JOIN_CODE_EXPIRED'    // Join code has passed its 30-minute TTL
  | 'JOIN_CODE_INVALID'    // Join code does not match any active match
  | 'MATCH_NOT_FOUND'      // No match exists with the given ID
  | 'MATCH_FULL'           // Match already has two players
  | 'MATCH_NOT_JOINABLE'   // Match is not in Lobby state
  | 'CLIENT_CONFLICT'      // clientId already associated with a different player
  | 'FORBIDDEN';           // Caller is not a participant in this match

/** Error codes sent over WebSocket for rejected intents. */
export type WsErrorCode =
  | 'INVALID_EVENT'    // Malformed message envelope or unknown event type
  | 'NOT_AUTHORIZED'   // Caller lacks permission (e.g. guest sending host-only event)
  | 'INVALID_STATE'    // Event not valid in the current match state
  | 'DUPLICATE_EVENT'  // eventId has already been processed for this match
  | 'SESSION_REPLACED' // Another connection opened for the same clientId; this socket is stale
  | 'KICKED';          // Player was removed from the lobby by the host or auto-kick

export interface RestErrorResponse {
  code: RestErrorCode;
  message: string;
}

export interface WsErrorPayload {
  code: WsErrorCode;
  message: string;
  rejectedEventId?: string;
}
