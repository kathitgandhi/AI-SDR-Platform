/**
 * Rich demo seeder — populates multiple campaigns, leads at various stages,
 * mixed inbound/outbound calls, meetings, notes, tickets.
 *
 * Run on EC2:
 *   sudo docker compose exec -e SEED_USER_EMAIL=test@aisdr.app call-workers \
 *     node /app/apps/workers/dist/seed-demo-rich.js
 */
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { workerEnv } from './config/env';

const logger = pino({ level: 'info' });
const supabase = createClient(workerEnv.SUPABASE_URL, workerEnv.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket as any },
});

const COMPANIES = [
  { name: 'Whole Foods Demo', vertical: 'grocery', stores: 500, website: 'wholefoods.example' },
  { name: 'Albertsons Demo', vertical: 'grocery', stores: 2200, website: 'albertsons.example' },
  { name: 'CVS Demo', vertical: 'general_retail', stores: 9800, website: 'cvs.example' },
  { name: 'Costco Demo', vertical: 'wholesale_distribution', stores: 850, website: 'costco.example' },
  { name: 'Walgreens Demo', vertical: 'general_retail', stores: 8700, website: 'walgreens.example' },
];

const CONTACTS = [
  { first: 'John', last: 'Doe', title: 'VP Operations' },
  { first: 'Sarah', last: 'Lee', title: 'Director of IT' },
  { first: 'Mike', last: 'Chen', title: 'Head of Store Ops' },
  { first: 'Priya', last: 'Patel', title: 'CIO' },
  { first: 'David', last: 'Wong', title: 'VP Procurement' },
];

const STAGES = ['new', 'enriched', 'callable', 'called_voicemail', 'connected', 'qualified', 'meeting_booked'] as const;
const PERSONAS = ['mike', 'sarah', 'david', 'rachel', 'chris', 'emma', 'daniel'] as const;
const OUTCOMES = ['meeting_booked', 'qualified_nurture', 'not_interested', 'voicemail_left', 'no_answer', 'gatekeeper_blocked'] as const;

