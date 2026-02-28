import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { matchRouter } from './routes/index.js';
import { handleUpgrade } from './ws/index.js';

const app = express();
app.use(cors({ origin: process.env['CLIENT_ORIGIN'] }));
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use('/matches', matchRouter);

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  handleUpgrade(wss, req, socket, head);
});

const PORT = process.env['PORT'] ?? 3000;
server.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
