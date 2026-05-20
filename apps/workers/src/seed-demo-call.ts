/**
 * Seed a complete demo call into Supabase for a specific user.
 *
 * Required env var:
 *   SEED_USER_EMAIL=test@aisdr.app
 *
 * Run on EC2:
 *   sudo docker compose exec -e SEED_USER_EMAIL=test@aisdr.app call-workers \
 *     node /app/apps/workers/dist/seed-demo-call.js
 */
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { ClaudeReasoningService } from '@ai-sdr/integrations';
import { workerEnv } from './config/env';

const logger = pino({ level: 'info' });
const supabase = createClient(workerEnv.SUPABASE_URL, workerEnv.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket as any },
});

const TRANSCRIPT = `
[Agent Mike]: Hi, is this John?
[John]: Yes, this is John. Who's calling?
[Agent Mike]: Hi John, this is AI Mike calling from AirRetail Technologies. I help grocery chains modernize their pricing systems with electronic shelf labels. Do you have a quick moment?
[John]: We're actually looking at ESL options right now. What's the pitch?
[Agent Mike]: We're working with chains your size — around 500 stores — to roll out ESL across produce and dry goods. Our system updates 50,000 prices in under 90 seconds. Are you currently using anything?
[John]: We piloted SES-imagotag in 12 stores last year. Performance was OK but the price was high and integration with our Oracle POS was painful.
[Agent Mike]: That's a really common story. We integrate natively with Oracle Retail and our pricing is about 35% below SES at scale. What's your timeline looking like?
[John]: We need to make a decision by Q3. Budget is around $4 million for the full rollout. I make the call but my CFO needs to sign off.
[Agent Mike]: Perfect. Can I get 30 minutes on your calendar next week with our VP of Sales to walk through a tailored proposal for Whole Foods?
[John]: Yeah, Thursday at 2pm Eastern works. Send the invite to john@wholefoods.com.
[Agent Mike]: Done. Thursday 2pm Eastern. Talk soon, John.
`;

async function lookupUserId(email: string): Promise<string> {
  let page = 1;
  while (page <= 5) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < 200) break;
    page++;
  }
  throw new Error(`No Supabase auth user found with email: ${email}`);
}

