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
    airdeskBaseUrl?: string | undefined;
    airdeskApiKey?: string | undefined;
    airdeskDefaultUserId?: string | undefined;
    airdeskDefaultDepartmentId?: string | undefined;
  };
}

/**
 * Consumes the `crm-sync` queue. Each job pushes one entity to the configured
 * CRM provider. Currently supports `airdesk360`; gracefully no-ops if provider
 * is `none` or env is missing.
 *
 * Triggered from: transcript.worker.ts (after every call — enqueues both a
 * `lead` sync and a `call` sync), leads.router.ts (on POST/PATCH),
 * tickets.router.ts (on POST/PATCH).
 *
 * Call transcript sync:
 *   After a call is processed, the transcript worker enqueues entity='call'.
 *   syncCall() fetches the full transcript + Claude analysis from Supabase and
 *   posts it as a note on the AirDesk360 deal. If the lead hasn't been synced
 *   yet (crm_lead_id is null), it runs syncLead() inline first so the note
 *   always lands in AirDesk regardless of job ordering.
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

      if (entity === 'call') {
        return await syncCall(supabase, adapter, entityId, jobLogger);
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

  // 3. lead/deal
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

  // Write CRM IDs back to the lead row so the call-sync job can use them
  // directly without extra API round-trips. Non-fatal if this fails.
  if (customerId || contactCrmId || leadCrmId) {
    try {
      await supabase.from('leads').update({
        ...(customerId   ? { crm_company_id: customerId }   : {}),
        ...(contactCrmId ? { crm_contact_id: contactCrmId } : {}),
        ...(leadCrmId    ? { crm_lead_id:    leadCrmId }    : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', leadId);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'Failed to write CRM IDs back to lead row');
    }
  }

  logger.info({ customerId, contactCrmId, leadCrmId }, 'Lead synced to AirDesk360');
  return { customer_id: customerId, contact_id: contactCrmId, lead_id: leadCrmId };
}

/**
 * Sync a completed call to AirDesk360 as a note on the lead/deal.
 *
 * The note includes:
 *  - Call metadata (date, agent persona, duration, outcome, score)
 *  - Claude's summary and next steps
 *  - Qualification data (store count, vendors, timeline, budget)
 *  - Objections and pain points extracted from the transcript
 *  - Full transcript text (truncated at 6 000 chars if very long)
 *
 * If the lead has not been synced yet (crm_lead_id is null), syncLead() is
 * called inline first so the note always has a deal to attach to.
 */
async function syncCall(
  supabase: SupabaseClient,
  adapter: AirDesk360Adapter,
  callId: string,
  logger: Logger,
): Promise<{ note_id: string; crm_lead_id: string }> {
  // 1. Fetch call + transcript + lead in parallel
  const [
    { data: call, error: callErr },
    { data: transcript },
  ] = await Promise.all([
    supabase
      .from('calls')
      .select('id, lead_id, contact_id, company_id, campaign_id, outcome, duration_seconds, persona_id, call_summary, next_steps, created_at, to_number')
      .eq('id', callId)
      .single(),
    supabase
      .from('call_transcripts')
      .select('full_transcript, claude_analysis, qualification_data, objections_raised, pain_points_mentioned, interest_signals')
      .eq('call_id', callId)
      .maybeSingle(),
  ]);

  if (callErr || !call) throw new Error(`Call ${callId} not found: ${callErr?.message ?? 'unknown'}`);

  const leadId: string = call.lead_id;

  // 2. Fetch lead (need crm_lead_id, contact, company for note context)
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('id, crm_lead_id, crm_contact_id, crm_company_id, contacts(*), companies(*)')
    .eq('id', leadId)
    .single();
  if (leadErr || !lead) throw new Error(`Lead ${leadId} not found`);

  // 3. Ensure the lead exists in AirDesk360 — run syncLead if not yet synced
  let crmLeadId: string = (lead as any).crm_lead_id ?? '';
  if (!crmLeadId) {
    logger.info({ leadId }, 'crm_lead_id missing — running lead sync before call note');
    try {
      const synced = await syncLead(supabase, adapter, leadId, logger);
      crmLeadId = synced.lead_id;
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'Inline lead sync failed — cannot post call note');
      return { note_id: '', crm_lead_id: '' };
    }
  }

  if (!crmLeadId) {
    logger.warn({ callId, leadId }, 'No AirDesk lead ID after sync — skipping call note');
    return { note_id: '', crm_lead_id: '' };
  }

  // 4. Format the note body
  const noteBody = formatCallNote(call, transcript);

  // 5. Post as a note on the AirDesk360 deal
  let noteId = '';
  try {
    noteId = await adapter.addNote({
      entityId: crmLeadId,
      entityType: 'deal',
      body: noteBody,
      timestamp: call.created_at,
    });
    logger.info({ callId, crmLeadId, noteId }, 'Call transcript posted to AirDesk360');
  } catch (e) {
    logger.warn({ err: (e as Error).message, callId, crmLeadId }, 'Failed to post call note to AirDesk360');
  }

  return { note_id: noteId, crm_lead_id: crmLeadId };
}

