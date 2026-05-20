import { Request } from 'express';

/**
 * Returns the user id from the request if authenticated via JWT.
 * Service-to-service callers (x-api-key) won't have req.user — returns undefined,
 * which the routers interpret as "admin scope, no filter".
 */
export function getUserId(req: Request): string | undefined {
  return (req as Request & { user?: { id: string } }).user?.id;
}
