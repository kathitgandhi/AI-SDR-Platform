import { Request } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { getUserId } from './user-scope';

export interface AuditEntry {
  action: string;
  entity_type: string;
  entity_id?: string | null;
  changes?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit log write. Failures are swallowed (logged) so that audit
 * failures never break the user-facing request.
 */
export function audit(
  supabase: SupabaseClient,
  logger: Logger,
  req: Request,
  entry: AuditEntry,
): void {
  const userId = getUserId(req);
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
  const ua = req.headers['user-agent'] ?? null;

  void supabase
    .from('audit_log')
    .insert({
      user_id: userId ?? null,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id ?? null,
      changes: entry.changes ?? {},
      ip_address: ip,
      user_agent: ua,
    })
    .then(({ error }) => {
      if (error) logger.warn({ err: error }, 'audit log insert failed');
    });
}
