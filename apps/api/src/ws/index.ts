import type { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { ClientMessageSchema } from '@bingo/shared';

export function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  wss.handleUpgrade(req, socket as import('node:stream').Duplex, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req);
    handleConnection(ws);
  });
}

function handleConnection(ws: WebSocket): void {
  ws.on('message', (data) => {
    const result = ClientMessageSchema.safeParse(JSON.parse(data.toString()));
    if (!result.success) {
      // TODO: send ERROR back to client
      return;
    }
    // TODO: route result.data to intent handlers
  });

  ws.on('close', () => {
    // TODO: handle disconnect / presence update
  });
}