async function main() {
  const targetEmail = process.env.SEED_USER_EMAIL;
  if (!targetEmail) {
    logger.error('Set SEED_USER_EMAIL env var (e.g. SEED_USER_EMAIL=test@aisdr.app)');
    process.exit(1);
  }

  logger.info({ targetEmail }, 'Looking up user...');
  const userId = await lookupUserId(targetEmail);
  logger.info({ userId, email: targetEmail }, 'Resolved user');

  // 1. Campaign
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .insert({
      name: 'Demo Grocery Campaign',
      description: 'Seeded for testing',
      target_verticals: ['grocery'],
      daily_call_limit: 50,
      hourly_call_limit: 10,
      max_concurrent_calls: 3,
      enabled_personas: ['mike'],
      status: 'active',
      started_at: new Date().toISOString(),
      created_by: userId,
    })
    .select()
    .single();
  if (campErr) throw campErr;
  logger.info({ id: campaign.id }, 'Created campaign');

  // 2. Company
  const { data: company, error: coErr } = await supabase
    .from('companies')
    .insert({
      name: 'Whole Foods Market (Demo)',
      retail_vertical: 'grocery',
      store_count: 500,
      website: 'https://wholefoodsmarket.com',
      annual_revenue: 16000000000,
      employee_count: 95000,
      created_by: userId,
    })
    .select()
    .single();
  if (coErr) throw coErr;
  logger.info({ id: company.id }, 'Created company');

  // 3. Contact
  const { data: contact, error: ctErr } = await supabase
    .from('contacts')
    .insert({
      company_id: company.id,
      first_name: 'John',
      last_name: 'Doe',
      title: 'VP of Operations',
      email: 'john.demo@wholefoods.example',
      phone_direct: '+15125550199',
      created_by: userId,
    })
    .select()
    .single();
  if (ctErr) throw ctErr;
  logger.info({ id: contact.id }, 'Created contact');

  // 4. Lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      campaign_id: campaign.id,
      contact_id: contact.id,
      company_id: company.id,
      stage: 'calling',
      score: 75,
      call_attempts: 1,
      last_called_at: new Date().toISOString(),
      created_by: userId,
    })
    .select()
    .single();
  if (leadErr) throw leadErr;
  logger.info({ id: lead.id }, 'Created lead');

  // 5. Claude analysis
  const claude = new ClaudeReasoningService(
    workerEnv.ANTHROPIC_API_KEY,
    workerEnv.ANTHROPIC_MODEL,
    workerEnv.ANTHROPIC_MAX_TOKENS,
    logger,
  );
  logger.info('Analyzing transcript with Claude...');
  const result = await claude.analyzeCallTranscript({
    transcript: TRANSCRIPT,
    companyName: company.name,
    contactName: `${contact.first_name} ${contact.last_name}`,
    contactTitle: contact.title,
    retailVertical: 'grocery',
  });
  logger.info({ cost: result.costUsd }, 'Claude analysis complete');

  const analysis = result.callAnalysis;
  const qual = result.qualificationData;

  // 6. Call
  const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const answeredAt = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  const endedAt = new Date().toISOString();
  const { data: call, error: callErr } = await supabase
    .from('calls')
    .insert({
      campaign_id: campaign.id,
      lead_id: lead.id,
      contact_id: contact.id,
      company_id: company.id,
      persona: 'mike',
      status: 'completed',
      outcome: analysis.outcome,
      duration_seconds: 240,
      talk_time_seconds: 210,
      meeting_booked: analysis.outcome === 'meeting_booked',
      voicemail_left: false,
      decision_maker_reached: true,
      dnc_requested: false,
      qualification_score: analysis.qualification_score,
      sentiment: analysis.sentiment,
      summary: analysis.summary,
      created_at: startedAt,
      answered_at: answeredAt,
      ended_at: endedAt,
      created_by: userId,
    })
    .select()
    .single();
  if (callErr) throw callErr;
  logger.info({ id: call.id }, 'Created call');

  // 7. Transcript
  const { error: trErr } = await supabase.from('call_transcripts').insert({
    call_id: call.id,
    full_transcript: TRANSCRIPT,
  });
  if (trErr) logger.warn({ err: trErr }, 'Transcript insert failed');

  // 8. Lead update
  const { error: updErr } = await supabase
    .from('leads')
    .update({
      stage: 'meeting_booked',
      score: analysis.qualification_score,
      qualification_data: qual,
      meeting_booked_at: new Date().toISOString(),
    })
    .eq('id', lead.id);
  if (updErr) logger.warn({ err: updErr }, 'Lead update failed');

  // 9. Appointment
  const meetingTime = new Date();
  meetingTime.setDate(meetingTime.getDate() + 7);
  meetingTime.setHours(14, 0, 0, 0);
  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .insert({
      lead_id: lead.id,
      contact_id: contact.id,
      company_id: company.id,
      call_id: call.id,
      status: 'scheduled',
      scheduled_at: meetingTime.toISOString(),
      duration_minutes: 30,
      timezone: 'America/New_York',
      meeting_type: 'discovery',
      meeting_link: 'https://meet.example.com/demo-' + call.id.slice(0, 8),
      assigned_rep_name: 'Sales Rep',
      assigned_rep_email: 'sales@airretail.example',
      qualification_summary: analysis.summary,
      key_pain_points: qual.pain_points ?? [],
      products_of_interest: ['AirESL'],
      store_count: qual.store_count ?? 500,
      budget_indication: qual.budget_range ?? '$4M',
      decision_timeline: qual.rollout_timeline ?? 'Q3',
      created_by: userId,
    })
    .select()
    .single();
  if (apptErr) logger.warn({ err: apptErr }, 'Appointment insert failed');
  else logger.info({ id: appt.id }, 'Created appointment');

  console.log('\n========== SEED COMPLETE ==========');
  console.log(`Owner:       ${targetEmail} (${userId})`);
  console.log(`Campaign:    ${campaign.id}`);
  console.log(`Company:     ${company.id} (${company.name})`);
  console.log(`Contact:     ${contact.id}`);
  console.log(`Lead:        ${lead.id}`);
  console.log(`Call:        ${call.id}`);
  console.log(`Appointment: ${appt?.id ?? '(failed)'}`);
  console.log(`Claude cost: $${result.costUsd.toFixed(4)}`);
  console.log('====================================\n');

  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
