import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import { TimezoneGuard } from '@ai-sdr/core';
import {
  CallExecuteJobPayload,
  LeadImportJobPayload,
} from '../queues/queue.registry';

interface PipelineSchedulerConfig {
  /** How often the auto-dial tick runs (ms). */
  dialIntervalMs: number;
  /** How often the auto-import tick runs (ms). */
  importIntervalMs: number;
  /** Below this many pending leads a campaign triggers a ZoomInfo import. */
  minLeadBuffer: number;
  /** Min gap between auto-imports for a campaign (Redis cooldown TTL, ms). */
  importCooldownMs: number;
  /** Max leads claimed+dialed per campaign per tick. */
  dialBatch: number;
  /**
   * Persona keys we actually have an ElevenLabs agent id for. A campaign's
   * enabled_personas is intersected with this so we never dial with a persona
   * that has no backing agent.
   */
  availablePersonas: string[];
}

interface PipelineSchedulerDeps {
  supabase: SupabaseClient;
  redis: Redis;
  leadImportQueue: Queue;
  callExecuteQueue: Queue;
  timezoneGuard: TimezoneGuard;
  logger: Logger;
  config: PipelineSchedulerConfig;
}

/** lead stages eligible to be (re)dialed. Includes called_gatekeeper so leads
 *  that hit a gatekeeper / non-decision-maker get re-attempted (respecting
 *  call_attempts < retry max and their next_contact_at delay). */
const DIALABLE_STAGES = ['callable', 'called_no_answer', 'called_voicemail', 'called_gatekeeper'] as const;
/** Nurture stages whose next_contact_at is re-checked for re-engagement. */
const NURTURE_STAGES = ['nurturing_30d', 'nurturing_90d', 'nurturing_180d'] as const;
/** stages that count as "lead still in the funnel" for the import-buffer check. */
const PENDING_STAGES = ['new', 'enriching', 'enriched', 'phone_lookup_pending', 'callable'] as const;
/** call.status values that mean a call is currently occupying a concurrency slot. */
const IN_FLIGHT_CALL_STATUSES = ['dialing', 'ringing', 'answered'] as const;
/** A lead sitting in 'in_call_queue' longer than this (no call-execute job ran)
 *  is considered a lost claim and reset back to 'callable'. */
const STUCK_CLAIM_MS = 15 * 60 * 1000;

interface CampaignRow {
  id: string;
  daily_call_limit: number | null;
  max_concurrent_calls: number | null;
  call_retry_max: number | null;
  enabled_personas: string[] | null;
  target_titles: string[] | null;
  target_states: string[] | null;
  target_min_employees: number | null;
}

interface EligibleLeadRow {
  id: string;
  contact_id: string;
  company_id: string;
  call_attempts: number | null;
  assigned_persona: string | null;
  contacts: { phone_direct: string | null } | null;
  companies: { headquarters_state: string | null } | null;
}

/**
 * The autonomous pipeline engine. Two timers drive the funnel end-to-end so no
 * human (or MCP call) is needed to keep leads flowing:
 *
 *   - autoImportTick: for each ACTIVE campaign, if its pool of not-yet-dialed
 *     leads has drained below `minLeadBuffer`, enqueue a ZoomInfo lead-import
 *     (page 1). A per-campaign Redis cooldown prevents hammering ZoomInfo.
 *
 *   - autoDialTick: for each ACTIVE campaign, compute the remaining daily-call
 *     budget and free concurrency slots, pull that many eligible leads
 *     (respecting per-prospect calling-window via TimezoneGuard), atomically
 *     claim each (stage → in_call_queue) and enqueue a call-execute job.
 *
 * Without this, lead-import's hand-off chain stops at `callable` and nothing
 * ever dials. The call-executor still re-checks DNC + calling-window itself, so
 * this scheduler is best-effort about the window (it just avoids wasting slots).
 */
