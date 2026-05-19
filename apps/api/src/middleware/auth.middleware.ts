import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { UnauthorizedError } from '../shared/errors';

export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'];
  if (!key || key !== env.API_SECRET_KEY) {
    return next(new UnauthorizedError('Invalid or missing API key'));
  }
  next();
}
