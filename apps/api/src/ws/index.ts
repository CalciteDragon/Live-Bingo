import { URL } from 'node:url';
import { WebSocket } from 'ws';
import type { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ServerMessage } from '@bingo/shared';
import { db } from '../db/index.js';
import {
  getMatch,
  setMatch,
  registerSocket,
  removeSocketIfCurrent,
  broadcastToMatch,
} from '../match-registry.js';
import { processMessage } from './message-pipeline.js';
import {
  scheduleAbandonTimer,
  cancelAbandonTimer,
  scheduleCountdownTimer,
  cancelLobbyKickTimer,
  scheduleLobbyKickTimer,
} from './match-timers.js';

export { scheduleCountdownTimer, scheduleAbandonTimer };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendTo(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ─── Upgrade validation ───────────────────────────────────────────────────────

function validateUpgradeRequest(
  req: IncomingMessage,
  socket: Duplex,
): { matchId: string; clientId: string } | null {
  const url = new URL(req.url ?? '', 'ws://localhost');
  const matchId = url.searchParams.get('matchId');
  const clientId = url.searchParams.get('clientId');

  if (!matchId || !UUID_RE.test(matchId) || !clientId || !UUID_RE.test(clientId)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return null;
  }

  const entry = getMatch(matchId);
  if (!entry || !entry.state.players.some((p) => p.clientId === clientId)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return null;
  }

  return { matchId, clientId };
}

// ─── Connection lifecycle ─────────────────────────────────────────────────────

async function onClientConnected(ws: WebSocket, matchId: string, clientId: string): Promise<void> {
  registerSocket(matchId, clientId, ws);
  cancelAbandonTimer(matchId);

  const entry = getMatch(matchId)!;
  const reconnectingPlayer = entry.state.players.find((p) => p.clientId === clientId);
  if (reconnectingPlayer) {
    cancelLobbyKickTimer(matchId, reconnectingPlayer.playerId);
  }
  const updatedState = {
    ...entry.state,
    players: entry.state.players.map((p) =>
      p.clientId === clientId ? { ...p, connected: true } : p,
    ),
  };
  setMatch(matchId, { ...entry, state: updatedState });

  db.query('UPDATE matches SET state_json = $1 WHERE match_id = $2', [
    JSON.stringify(updatedState),
    matchId,
  ]).catch((err) => console.error('[ws] Failed to persist connect state:', err));

  broadcastToMatch(matchId, {
    type: 'PRESENCE_UPDATE',
    matchId,
    payload: { players: updatedState.players, readyStates: updatedState.readyStates },
  });

  sendTo(ws, { type: 'STATE_SYNC', matchId, payload: { state: updatedState } });

  ws.on('message', (data) => {
    processMessage(ws, matchId, clientId, data.toString()).catch((err) =>
      console.error('[ws] Unhandled error in processMessage:', err),
    );
  });

  ws.on('close', () => {
    handleDisconnect(ws, matchId, clientId).catch((err) =>
      console.error('[ws] Unhandled error in handleDisconnect:', err),
    );
  });
}

async function handleDisconnect(ws: WebSocket, matchId: string, clientId: string): Promise<void> {
  const removed = removeSocketIfCurrent(matchId, clientId, ws);
  if (!removed) return;

  const entry = getMatch(matchId);
  if (!entry) return;

  const disconnectedPlayer = entry.state.players.find((p) => p.clientId === clientId);
  let updatedState = {
    ...entry.state,
    players: entry.state.players.map((p) =>
      p.clientId === clientId ? { ...p, connected: false } : p,
    ),
  };
  if (entry.state.status === 'Lobby' && disconnectedPlayer) {
    updatedState = {
      ...updatedState,
      readyStates: { ...updatedState.readyStates, [disconnectedPlayer.playerId]: false },
    };
  }

  await db.query('UPDATE matches SET state_json = $1 WHERE match_id = $2', [
    JSON.stringify(updatedState),
    matchId,
  ]);

  setMatch(matchId, { ...entry, state: updatedState });
  broadcastToMatch(matchId, {
    type: 'PRESENCE_UPDATE',
    matchId,
    payload: { players: updatedState.players, readyStates: updatedState.readyStates },
  });

  // Schedule auto-kick for non-host players who disconnect in Lobby
  if (updatedState.status === 'Lobby' && disconnectedPlayer && disconnectedPlayer.slot !== 1) {
    scheduleLobbyKickTimer(matchId, disconnectedPlayer.playerId);
  }

  const allDisconnected = updatedState.players.every((p) => !p.connected);
  if (allDisconnected) {
    scheduleAbandonTimer(matchId);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const credentials = validateUpgradeRequest(req, socket);
  if (!credentials) return;

  const { matchId, clientId } = credentials;

  wss.handleUpgrade(req, socket as import('node:stream').Duplex, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req);
    onClientConnected(ws, matchId, clientId).catch((err) =>
      console.error('[ws] Unhandled error in onClientConnected:', err),
    );
  });
}