/** Build a human-readable note body from call + transcript data. */
function formatCallNote(call: any, transcript: any): string {
  const lines: string[] = [];

  // Header
  const callDate = call.created_at
    ? new Date(call.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unknown date';
  const durationStr = call.duration_seconds
    ? formatDuration(call.duration_seconds)
    : 'Unknown';
  const outcome = (call.outcome ?? 'unknown').replace(/_/g, ' ');
  const persona = call.persona_id ?? 'AI Agent';

  lines.push(`📞 Call Transcript — ${callDate}`);
  lines.push('');
  lines.push(`Agent: ${persona} | Duration: ${durationStr} | Outcome: ${outcome}`);
  lines.push('');

  // Summary
  if (call.call_summary) {
    lines.push('── SUMMARY ──');
    lines.push(call.call_summary);
    lines.push('');
  }

  // Next steps
  if (call.next_steps) {
    lines.push('── NEXT STEPS ──');
    lines.push(call.next_steps);
    lines.push('');
  }

  // Qualification data
  const qual = transcript?.qualification_data;
  if (qual && Object.keys(qual).length > 0) {
    lines.push('── QUALIFICATION ──');
    if (qual.store_count)         lines.push(`• Store count: ${qual.store_count}`);
    if (qual.current_esl_vendor)  lines.push(`• Current ESL vendor: ${qual.current_esl_vendor}`);
    if (qual.current_pos_vendor)  lines.push(`• Current POS vendor: ${qual.current_pos_vendor}`);
    if (qual.rollout_timeline)    lines.push(`• Timeline: ${qual.rollout_timeline}`);
    if (qual.budget_range)        lines.push(`• Budget: ${qual.budget_range}`);
    if (qual.is_decision_maker !== undefined) {
      lines.push(`• Decision maker: ${qual.is_decision_maker ? 'Yes' : 'No'}`);
    }
    if (qual.pain_points?.length) lines.push(`• Pain points: ${qual.pain_points.join(', ')}`);
    lines.push('');
  }

  // Objections
  const objections: string[] = transcript?.objections_raised ?? [];
  if (objections.length > 0) {
    lines.push('── OBJECTIONS RAISED ──');
    objections.forEach(o => lines.push(`• ${o}`));
    lines.push('');
  }

  // Interest signals
  const signals: string[] = transcript?.interest_signals ?? [];
  if (signals.length > 0) {
    lines.push('── INTEREST SIGNALS ──');
    signals.forEach(s => lines.push(`• ${s}`));
    lines.push('');
  }

  // Full transcript (truncated)
  const fullText: string = transcript?.full_transcript ?? '';
  if (fullText) {
    lines.push('── TRANSCRIPT ──');
    const MAX_TRANSCRIPT_CHARS = 6000;
    if (fullText.length > MAX_TRANSCRIPT_CHARS) {
      lines.push(fullText.substring(0, MAX_TRANSCRIPT_CHARS));
      lines.push(`\n[... transcript truncated — ${fullText.length - MAX_TRANSCRIPT_CHARS} additional characters not shown ...]`);
    } else {
      lines.push(fullText);
    }
  }

  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function syncTicket(
  supabase: SupabaseClient,
  _adapter: AirDesk360Adapter,
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
