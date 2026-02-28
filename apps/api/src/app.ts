import express from 'express';
import cors from 'cors';
import { matchRouter } from './routes/index.js';

export function createApp(): express.Application {
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
  return app;
}
