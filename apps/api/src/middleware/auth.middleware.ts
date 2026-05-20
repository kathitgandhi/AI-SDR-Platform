import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from '../config/env';
import { UnauthorizedError } from '../shared/errors';

const supabaseAuth = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket as any },
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface AuthedRequest extends Request {
  user?: { id: string; email?: string };
}

/**
 * Accepts either:
 *  - Authorization: Bearer <supabase JWT>  (user-context, used by browser frontend)
 *  - x-api-key: <API_SECRET_KEY>           (service-to-service, used by trusted backends)
 *
 * Public secrets like VITE_* MUST NOT carry the API key — frontend must use the
 * user's own Supabase session token instead.
 */
export async function requireAuth(
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey === env.API_SECRET_KEY) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const { data, error } = await supabaseAuth.auth.getUser(token);
      if (!error && data.user) {
        req.user = { id: data.user.id, email: data.user.email };
        next();
        return;
      }
    } catch {
      // fall through to 401
    }
  }

  next(new UnauthorizedError('Missing or invalid credentials'));
}

export const requireApiKey = requireAuth;
