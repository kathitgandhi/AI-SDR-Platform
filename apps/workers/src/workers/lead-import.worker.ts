import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { ZoomInfoClient, IcpFilter, DEFAULT_ICP_FILTER, ZoomInfoCompany, ZoomInfoContact } from '@ai-sdr/integrations';

export interface LeadImportJobPayload {
  campaignId: string;
  page: number;
  pageSize: number;
  /** Optional partial ICP filter override. Missing keys fall back to DEFAULT_ICP_FILTER. */
  filter?: Partial<IcpFilter>;
}

interface LeadImportDeps {
  supabase: SupabaseClient;
  zoomInfoClient: ZoomInfoClient;
  connection: Redis;
  logger: Logger;
  /** Downstream queues. Handed off to after a lead row is created. */
  crmSyncQueue: Queue;
  phoneLookupQueue: Queue;
  /** Self-reference, used to enqueue the next page for auto-pagination. */
  leadImportQueue: Queue;
}

interface ImportResult {
  companies: number;
  contacts: number;
  leads: number;
  skipped: number;
  totalPages: number;
}

/**
 * Consumes the `lead-import` queue. Each job pulls one page of ICP-matched
 * companies + contacts from ZoomInfo, maps them into Supabase
 * (companies → contacts → leads), fires CRM sync, and hands each callable lead
 * to the phone-lookup stage (which is responsible for filtering out mobiles per
 * compliance rules).
 *
 * Triggered from: MCP `trigger_lead_import` tool / pipeline scheduler.
 *
 * Notes:
 *  - This runs in admin scope (no per-user req.user.id), so `created_by` is null.
 *  - Dedupe mirrors the CSV import path: companies by name, contacts by email.
 *  - We store the contact's DIRECT phone only (never mobilePhone) — mobiles must
 *    not be called (federal rule); phone-lookup re-verifies line type downstream.
 */
export function createLeadImportWorker(deps: LeadImportDeps): Worker {
  const { supabase, zoomInfoClient, connection, logger, crmSyncQueue, phoneLookupQueue, leadImportQueue } = deps;
  const workerLogger = logger.child({ worker: 'lead-import' });

  return new Worker<LeadImportJobPayload>(
    'lead-import',
    async (job: Job<LeadImportJobPayload>): Promise<ImportResult> => {
      const { campaignId, page = 1, pageSize = 100, filter } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, campaignId, page });

      const effectiveFilter: IcpFilter = { ...DEFAULT_ICP_FILTER, ...(filter ?? {}) };

      // Create a tracking row so the import shows up in the UI alongside CSV imports.
      const importLabel = `zoominfo:${effectiveFilter.targetIndustries.slice(0, 3).join(',')} p${page}`;
      const { data: importRow } = await supabase
        .from('csv_imports')
        .insert({
          user_id: null,
          filename: importLabel,
          total_rows: 0,
          campaign_id: campaignId ?? null,
          status: 'processing',
        })
        .select('id')
        .single();

      jobLogger.info({ filter: effectiveFilter.targetIndustries }, 'Pulling ICP leads from ZoomInfo');

      let pull: { companies: ZoomInfoCompany[]; contacts: ZoomInfoContact[]; totalPages: number };
      try {
        pull = await zoomInfoClient.pullIcpLeads(effectiveFilter, page, pageSize);
      } catch (err) {
        jobLogger.error({ err: (err as Error).message }, 'ZoomInfo pull failed');
        if (importRow) {
          await supabase
            .from('csv_imports')
            .update({ status: 'failed', errors: [{ message: (err as Error).message }], completed_at: new Date().toISOString() })
            .eq('id', importRow.id);
        }
        throw err;
      }

      const result: ImportResult = {
        companies: 0,
        contacts: 0,
        leads: 0,
        skipped: 0,
        totalPages: pull.totalPages,
      };

      // 1. Upsert companies, building a map: ZoomInfo company id → our DB UUID.
      const companyIdMap = new Map<number, string>();
      for (const co of pull.companies) {
        try {
          const dbId = await upsertCompany(supabase, co);
          companyIdMap.set(co.id, dbId);
          result.companies++;
        } catch (e) {
          jobLogger.warn({ company: co.name, err: (e as Error).message }, 'Company upsert failed');
        }
      }

      // 2. For each contact, upsert + create a lead linked to its company.
      for (const ct of pull.contacts) {
        const companyId = companyIdMap.get(ct.companyId);
        if (!companyId) {
          result.skipped++;
          continue;
        }
        // Direct line only — never queue a mobile for calling.
        const directPhone = ct.directPhoneDoNotCall ? null : (ct.phone || null);

        try {
          const contactId = await upsertContact(supabase, ct, companyId, directPhone);

          const { data: lead, error: leadErr } = await supabase
            .from('leads')
            .insert({
              campaign_id: campaignId ?? null,
              contact_id: contactId,
              company_id: companyId,
              stage: 'new',
              source: 'zoominfo',
              created_by: null,
            })
            .select('id')
            .single();
          if (leadErr || !lead) {
            result.skipped++;
            continue;
          }
          result.contacts++;
          result.leads++;

          // CRM sync (consumer exists today).
          await crmSyncQueue.add('sync', { entity: 'lead', entityId: lead.id, action: 'create', provider: 'airdesk360' });

          // Hand off to phone-lookup (validates line type / strips mobiles) when a number exists.
          if (directPhone) {
            await phoneLookupQueue.add('lookup', { contactId, leadId: lead.id, phone: directPhone });
          }
        } catch (e) {
          jobLogger.warn({ contact: ct.email ?? ct.id, err: (e as Error).message }, 'Contact/lead insert failed');
          result.skipped++;
        }
      }

      if (importRow) {
        await supabase
          .from('csv_imports')
          .update({
            total_rows: pull.contacts.length,
            imported_count: result.leads,
            failed_count: result.skipped,
            status: result.leads === 0 ? 'failed' : 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', importRow.id);
      }

      jobLogger.info(result, 'ZoomInfo lead import complete');

      // Auto-page: if more pages remain, enqueue the next page.
      if (page < pull.totalPages) {
        await leadImportQueue.add('import', { campaignId, page: page + 1, pageSize, filter });
        jobLogger.debug({ nextPage: page + 1, totalPages: pull.totalPages }, 'Enqueued next page');
      }

      return result;
    },
    { connection, concurrency: 1 },
  );
}

async function upsertCompany(supabase: SupabaseClient, co: ZoomInfoCompany): Promise<string> {
  const { data: existing } = await supabase
    .from('companies')
    .select('id')
    .eq('name', co.name)
    .is('created_by', null)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('companies')
    .insert({
      name: co.name,
      website: co.website || (co.domainList?.[0] ?? null),
      retail_vertical: 'unknown' as any,
      employee_count: co.employeeCount ?? null,
      store_count: null,
      created_by: null,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? 'company insert failed');
  return created.id;
}

async function upsertContact(
  supabase: SupabaseClient,
  ct: ZoomInfoContact,
  companyId: string,
  directPhone: string | null,
): Promise<string> {
  const email = ct.email?.trim().toLowerCase() || null;
  if (email) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) return existing.id;
  }

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      company_id: companyId,
      first_name: ct.firstName?.trim() || 'Unknown',
      last_name: ct.lastName?.trim() ?? null,
      email,
      phone_direct: directPhone,
      title: ct.jobTitle?.trim() ?? null,
      created_by: null,
    })
    .select('id')
    .single();
  if (error || !created) throw new Error(error?.message ?? 'contact insert failed');
  return created.id;
}
