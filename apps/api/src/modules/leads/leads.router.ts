import { Router, Request, Response, NextFunction } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { getUserId } from '../../shared/user-scope';
import { enqueueCrmSync } from '../../shared/crm-sync-queue';
import { enqueueCall } from '../../shared/call-queue';
import { enqueuePhoneLookup } from '../../shared/phone-lookup-queue';
import { audit } from '../../shared/audit';

interface RouterContext {
  supabase: SupabaseClient;
  logger: Logger;
}

// The 7 outbound AI SDR personas. 'receptionist' is inbound-only and never used
// for outbound dialing. Keep in sync with elevenLabsAgentIds in apps/workers.
const VALID_PERSONAS = ['mike', 'sarah', 'david', 'rachel', 'chris', 'emma', 'daniel'] as const;

/** Validate a caller-supplied persona; returns it lowercased or throws. */
function requireValidPersona(value: unknown): string {
  const p = String(value ?? '').toLowerCase().trim();
  if (!(VALID_PERSONAS as readonly string[]).includes(p)) {
    throw new ValidationError(`persona must be one of: ${VALID_PERSONAS.join(', ')}`);
  }
  return p;
}

export function createLeadsRouter({ supabase, logger }: RouterContext): Router {
  const router = Router();

  // GET /api/v1/leads/hot — must be before /:id
  router.get('/hot', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let query = supabase
        .from('leads')
        .select(`
          id, score, stage, call_attempts, last_called_at, meeting_booked_at, created_at,
          contacts(id, first_name, last_name, title, email, phone),
          companies(id, name, retail_vertical, store_count, website)
        `)
        .in('stage', ['qualified', 'meeting_booked', 'connected'])
        .order('score', { ascending: false })
        .limit(25);
      if (userId) query = query.eq('created_by', userId);

      const { data, error } = await query;
      if (error) throw error;
      res.json({ leads: data ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/leads
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const {
        stage, score_min, vertical, company, campaign_id,
        limit = '50', offset = '0',
      } = req.query as Record<string, string>;

      let query = supabase
        .from('leads')
        .select(`
          id, score, stage, call_attempts, last_called_at, created_at,
          contacts(id, first_name, last_name, title, email),
          companies(id, name, retail_vertical, store_count)
        `, { count: 'exact' });

      if (userId) query = query.eq('created_by', userId);
      if (stage) query = query.eq('stage', stage);
      if (score_min) query = query.gte('score', parseInt(score_min));
      if (campaign_id) query = query.eq('campaign_id', campaign_id);
      if (vertical) query = query.eq('companies.retail_vertical', vertical);
      if (company) query = query.ilike('companies.name', `%${company}%`);

      query = query
        .order('score', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({ leads: data ?? [], total: count ?? 0 });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/leads — manually create a single lead (company + contact + lead).
  // Mirrors the CSV-import / ZoomInfo mapping so a hand-added lead flows through
  // the exact same pipeline. By default a lead with a phone is sent to
  // phone-lookup (line-type validation + DNC), which routes it to callable /
  // email_only; pass run_phone_lookup:false to trust the number and mark it
  // callable immediately. A lead with only an email lands in email_only.
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const b = req.body as Record<string, unknown>;

      const firstName = String(b['first_name'] ?? '').trim();
      if (!firstName) throw new ValidationError('first_name is required');

      const email = b['email'] ? String(b['email']).trim().toLowerCase() : null;
      const phone = b['phone'] ? String(b['phone']).trim() : null;
      if (!email && !phone) throw new ValidationError('email or phone is required');

      const companyName = String(b['company_name'] ?? '').trim();
      if (!companyName) throw new ValidationError('company_name is required');

      const campaignId = b['campaign_id'] ? String(b['campaign_id']) : null;
      const runPhoneLookup = b['run_phone_lookup'] !== false; // default true
      const source = b['source'] ? String(b['source']) : 'manual';

      // 1. Company — dedupe by name within the caller's scope (mirrors imports).
      let companyId: string;
      const { data: existingCo } = await supabase
        .from('companies')
        .select('id')
        .eq('name', companyName)
        .eq(userId ? 'created_by' : 'id', userId ?? '00000000-0000-0000-0000-000000000000')
        .maybeSingle();

      if (existingCo) {
        companyId = existingCo.id;
        // Backfill calling-window state if newly provided.
        if (b['headquarters_state']) {
          await supabase.from('companies')
            .update({ headquarters_state: String(b['headquarters_state']), updated_at: new Date().toISOString() })
            .eq('id', companyId);
        }
      } else {
        const { data: newCo, error: coErr } = await supabase
          .from('companies')
          .insert({
            name: companyName,
            website: b['company_website'] ? String(b['company_website']) : null,
            retail_vertical: (b['retail_vertical'] ?? 'unknown') as any,
            store_count: b['store_count'] != null ? Number(b['store_count']) : null,
            headquarters_state: b['headquarters_state'] ? String(b['headquarters_state']) : null,
            created_by: userId ?? null,
          })
          .select('id')
          .single();
        if (coErr || !newCo) throw new ValidationError(`Company insert failed: ${coErr?.message ?? 'unknown'}`);
        companyId = newCo.id;
      }

      // 2. Contact — dedupe by email when present, else insert.
      let contactId: string;
      const existingCt = email
        ? (await supabase.from('contacts').select('id').eq('email', email).maybeSingle()).data
        : null;
      if (existingCt) {
        contactId = existingCt.id;
      } else {
        const { data: newCt, error: ctErr } = await supabase
          .from('contacts')
          .insert({
            company_id: companyId,
            first_name: firstName,
            last_name: b['last_name'] ? String(b['last_name']).trim() : null,
            email,
            phone_direct: phone,
            title: b['title'] ? String(b['title']).trim() : null,
            created_by: userId ?? null,
          })
          .select('id')
          .single();
        if (ctErr || !newCt) throw new ValidationError(`Contact insert failed: ${ctErr?.message ?? 'unknown'}`);
        contactId = newCt.id;
      }

      // 3. Lead — choose the entry stage based on what we have.
      const now = new Date().toISOString();
      let stage: string;
      let nextContactAt: string | null = null;
      if (phone && runPhoneLookup) {
        stage = 'phone_lookup_pending';
      } else if (phone) {
        stage = 'callable';
        nextContactAt = now;
      } else {
        stage = 'email_only';
      }

      const leadInsert: Record<string, unknown> = {
        campaign_id: campaignId,
        contact_id: contactId,
        company_id: companyId,
        stage,
        source,
        next_contact_at: nextContactAt,
        created_by: userId ?? null,
      };
      if (b['assigned_persona']) leadInsert['assigned_persona'] = String(b['assigned_persona']);
      if (b['priority'] != null) leadInsert['priority'] = Number(b['priority']);
      if (b['score'] != null) leadInsert['score'] = Number(b['score']);

      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert(leadInsert)
        .select('id, stage')
        .single();
      if (leadErr || !newLead) throw new ValidationError(`Lead insert failed: ${leadErr?.message ?? 'unknown'}`);

      // 4. Hand off to the pipeline.
      let phoneLookupJobId: string | null = null;
      if (phone && runPhoneLookup) {
        phoneLookupJobId = await enqueuePhoneLookup({ contactId, leadId: newLead.id, phone });
      }
      enqueueCrmSync('lead', newLead.id, 'create');

      audit(supabase, logger, req, {
        action: 'create',
        entity_type: 'lead',
        entity_id: newLead.id,
        changes: { source, stage: newLead.stage, company: companyName, campaign_id: campaignId },
      });

      logger.info({ leadId: newLead.id, stage: newLead.stage, phoneLookupJobId }, 'Manual lead created');
      res.status(201).json({
        lead: { id: newLead.id, stage: newLead.stage, contact_id: contactId, company_id: companyId },
        phone_lookup_queued: !!phoneLookupJobId,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/leads/:id
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let query = supabase
        .from('leads')
        .select(`*, contacts(*), companies(*)`)
        .eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data: lead, error } = await query.single();

      if (error || !lead) throw new NotFoundError('Lead', req.params.id);

      const { data: calls } = await supabase
        .from('calls')
        .select('id, persona, outcome, duration_seconds, meeting_booked, created_at')
        .eq('lead_id', req.params.id)
        .order('created_at', { ascending: false });

      const { data: emails } = await supabase
        .from('emails')
        .select('id, subject, status, sent_at, opened_count, clicked_count')
        .eq('lead_id', req.params.id)
        .order('created_at', { ascending: false });

      res.json({ lead, calls: calls ?? [], emails: emails ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/leads/:id/stage
  router.patch('/:id/stage', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { stage } = req.body;
      if (!stage) throw new ValidationError('stage is required');

      let query = supabase
        .from('leads')
        .update({ stage, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) query = query.eq('created_by', userId);
      const { data, error } = await query.select().single();

      if (error || !data) throw new NotFoundError('Lead', req.params.id);
      logger.info({ leadId: req.params.id, stage }, 'Lead stage updated');

      enqueueCrmSync('lead', req.params.id, 'update');

      await supabase.from('lead_stage_history').insert({
        lead_id: req.params.id,
        to_stage: stage,
        changed_by: 'manual',
        reason: req.body.reason ?? 'Manual update via API',
      });

      res.json({ lead: data });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/leads/:id/call — manually enqueue an outbound call for this lead.
  // The call-executor worker still enforces DNC + call-window checks before dialing.
  router.post('/:id/call', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      let q = supabase
        .from('leads')
        .select('id, contact_id, company_id, campaign_id, assigned_persona, call_attempts, contacts(phone_direct, phone_hq)')
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data: lead, error } = await q.single();
      if (error || !lead) throw new NotFoundError('Lead', req.params.id);

      const l = lead as Record<string, unknown>;
      const contact = Array.isArray(l['contacts'])
        ? (l['contacts'] as Record<string, string | null>[])[0]
        : (l['contacts'] as Record<string, string | null> | null);

      // Allow an explicit override phone in the body; otherwise use the contact's
      // direct/HQ number (mobiles are intentionally excluded — never call mobiles).
      const phone = (req.body?.phone as string | undefined) ?? contact?.['phone_direct'] ?? contact?.['phone_hq'] ?? null;
      if (!phone) throw new ValidationError('No callable phone number on this lead');

      // Persona selection priority:
      //  1. Explicit override in the request body (frontend "call as <agent>")
      //  2. The lead's stored assigned_persona
      //  3. Default 'sarah' ('receptionist' is inbound-only — never outbound)
      let persona: string;
      if (req.body?.persona !== undefined && req.body?.persona !== null && req.body?.persona !== '') {
        persona = requireValidPersona(req.body.persona);
        // Persist the choice so future auto-dials use the same agent.
        await supabase
          .from('leads')
          .update({ assigned_persona: persona, updated_at: new Date().toISOString() })
          .eq('id', l['id'] as string);
      } else {
        const rawPersona = (l['assigned_persona'] as string | null) ?? 'sarah';
        persona = rawPersona === 'receptionist' ? 'sarah' : rawPersona;
      }
      const attemptNumber = ((l['call_attempts'] as number | null) ?? 0) + 1;

      const jobId = await enqueueCall({
        leadId: l['id'] as string,
        contactId: l['contact_id'] as string,
        companyId: l['company_id'] as string,
        campaignId: (l['campaign_id'] as string | null) ?? null,
        phone,
        persona,
        attemptNumber,
      });

      await supabase
        .from('leads')
        .update({ stage: 'in_call_queue', updated_at: new Date().toISOString() })
        .eq('id', l['id'] as string);

      logger.info({ leadId: l['id'], jobId, persona, phone }, 'Manual outbound call enqueued');
      res.json({ success: true, jobId, persona, phone, attemptNumber });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/leads/:id/persona — assign the AI agent for this lead WITHOUT
  // dialing. body: { persona: 'mike' | 'sarah' | ... }. The next call (manual or
  // automatic) uses this agent.
  router.patch('/:id/persona', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const persona = requireValidPersona(req.body?.persona);

      let q = supabase
        .from('leads')
        .update({ assigned_persona: persona, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.select('id, assigned_persona').single();
      if (error || !data) throw new NotFoundError('Lead', req.params.id);

      logger.info({ leadId: req.params.id, persona }, 'Lead agent assigned');
      res.json({ lead: data });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/leads/bulk-update — body: { lead_ids: [], updates: { stage?, campaign_id?, assigned_persona? } }
  router.post('/bulk-update', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_ids, updates } = req.body as { lead_ids?: string[]; updates?: Record<string, unknown> };
      if (!Array.isArray(lead_ids) || lead_ids.length === 0) throw new ValidationError('lead_ids array required');
      if (!updates || Object.keys(updates).length === 0) throw new ValidationError('updates object required');

      const allowedFields = ['stage', 'campaign_id', 'score', 'priority', 'next_contact_at', 'assigned_persona'];
      const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of allowedFields) {
        if (updates[k] !== undefined) safe[k] = updates[k];
      }
      // Validate persona if the caller is reassigning the agent in bulk.
      if (safe['assigned_persona'] !== undefined) {
        safe['assigned_persona'] = requireValidPersona(safe['assigned_persona']);
      }

      let q = supabase.from('leads').update(safe).in('id', lead_ids);
      if (userId) q = q.eq('created_by', userId);
      const { data, error } = await q.select('id, stage');
      if (error) throw error;

      logger.info({ count: data?.length, lead_ids: lead_ids.length }, 'Bulk lead update');
      res.json({ updated: data?.length ?? 0, updates: safe });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/leads/bulk-dnc — body: { lead_ids: [], reason? }
  router.post('/bulk-dnc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { lead_ids, reason } = req.body as { lead_ids?: string[]; reason?: string };
      if (!Array.isArray(lead_ids) || lead_ids.length === 0) throw new ValidationError('lead_ids array required');

      // Get phone + email for each lead so we can add them to dnc_list
      let leadQ = supabase
        .from('leads')
        .select('id, contacts(phone_direct, email)')
        .in('id', lead_ids);
      if (userId) leadQ = leadQ.eq('created_by', userId);
      const { data: leads, error: leadErr } = await leadQ;
      if (leadErr) throw leadErr;

      const dncInserts = [];
      for (const lead of leads ?? []) {
        const ct = (lead as any).contacts;
        if (!ct) continue;
        if (ct.phone_direct) dncInserts.push({ phone: ct.phone_direct, source: 'manual', added_reason: reason ?? 'Bulk DNC', added_by: 'api', is_permanent: true, created_by: userId ?? null });
        if (ct.email) dncInserts.push({ email: ct.email, source: 'manual', added_reason: reason ?? 'Bulk DNC', added_by: 'api', is_permanent: true, created_by: userId ?? null });
      }
      if (dncInserts.length > 0) await supabase.from('dnc_list').insert(dncInserts);

      let updateQ = supabase.from('leads').update({ stage: 'dnc', updated_at: new Date().toISOString() }).in('id', lead_ids);
      if (userId) updateQ = updateQ.eq('created_by', userId);
      const { error: upErr } = await updateQ;
      if (upErr) throw upErr;

      logger.info({ count: lead_ids.length, dnc_entries: dncInserts.length }, 'Bulk DNC');
      res.json({ updated: lead_ids.length, dnc_entries: dncInserts.length });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/leads/:id/dnc
  router.post('/:id/dnc', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = getUserId(req);
      const { phone, email, reason } = req.body;
      if (!phone && !email) throw new ValidationError('phone or email is required');

      await supabase.from('dnc_list').insert({
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        source: 'internal',
        added_reason: reason ?? 'Added via dashboard',
        added_by: 'api',
        is_permanent: true,
      });

      let upd = supabase
        .from('leads')
        .update({ stage: 'dnc', updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (userId) upd = upd.eq('created_by', userId);
      await upd;

      logger.info({ leadId: req.params.id }, 'Lead added to DNC');
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
