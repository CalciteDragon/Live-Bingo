import 'dotenv/config';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { handleUpgrade } from './ws/index.js';
import { db } from './db/index.js';
import { setMatch } from './match-registry.js';
import type { MatchState } from '@bingo/shared';

const app = createApp();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  handleUpgrade(wss, req, socket, head);
});

const PORT = process.env['PORT'] ?? 3000;

async function start(): Promise<void> {
  const { rows } = await db.query<{ match_id: string; state_json: MatchState }>(
    `SELECT match_id, state_json FROM matches WHERE status IN ('Lobby', 'InProgress')`,
  );
  for (const row of rows) {
    setMatch(row.match_id, { state: row.state_json, sockets: new Map() });
    // TODO (Phase 5): reschedule countdown timer if InProgress and timerMode is countdown
  }
  if (rows.length > 0) {
    console.log(`Hydrated ${rows.length} active match(es) from database`);
  }

  server.listen(PORT, () => {
    console.log(`API listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