async function lookupUserId(email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!match) throw new Error(`No auth user found: ${email}`);
  return match.id;
}

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function main() {
  const email = process.env.SEED_USER_EMAIL;
  if (!email) {
    logger.error('Set SEED_USER_EMAIL');
    process.exit(1);
  }

  const userId = await lookupUserId(email);
  logger.info({ userId, email }, 'Seeding rich demo data');

  // 2 campaigns
  const { data: c1 } = await supabase.from('campaigns').insert({
    name: 'Grocery Q3 Rollout', target_verticals: ['grocery'],
    daily_call_limit: 100, hourly_call_limit: 20, max_concurrent_calls: 5,
    enabled_personas: ['mike', 'sarah'], status: 'active',
    started_at: new Date().toISOString(), created_by: userId,
  }).select().single();
  const { data: c2 } = await supabase.from('campaigns').insert({
    name: 'Retail Pharmacy Outreach', target_verticals: ['general_retail'],
    daily_call_limit: 80, hourly_call_limit: 15, max_concurrent_calls: 4,
    enabled_personas: ['david', 'rachel'], status: 'active',
    started_at: new Date().toISOString(), created_by: userId,
  }).select().single();
  logger.info({ c1: c1?.id, c2: c2?.id }, 'Created campaigns');

  const sentimentMap: Record<string, number> = { very_negative: 0.1, negative: 0.3, neutral: 0.5, positive: 0.7, very_positive: 0.9 };

  let leadCount = 0, callCount = 0, apptCount = 0;

  for (let i = 0; i < COMPANIES.length; i++) {
    const co = COMPANIES[i]!;
    const ct = CONTACTS[i]!;
    const camp = co.vertical === 'grocery' ? c1 : c2;
    if (!camp) continue;

    const { data: company } = await supabase.from('companies').insert({
      name: co.name, retail_vertical: co.vertical as any,
      store_count: co.stores, website: `https://${co.website}`,
      created_by: userId,
    }).select().single();
    if (!company) continue;

    const { data: contact } = await supabase.from('contacts').insert({
      company_id: company.id, first_name: ct.first, last_name: ct.last,
      title: ct.title, email: `${ct.first.toLowerCase()}.demo@${co.website}`,
      phone_direct: `+1512555${String(1000 + i).padStart(4, '0')}`,
      created_by: userId,
    }).select().single();
    if (!contact) continue;

    const stage = STAGES[Math.min(i, STAGES.length - 1)]!;
    const { data: lead } = await supabase.from('leads').insert({
      campaign_id: camp.id, contact_id: contact.id, company_id: company.id,
      stage, score: 60 + Math.floor(Math.random() * 35),
      call_attempts: Math.floor(Math.random() * 3),
      last_called_at: new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
      pain_points: ['outdated pricing system', 'manual price updates'],
      rollout_timeline: rand(['Q3', 'Q4', 'H1 2027']),
      budget_range: rand(['$500K-$1M', '$1M-$3M', '$3M+']),
      is_decision_maker: i % 2 === 0,
      created_by: userId,
    }).select().single();
    if (!lead) continue;
    leadCount++;

    // 1-3 calls per lead
    const numCalls = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < numCalls; j++) {
      const persona = rand(PERSONAS);
      const outcome = rand(OUTCOMES);
      const meetingBooked = outcome === 'meeting_booked';
      const direction = Math.random() < 0.2 ? 'inbound' : 'outbound';
      const created = new Date(Date.now() - Math.random() * 14 * 86400000);
      const duration = 60 + Math.floor(Math.random() * 300);

      const { data: call } = await supabase.from('calls').insert({
        campaign_id: camp.id, lead_id: lead.id, contact_id: contact.id, company_id: company.id,
        persona, direction, status: 'completed', outcome,
        from_number: direction === 'inbound' ? contact.phone_direct : '+15125550100',
        to_number: direction === 'inbound' ? '+15125550100' : contact.phone_direct,
        duration_seconds: duration, talk_time_seconds: duration - 10,
        meeting_booked: meetingBooked,
        voicemail_left: outcome === 'voicemail_left',
        decision_maker_reached: outcome === 'meeting_booked' || outcome === 'qualified_nurture',
        qualification_score: 50 + Math.floor(Math.random() * 50),
        outcome_score: 40 + Math.floor(Math.random() * 60),
        sentiment_score: sentimentMap[rand(['positive', 'neutral', 'negative'])],
        call_summary: `${persona} reached ${ct.first} at ${co.name}. ${outcome === 'meeting_booked' ? 'Booked discovery call.' : 'No commitment yet.'}`,
        ai_disclosed: true, company_identified: true, purpose_stated: true, compliance_passed: true,
        created_at: created.toISOString(),
        initiated_at: created.toISOString(),
        answered_at: outcome !== 'no_answer' ? new Date(created.getTime() + 5000).toISOString() : null,
        ended_at: new Date(created.getTime() + duration * 1000).toISOString(),
        created_by: userId,
      }).select().single();
      if (call) {
        callCount++;
        // Auto-note for half of calls
        if (Math.random() < 0.5) {
          await supabase.from('notes').insert({
            lead_id: lead.id, call_id: call.id,
            body: `Call summary: spoke with ${ct.first}, sentiment ${rand(['positive', 'neutral'])}, next step: ${meetingBooked ? 'meeting' : 'follow-up email'}.`,
            source: 'transcript', created_by: userId,
          });
        }
        // Meeting for meeting_booked
        if (meetingBooked) {
          const meetTime = new Date(Date.now() + (1 + Math.random() * 14) * 86400000);
          await supabase.from('appointments').insert({
            lead_id: lead.id, contact_id: contact.id, company_id: company.id, call_id: call.id,
            status: 'scheduled', scheduled_at: meetTime.toISOString(),
            duration_minutes: 30, timezone: 'America/New_York',
            meeting_type: 'discovery',
            meeting_link: `https://meet.example.com/demo-${call.id.slice(0, 8)}`,
            assigned_rep_name: 'Sales Rep',
            assigned_rep_email: 'sales@airretail.example',
            qualification_summary: `Qualified ${co.vertical} lead with ${co.stores} stores`,
            key_pain_points: ['outdated pricing system'],
            products_of_interest: ['AirESL'],
            store_count: co.stores,
            decision_timeline: rand(['Q3', 'Q4']),
            created_by: userId,
          });
          apptCount++;
        }
      }
    }

    // 0-2 tickets per lead
    const numTickets = Math.floor(Math.random() * 3);
    for (let t = 0; t < numTickets; t++) {
      await supabase.from('tickets').insert({
        title: rand([
          'Send pricing PDF',
          'Schedule follow-up demo',
          'Verify ROI calculator inputs',
          'Confirm integration with Oracle Retail',
        ]),
        description: 'Auto-generated demo ticket',
        status: rand(['open', 'in_progress', 'resolved'] as any[]),
        priority: rand(['low', 'medium', 'high'] as any[]),
        lead_id: lead.id, contact_id: contact.id, company_id: company.id,
        created_by: userId,
      });
    }
  }

  console.log('\n========== RICH SEED COMPLETE ==========');
  console.log(`Owner:       ${email} (${userId})`);
  console.log(`Campaigns:   2`);
  console.log(`Companies:   ${COMPANIES.length}`);
  console.log(`Leads:       ${leadCount}`);
  console.log(`Calls:       ${callCount}`);
  console.log(`Appointments:${apptCount}`);
  console.log('========================================\n');
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Rich seed failed');
  process.exit(1);
});
