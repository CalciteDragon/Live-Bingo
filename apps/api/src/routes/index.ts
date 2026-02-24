import { Router } from 'express';

export const matchRouter = Router();

// POST /matches — create a new match
matchRouter.post('/', (_req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// POST /matches/:id/join — join an existing match
matchRouter.post('/:id/join', (_req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});

// GET /matches/:id — initial state hydration
matchRouter.get('/:id', (_req, res) => {
  res.status(501).json({ message: 'Not implemented' });
});
