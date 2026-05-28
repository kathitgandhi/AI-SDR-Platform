import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { AirDesk360Adapter } from '@ai-sdr/integrations';

export interface CrmSyncJobPayload {
  entity: 'lead' | 'contact' | 'company' | 'ticket' | 'call';
  entityId: string;
  action: 'create' | 'update' | 'delete';
  provider?: string;
}

interface CrmSyncDeps {
  supabase: SupabaseClient;
  connection: Redis;
  logger: Logger;
  config: {
    provider: string;
    airdeskBaseUrl?: string;
    airdeskApiKey?: string;
    airdeskDefaultUserId?: string;
    airdeskDefaultDepartmentId?: string;
  };
}

/**
 * Consumes the `crm-sync` queue. Each job pushes one entity to the configured
 * CRM provider. Currently supports `airdesk360`; gracefully no-ops if provider
 * is `none` or env is missing.
 *
 * Triggered from: transcript.worker.ts (after every call), leads.router.ts
 * (on POST/PATCH), tickets.router.ts (on POST/PATCH).
 */
export function createCrmSyncWorker(deps: CrmSyncDeps): Worker {
  const { supabase, connection, logger, config } = deps;
  const workerLogger = logger.child({ worker: 'crm-sync' });

  // Build adapter once (reused across jobs)
  let adapter: AirDesk360Adapter | null = null;
  if (config.provider === 'airdesk360' && config.airdeskBaseUrl && config.airdeskApiKey) {
    adapter = new AirDesk360Adapter({
      AIRDESK360_BASE_URL: config.airdeskBaseUrl,
      AIRDESK360_API_KEY: config.airdeskApiKey,
      AIRDESK360_DEFAULT_USER_ID: config.airdeskDefaultUserId ?? '1',
      AIRDESK360_DEFAULT_DEPARTMENT_ID: config.airdeskDefaultDepartmentId ?? '1',
    });
  }

  return new Worker<CrmSyncJobPayload>(
    'crm-sync',
    async (job: Job<CrmSyncJobPayload>) => {
      const { entity, entityId, action } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, entity, entityId, action });

      if (!adapter) {
        jobLogger.debug({ provider: config.provider }, 'CRM provider not configured — skipping');
        return { skipped: true, reason: 'no_adapter' };
      }

      if (entity === 'lead') {
        return await syncLead(supabase, adapter, entityId, jobLogger);
      }

      if (entity === 'ticket') {
        return await syncTicket(supabase, adapter, entityId, jobLogger);
      }

      jobLogger.warn({ entity }, 'Unsupported entity type for CRM sync');
      return { skipped: true, reason: 'unsupported_entity' };
    },
    { connection, concurrency: 2 },
  );
}

async function syncLead(
  supabase: SupabaseClient,
  adapter: AirDesk360Adapter,
  leadId: string,
  logger: Logger,
): Promise<{ customer_id: string; contact_id: string; lead_id: string }> {
  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, stage, last_call_summary, contacts(*), companies(*)')
    .eq('id', leadId)
    .single();
  if (error || !lead) throw new Error(`Lead ${leadId} not found`);

  const contact = (lead as any).contacts ?? {};
  const company = (lead as any).companies ?? {};
  if (!company.name) throw new Error(`Lead ${leadId} has no company name`);

  // 1. customer
  let customerId = '';
  try {
    customerId = await adapter.createOrUpdateCompany({
      name: company.name,
      domain: company.website,
      employeeCount: company.employee_count ?? undefined,
      storeCount: company.store_count ?? undefined,
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Customer sync failed');
  }

  // 2. contact
  let contactCrmId = '';
  if (customerId && contact.email) {
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
      });
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'Contact sync failed');
    }
  }

  // 3. lead
  let leadCrmId = '';
  try {
    leadCrmId = await adapter.createDeal({
      contactId: contactCrmId,
      companyId: customerId,
      name: `${company.name} — ${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim(),
      stage: lead.stage,
      notes: (lead as any).last_call_summary ?? '',
    });
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Lead sync failed');
  }

  logger.info({ customerId, contactCrmId, leadCrmId }, 'Lead synced to AirDesk360');
  return { customer_id: customerId, contact_id: contactCrmId, lead_id: leadCrmId };
}

async function syncTicket(
  supabase: SupabaseClient,
  adapter: AirDesk360Adapter,
  ticketId: string,
  logger: Logger,
): Promise<{ crm_ticket_id: string }> {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('id, title, description, priority, contact_id, company_id, contacts(first_name, last_name, email)')
    .eq('id', ticketId)
    .single();
  if (error || !ticket) throw new Error(`Ticket ${ticketId} not found`);

  // AirDesk requires a contactid — we'd need the AirDesk contact ID, which we
  // don't track yet. Skip for now (sync only works if user provides it via the
  // POST /api/v1/crm/sync/ticket/:id endpoint manually with airdesk_contact_id).
  logger.warn({ ticketId }, 'Ticket auto-sync skipped — requires AirDesk contact ID mapping');
  return { crm_ticket_id: '' };
}
