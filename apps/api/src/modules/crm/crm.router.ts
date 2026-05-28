import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { createCrmAdapter, AirDesk360Adapter } from '@ai-sdr/integrations';
import { env } from '../../config/env';
import { ValidationError, NotFoundError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';
import { audit } from '../../shared/audit';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

function buildAdapter() {
  const config: Record<string, string> = {
    AIRDESK360_BASE_URL: env.AIRDESK360_BASE_URL ?? '',
    AIRDESK360_API_KEY: env.AIRDESK360_API_KEY ?? '',
    HUBSPOT_ACCESS_TOKEN: env.HUBSPOT_ACCESS_TOKEN ?? '',
    SALESFORCE_INSTANCE_URL: env.SALESFORCE_INSTANCE_URL ?? '',
    SALESFORCE_REFRESH_TOKEN: env.SALESFORCE_REFRESH_TOKEN ?? '',
    PIPEDRIVE_API_KEY: env.PIPEDRIVE_API_KEY ?? '',
    ZOHO_REFRESH_TOKEN: env.ZOHO_REFRESH_TOKEN ?? '',
  };
  return createCrmAdapter(env.CRM_PROVIDER, config);
}

export function createCrmRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/crm/health — connectivity check
  router.get('/health', async (_req: Request, res: Response) => {
    try {
      if (env.CRM_PROVIDER !== 'airdesk360') {
        res.json({ provider: env.CRM_PROVIDER, supported: env.CRM_PROVIDER !== 'none' });
        return;
      }
      const adapter = buildAdapter() as AirDesk360Adapter;
      const result = await adapter.ping();
      res.status(result.ok ? 200 : 502).json({ provider: 'airdesk360', ...result });
    } catch (err) {
      res.status(500).json({ provider: env.CRM_PROVIDER, ok: false, detail: (err as Error).message });
    }
  });

  // POST /api/v1/crm/sync/lead/:id — push one of our leads to the CRM
  router.post('/sync/lead/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase
        .from('leads')
        .select('*, contacts(*), companies(*)')
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data: lead, error } = await q.single();
      if (error || !lead) throw new NotFoundError('Lead', req.params.id);

      const adapter = buildAdapter();
      const contact = (lead as any).contacts ?? {};
      const company = (lead as any).companies ?? {};

      const warnings: string[] = [];

      // 1. customer (company)
      let customerId = '';
      try {
        customerId = await adapter.createOrUpdateCompany({
          name: company.name,
          domain: company.website,
          employeeCount: company.employee_count ?? undefined,
          storeCount: company.store_count ?? undefined,
        });
        if (!customerId) {
          warnings.push('Customer was sent to AirDesk360 but ID could not be resolved (search returned no match)');
        }
      } catch (e) {
        warnings.push(`Customer sync failed: ${(e as Error).message}`);
        logger.warn({ err: (e as Error).message }, 'Customer sync failed');
      }

      // 2. contact (linked to customer) — skip if no customer_id
      let contactCrmId = '';
      if (customerId) {
        try {
          contactCrmId = await adapter.createOrUpdateContact({
            firstName: contact.first_name,
            lastName: contact.last_name,
            email: contact.email,
            phone: contact.phone_direct,
            title: contact.title,
            companyId: customerId,
            companyName: company.name,
            source: 'AI_SDR',
            notes: lead.last_call_summary ?? undefined,
          });
          if (!contactCrmId) warnings.push('Contact sent to AirDesk360 but ID unresolved');
        } catch (e) {
          warnings.push(`Contact sync failed: ${(e as Error).message}`);
          logger.warn({ err: (e as Error).message }, 'Contact sync failed but continuing');
        }
      } else {
        warnings.push('Skipped contact sync (no customer_id)');
      }

      // 3. lead (deal in AirDesk parlance)
      let leadCrmId = '';
      try {
        leadCrmId = await adapter.createDeal({
          contactId: contactCrmId,
          companyId: customerId,
          name: `${company.name} — ${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
          stage: lead.stage,
          notes: lead.last_call_summary ?? '',
        });
        if (!leadCrmId) warnings.push('Lead sent to AirDesk360 but ID unresolved');
      } catch (e) {
        warnings.push(`Lead sync failed: ${(e as Error).message}`);
        logger.warn({ err: (e as Error).message }, 'Lead sync failed but continuing');
      }

      audit(supabase, logger, req, {
        action: 'sync',
        entity_type: 'lead',
        entity_id: lead.id,
        changes: { crm: env.CRM_PROVIDER, customer_id: customerId, contact_id: contactCrmId, lead_id: leadCrmId },
      });

      res.json({
        success: customerId !== '' || warnings.length === 0,
        crm: env.CRM_PROVIDER,
        synced: {
          customer_id: customerId,
          contact_id: contactCrmId,
          lead_id: leadCrmId,
        },
        warnings,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/crm/sync/ticket/:id — push one of our tickets to AirDesk360
  router.post('/sync/ticket/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase
        .from('tickets')
        .select('*, contacts(first_name, last_name, email)')
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data: ticket, error } = await q.single();
      if (error || !ticket) throw new NotFoundError('Ticket', req.params.id);

      if (env.CRM_PROVIDER !== 'airdesk360') {
        throw new ValidationError('CRM_PROVIDER must be airdesk360 to sync tickets');
      }

      const adapter = buildAdapter() as AirDesk360Adapter;
      const crmId = await adapter.createTicket({
        subject: ticket.title,
        description: ticket.description ?? '',
        priority: ticket.priority,
        contactId: (req.body.airdesk_contact_id ?? '') as string, // user must provide AirDesk contact ID
      });

      audit(supabase, logger, req, {
        action: 'sync',
        entity_type: 'ticket',
        entity_id: ticket.id,
        changes: { crm: 'airdesk360', crm_id: crmId },
      });

      res.json({ success: true, crm_ticket_id: crmId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
