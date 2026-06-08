import { Request } from 'express';

/**
 * Returns the user id from the request if authenticated via JWT.
 * Service-to-service callers (x-api-key) won't have req.user — returns undefined,
 * which the routers interpret as "admin scope, no filter".
 */
export function getUserId(req: Request): string | undefined {
  return (req as Request & { user?: { id: string } }).user?.id;
}

/**
 * Read-scope user id for SHARED business data (leads, calls, call_transcripts,
 * appointments, emails, notes, tickets, dnc_list, campaigns, dashboards).
 *
 * This is a single-team internal tool. The AI workers create the vast majority
 * of these rows (calls, transcripts, appointments, auto-notes, DNC requests)
 * with created_by = NULL because they run with no user context. Filtering these
 * reads by the caller's id therefore hides ALL AI-generated data — which is what
 * made the Conversations / Meetings / Dashboard screens come up empty.
 *
 * So by default we DO NOT scope reads of shared business data (returns undefined
 * = "no filter", which every router already interprets as admin scope). Set
 * MULTI_TENANT_READS=true to restore strict per-user read scoping.
 *
 * Per-user tables (app_settings, audit_log, imports) intentionally keep using
 * getUserId, and all WRITES keep stamping created_by via getUserId.
 */
export function getReadScopeUserId(req: Request): string | undefined {
  if (process.env['MULTI_TENANT_READS'] === 'true') return getUserId(req);
  return undefined;
}
