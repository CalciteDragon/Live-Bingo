import type { Request, Response, NextFunction } from 'express';
import { ClientIdHeaderSchema } from '@bingo/shared';

export function clientIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const result = ClientIdHeaderSchema.safeParse(req.headers['x-client-id']);
  if (!result.success) {
    res.status(400).json({ code: 'INVALID_EVENT', message: 'Missing or invalid X-Client-Id header' });
    return;
  }
  res.locals['clientId'] = result.data;
  next();
}