export function createPipelineScheduler(deps: PipelineSchedulerDeps): { close: () => Promise<void> } {
  const { supabase, redis, leadImportQueue, callExecuteQueue, timezoneGuard, logger, config } = deps;
  const log = logger.child({ worker: 'pipeline-scheduler' });

  let dialing = false;
  let importing = false;

  async function getActiveCampaigns(): Promise<CampaignRow[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, daily_call_limit, max_concurrent_calls, call_retry_max, enabled_personas, target_titles, target_states, target_min_employees')
      .eq('status', 'active');
    if (error) {
      log.error({ err: error.message }, 'Failed to load active campaigns');
      return [];
    }
    return (data ?? []) as CampaignRow[];
  }

  function startOfTodayIso(): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function pickPersona(c: CampaignRow, lead: EligibleLeadRow): string | null {
    const enabled = (c.enabled_personas ?? []).filter(p => config.availablePersonas.includes(p));
    const pool = enabled.length > 0 ? enabled : config.availablePersonas;
    if (lead.assigned_persona && pool.includes(lead.assigned_persona)) return lead.assigned_persona;
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  async function dialCampaign(c: CampaignRow): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Remaining daily budget.
    const { count: callsToday } = await supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .gte('initiated_at', startOfTodayIso());
    const dailyBudget = (c.daily_call_limit ?? 100) - (callsToday ?? 0);
    if (dailyBudget <= 0) return 0;

    // 2. Free concurrency slots.
    const { count: inFlight } = await supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('status', IN_FLIGHT_CALL_STATUSES as unknown as string[]);
    const freeSlots = (c.max_concurrent_calls ?? 5) - (inFlight ?? 0);
    if (freeSlots <= 0) return 0;

    let budget = Math.min(dailyBudget, freeSlots, config.dialBatch);
    if (budget <= 0) return 0;

    // 3. Pull eligible leads. Fetch a little extra to absorb timezone/no-phone
    //    skips without a second round-trip.
    const retryMax = c.call_retry_max ?? 3;
    const { data: leads, error } = await supabase
      .from('leads')
      .select('id, contact_id, company_id, call_attempts, assigned_persona, contacts:contact_id(phone_direct), companies:company_id(headquarters_state)')
      .eq('campaign_id', c.id)
      .in('stage', DIALABLE_STAGES as unknown as string[])
      .lt('call_attempts', retryMax)
      .or(`next_contact_at.is.null,next_contact_at.lte.${nowIso}`)
      .order('priority', { ascending: false })
      .order('score', { ascending: false })
      .limit(budget * 3);
    if (error) {
      log.error({ campaignId: c.id, err: error.message }, 'Eligible-lead query failed');
      return 0;
    }

    let dialed = 0;
    for (const raw of (leads ?? []) as unknown as EligibleLeadRow[]) {
      if (budget <= 0) break;

      const phone = raw.contacts?.phone_direct ?? null;
      if (!phone) continue; // no callable number — phone-lookup should have routed this

      // Best-effort calling-window check (executor re-checks authoritatively).
      const state = raw.companies?.headquarters_state ?? 'NY';
      const windowCheck = timezoneGuard.isCallAllowed(state, now);
      if (!windowCheck.allowed) {
        if (windowCheck.nextAllowedAt) {
          await supabase
            .from('leads')
            .update({ next_contact_at: windowCheck.nextAllowedAt.toISOString(), updated_at: nowIso })
            .eq('id', raw.id);
        }
        continue;
      }

      const persona = pickPersona(c, raw);
      if (!persona) continue;

      // Atomic claim: only one scheduler tick can flip the stage.
      const { data: claimed } = await supabase
        .from('leads')
        .update({ stage: 'in_call_queue', updated_at: nowIso })
        .eq('id', raw.id)
        .in('stage', DIALABLE_STAGES as unknown as string[])
        .select('id');
      if (!claimed || claimed.length === 0) continue; // lost the race

      const payload: CallExecuteJobPayload = {
        leadId: raw.id,
        contactId: raw.contact_id,
        companyId: raw.company_id,
        campaignId: c.id,
        phone,
        persona,
        attemptNumber: (raw.call_attempts ?? 0) + 1,
      };
      await callExecuteQueue.add('execute', payload);
      dialed++;
      budget--;
    }

    if (dialed > 0) log.info({ campaignId: c.id, dialed }, 'Enqueued calls');
    return dialed;
  }

  /**
   * Recover leads stranded in 'in_call_queue'. The scheduler atomically flips a
   * lead to 'in_call_queue' and enqueues a call-execute job; the call-executor
   * then advances it to 'calling'. If that job is lost (e.g. Redis eviction) or
   * the worker dies before processing, the lead is stuck — 'in_call_queue' is
   * NOT a dialable stage, so it would never be re-picked. Reset any such lead
   * older than the threshold back to 'callable' so it gets dialed again.
   */
  async function recoverStuckClaims(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_CLAIM_MS).toISOString();
    const { data, error } = await supabase
      .from('leads')
      .update({ stage: 'callable', next_contact_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('stage', 'in_call_queue')
      .lt('updated_at', cutoff)
      .select('id');
    if (error) {
      log.error({ err: error.message }, 'Stuck-claim recovery query failed');
      return;
    }
    if (data && data.length > 0) {
      log.warn({ count: data.length }, 'Recovered leads stuck in in_call_queue → callable');
    }
  }

  /**
   * Re-engage nurtured leads. When a lead is parked in a nurturing_* stage with
   * a future next_contact_at (e.g. not_interested → 180d, using_competitor →
   * 90d), nothing brings it back into the dial pool once that date passes. This
   * resets due nurtures (next_contact_at <= now) to 'callable' so they're worked
   * again. DNC/dead are never touched (different stages).
   */
  async function reactivateDueNurtures(): Promise<void> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('leads')
      .update({ stage: 'callable', call_attempts: 0, next_contact_at: nowIso, updated_at: nowIso })
      .in('stage', NURTURE_STAGES as unknown as string[])
      .not('next_contact_at', 'is', null)
      .lte('next_contact_at', nowIso)
      .select('id');
    if (error) {
      log.error({ err: error.message }, 'Nurture reactivation query failed');
      return;
    }
    if (data && data.length > 0) {
      log.info({ count: data.length }, 'Reactivated due nurtured leads → callable');
    }
  }

  async function autoDialTick(): Promise<void> {
    if (dialing) return;
    dialing = true;
    try {
      await recoverStuckClaims();
      await reactivateDueNurtures();
      const campaigns = await getActiveCampaigns();
      let total = 0;
      for (const c of campaigns) total += await dialCampaign(c);
      if (total > 0) log.debug({ total }, 'Auto-dial tick complete');
    } catch (err) {
      log.error({ err: (err as Error).message }, 'Auto-dial tick failed');
    } finally {
      dialing = false;
    }
  }

  function buildFilter(c: CampaignRow): LeadImportJobPayload['filter'] {
    const filter: Record<string, unknown> = {};
    if (c.target_titles && c.target_titles.length > 0) filter['targetTitles'] = c.target_titles;
    if (c.target_states && c.target_states.length > 0) filter['targetStates'] = c.target_states;
    if (typeof c.target_min_employees === 'number') filter['minEmployees'] = c.target_min_employees;
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  async function importCampaign(c: CampaignRow): Promise<boolean> {
    const { count: pending } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id)
      .in('stage', PENDING_STAGES as unknown as string[]);
    if ((pending ?? 0) >= config.minLeadBuffer) return false;

    // Per-campaign cooldown so we don't refire while a previous import is still
    // paginating / before its leads have been processed.
    const cooldownKey = `pipeline:import-cooldown:${c.id}`;
    const set = await redis.set(cooldownKey, '1', 'PX', config.importCooldownMs, 'NX');
    if (set !== 'OK') return false;

    const filter = buildFilter(c);
    const payload: LeadImportJobPayload = {
      campaignId: c.id,
      page: 1,
      pageSize: 100,
      ...(filter ? { filter } : {}),
    };
    await leadImportQueue.add('import', payload);
    log.info({ campaignId: c.id, pending: pending ?? 0 }, 'Lead pool low — triggered ZoomInfo import');
    return true;
  }

  async function autoImportTick(): Promise<void> {
    if (importing) return;
    importing = true;
    try {
      const campaigns = await getActiveCampaigns();
      for (const c of campaigns) await importCampaign(c);
    } catch (err) {
      log.error({ err: (err as Error).message }, 'Auto-import tick failed');
    } finally {
      importing = false;
    }
  }

  log.info(
    { dialIntervalMs: config.dialIntervalMs, importIntervalMs: config.importIntervalMs, minLeadBuffer: config.minLeadBuffer },
    'Pipeline scheduler started',
  );

  // Kick once shortly after boot, then on the configured cadences.
  const kickoff = setTimeout(() => { void autoImportTick(); void autoDialTick(); }, 5000);
  const dialTimer = setInterval(() => { void autoDialTick(); }, config.dialIntervalMs);
  const importTimer = setInterval(() => { void autoImportTick(); }, config.importIntervalMs);

  return {
    async close(): Promise<void> {
      clearTimeout(kickoff);
      clearInterval(dialTimer);
      clearInterval(importTimer);
    },
  };
}
