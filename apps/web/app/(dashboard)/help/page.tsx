import {
  PhoneIncoming, PhoneOutgoing, Bot, Mail,
  Megaphone, ShieldCheck, Zap,
  ChevronRight, BookOpen, Headphones, Building2,
} from 'lucide-react';
import { Header } from '@/components/layout/Header';

/* ------------------------------------------------------------------ */
/* Re-usable primitives                                                 */
/* ------------------------------------------------------------------ */

function Section({ id, icon: Icon, title, color, children }: {
  id: string;
  icon: React.ElementType;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className={`px-6 py-4 border-b border-slate-100 flex items-center gap-3`}>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h2 className="font-semibold text-slate-900 text-base">{title}</h2>
      </div>
      <div className="px-6 py-5 space-y-4 text-sm text-slate-600 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <p>{children}</p>
    </div>
  );
}

function TableRow({ cols }: { cols: string[] }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      {cols.map((c, i) => (
        <td key={i} className={`px-4 py-2.5 text-sm ${i === 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
          {c}
        </td>
      ))}
    </tr>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left">
        <thead className="bg-slate-50">
          <tr>
            {headers.map(h => (
              <th key={h} className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((r, i) => <TableRow key={i} cols={r} />)}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ type, children }: { type: 'tip' | 'warning' | 'info'; children: React.ReactNode }) {
  const styles = {
    tip:     'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info:    'bg-blue-50  border-blue-200  text-blue-800',
  };
  const labels = { tip: 'Tip', warning: 'Note', info: 'Info' };
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles[type]}`}>
      <span className="font-semibold">{labels[type]}: </span>{children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TOC                                                                  */
/* ------------------------------------------------------------------ */

const TOC = [
  { id: 'overview',   label: 'Platform overview' },
  { id: 'outbound',   label: 'Outbound calls' },
  { id: 'inbound',    label: 'Inbound calls' },
  { id: 'crm',        label: 'AirDesk360 integration' },
  { id: 'emails',     label: 'Email follow-up sequences' },
  { id: 'campaigns',  label: 'Campaigns' },
  { id: 'compliance', label: 'Compliance rules' },
  { id: 'credits',    label: 'Cost & credit optimisation' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function HelpPage() {
  return (
    <>
      <Header title="Help & Guide" subtitle="How the AI SDR platform works" />

      <div className="p-6 flex gap-6 items-start">

        {/* Sticky TOC */}
        <aside className="hidden xl:block w-52 shrink-0 sticky top-6">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">On this page</p>
          <nav className="space-y-0.5">
            {TOC.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 py-1 px-2 rounded hover:bg-slate-100 transition-colors"
              >
                <ChevronRight className="w-3 h-3 shrink-0" />
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Overview */}
          <Section id="overview" icon={BookOpen} title="Platform overview" color="bg-slate-700">
            <p>
              AirRetail SDR is a fully automated AI sales platform that handles both outbound prospecting and
              inbound call reception — 24/7, without human intervention on the call itself.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mt-2">
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-medium">
                  <PhoneOutgoing className="w-4 h-4 text-blue-600" /> Outbound
                </div>
                <ol className="space-y-1 text-slate-600 text-sm">
                  {[
                    'ZoomInfo pulls targeted leads',
                    'Lead is enriched + phone verified',
                    'AI SDR persona calls the prospect',
                    'Claude qualifies + analyses transcript',
                    'Gmail follow-up email sent automatically',
                    'Hot leads flagged for human reps',
                  ].map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-blue-400 font-mono text-xs mt-0.5">{i + 1}.</span> {s}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2 text-slate-800 font-medium">
                  <PhoneIncoming className="w-4 h-4 text-green-600" /> Inbound
                </div>
                <ol className="space-y-1 text-slate-600 text-sm">
                  {[
                    'Caller dials the AirRetail number',
                    'Liam (AI receptionist) answers instantly',
                    'Caller identity extracted from transcript',
                    'AirDesk360 contact created or matched',
                    'Estimate or support ticket auto-created',
                    'Follow-up email sequence enrolled',
                  ].map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-green-400 font-mono text-xs mt-0.5">{i + 1}.</span> {s}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="mt-3">
              <p className="font-medium text-slate-700 mb-2">AI personas</p>
              <div className="flex flex-wrap gap-2">
                {['Mike', 'Sarah', 'David', 'Rachel', 'Chris', 'Emma', 'Daniel'].map(p => (
                  <span key={p} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                    <Bot className="w-3 h-3" /> {p}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                  <Headphones className="w-3 h-3" /> Liam (inbound)
                </span>
              </div>
            </div>
          </Section>

          {/* Outbound */}
          <Section id="outbound" icon={PhoneOutgoing} title="Outbound calls" color="bg-blue-600">
            <p>
              Outbound campaigns run on a configurable schedule. Leads are pulled from ZoomInfo, enriched with
              company data, filtered to landline-only numbers (mobile numbers are never called), and queued for
              calling within the legal call window (8 am – 9 pm prospect local time).
            </p>
            <div className="space-y-3">
              <Step n={1}>
                <strong>Lead import</strong> — ZoomInfo pulls are triggered manually via
                {' '}<em>Trigger lead import</em> or on a scheduled cadence. Leads enter at the{' '}
                <code className="bg-slate-100 px-1 rounded text-xs">new</code> stage.
              </Step>
              <Step n={2}>
                <strong>Enrichment</strong> — Company data, store count, tech stack are appended. Phone numbers
                are validated; mobile numbers are dropped at this stage.
              </Step>
              <Step n={3}>
                <strong>AI call</strong> — An SDR persona dials the prospect. The persona follows the
                qualification framework (BANT + tech stack + pain) and aims to book a 30-minute discovery call.
              </Step>
              <Step n={4}>
                <strong>Transcript analysis</strong> — Claude reads the full transcript and scores the lead
                (1–10 interest level), extracts qualification data, and writes a summary + next steps.
              </Step>
              <Step n={5}>
                <strong>Follow-up email</strong> — A personalised email is sent via Gmail based on the outcome
                and qualification data extracted from the call.
              </Step>
            </div>
            <p className="font-medium text-slate-700 mt-2">Call outcomes</p>
            <Table
              headers={['Outcome', 'What it means']}
              rows={[
                ['connected', 'Reached the prospect — conversation happened'],
                ['called_voicemail', 'Reached voicemail — message left'],
                ['called_no_answer', 'Rang out — no answer, no voicemail'],
                ['called_gatekeeper', 'Reached a receptionist or assistant, not the target contact'],
                ['meeting_booked', 'Prospect agreed to a discovery call — calendar invite sent'],
              ]}
            />
          </Section>

          {/* Inbound */}
          <Section id="inbound" icon={PhoneIncoming} title="Inbound calls" color="bg-green-600">
            <p>
              All inbound calls to the AirRetail number are answered by <strong>Liam</strong>, the AI
              receptionist. Liam identifies the caller's intent, gathers their name and company, and routes
              the interaction to the right downstream action automatically.
            </p>

            <p className="font-medium text-slate-700">How caller identity is resolved</p>
            <div className="space-y-2">
              <Step n={1}>
                After the call, Claude analyses the full transcript and extracts the caller's name, company,
                and job title if they were mentioned during the conversation.
              </Step>
              <Step n={2}>
                The platform searches AirDesk360 for an existing contact matching that phone number. If found,
                it updates the contact record. If not found, a new contact is created under the matching
                customer account.
              </Step>
              <Step n={3}>
                If the contact record previously showed "Unknown Caller", it is automatically updated with the
                extracted name and company.
              </Step>
            </div>

            <p className="font-medium text-slate-700 mt-2">Call type classification</p>
            <p>Claude classifies every inbound call into one of these types, which drives what happens next:</p>
            <Table
              headers={['Call type', 'Trigger condition', 'What fires automatically']}
              rows={[
                ['esl_inquiry', 'Caller asks about ESL / pricing / demo', 'AirDesk estimate created + follow-up email sequence'],
                ['support_request', 'Existing customer reports an issue', 'AirDesk support ticket opened + acknowledgement email'],
                ['partnership', 'Reseller / partner inquiry', 'Partnership follow-up email sequence'],
                ['press_media', 'Journalist or analyst calling', 'Logged only'],
                ['vendor', 'Supplier or vendor calling', 'Logged only'],
                ['other', 'None of the above', 'Logged only'],
              ]}
            />
            <Callout type="info">
              Caller identity extraction and call classification happen automatically within seconds of the
              call ending — no manual input required.
            </Callout>
          </Section>

          {/* CRM */}
          <Section id="crm" icon={Building2} title="AirDesk360 integration" color="bg-purple-600">
            <p>
              Every call (inbound and outbound) is synced to AirDesk360 automatically. Here is what gets
              created where:
            </p>
            <Table
              headers={['What', 'Where in AirDesk360', 'Trigger']}
              rows={[
                ['Call transcript + summary', 'Notes tab on the lead/deal', 'Every completed call'],
                ['ESL estimate (quote stub)', 'Sales → Estimates', 'Inbound ESL inquiry'],
                ['Support ticket', 'Support → Tickets', 'Inbound support request'],
                ['New contact', 'Customers → Contacts', 'New inbound caller with no matching record'],
              ]}
            />

            <p className="font-medium text-slate-700 mt-2">Estimates</p>
            <p>
              When an inbound caller enquires about ESL, an estimate is automatically created under their
              customer record with the following line items at <strong>$0 rate</strong> (pricing confirmed
              by a specialist):
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>AirESL SLIM Series Electronic Shelf Labels — quantity based on store count or label count mentioned on call</li>
              <li>AirLED Ceiling Access Point + Gateway — quantity based on store count</li>
            </ul>
            <Callout type="tip">
              Go to AirDesk360 → Sales → Estimates to see new quotes. Edit the quantities and set pricing
              before sending to the customer.
            </Callout>

            <p className="font-medium text-slate-700 mt-2">Support tickets</p>
            <p>
              Support tickets are linked to the caller's contact record and include the call summary and
              first 1,500 characters of the transcript as the ticket description. A team member receives
              the ticket in the Support queue.
            </p>
            <Callout type="info">
              For phone-only inbound callers (no email address), a contact is created in AirDesk360 using
              their phone number alone. The contact can be enriched with an email later.
            </Callout>
          </Section>

          {/* Emails */}
          <Section id="emails" icon={Mail} title="Email follow-up sequences" color="bg-amber-500">
            <p>
              After an inbound call, the platform automatically enrols the caller in an email sequence
              based on their call type. Emails are sent from your Gmail account via the connected integration.
            </p>
            <Table
              headers={['Sequence', 'Call type', 'Step 1', 'Step 2']}
              rows={[
                ['inbound_esl_inquiry', 'ESL inquiry', 'Immediate — product info email', '2 days later — follow-up'],
                ['inbound_support_ack', 'Support request', 'Immediate — ticket acknowledgement', '—'],
                ['inbound_partnership', 'Partnership inquiry', 'Immediate — partnership response', '5 days later — follow-up'],
              ]}
            />
            <Callout type="warning">
              Email sequences only fire if the caller has an email address on record. Phone-only contacts
              (no email) are still logged and synced to AirDesk but will not receive email follow-ups until
              an email is added to their contact record.
            </Callout>
            <p>
              Outbound calls also trigger follow-up emails after a connected call, voicemail, or meeting
              booking. These use separate outbound sequences configured per campaign.
            </p>
          </Section>

          {/* Campaigns */}
          <Section id="campaigns" icon={Megaphone} title="Campaigns" color="bg-indigo-600">
            <p>
              A campaign defines a pool of leads and the pacing rules for calling them. You can have
              multiple campaigns running simultaneously targeting different verticals or regions.
            </p>
            <p className="font-medium text-slate-700">Key controls</p>
            <Table
              headers={['Control', 'What it does']}
              rows={[
                ['Pause', 'Stops new calls immediately. Calls already in progress finish.'],
                ['Resume', 'Restarts a paused campaign from where it left off.'],
                ['Daily call limit', 'Maximum number of outbound calls per day across this campaign.'],
                ['Concurrency', 'How many calls can be active at the same time.'],
                ['Hourly limit', 'Rate cap — prevents bursting all calls in the first hour.'],
              ]}
            />
            <Callout type="tip">
              If you need to pause everything urgently (e.g. compliance review), use{' '}
              <strong>Drain call queue</strong> from the Queue Monitor page — this clears all waiting
              calls across all campaigns instantly.
            </Callout>
            <p className="font-medium text-slate-700 mt-2">Lead stages</p>
            <div className="overflow-x-auto">
              <div className="flex items-center gap-1 flex-wrap text-xs font-mono">
                {[
                  'new', 'enriching', 'enriched', 'phone_lookup_pending',
                  'callable', 'in_call_queue', 'calling',
                  'connected', 'qualified', 'meeting_booked', 'meeting_held',
                ].map((stage, i, arr) => (
                  <span key={stage} className="flex items-center gap-1">
                    <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded">{stage}</span>
                    {i < arr.length - 1 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                  </span>
                ))}
              </div>
            </div>
          </Section>

          {/* Compliance */}
          <Section id="compliance" icon={ShieldCheck} title="Compliance rules" color="bg-red-600">
            <p>
              These rules are enforced at the platform level and cannot be overridden by campaign
              configuration. They exist to keep AirRetail compliant with TCPA and telemarketing regulations.
            </p>
            <div className="space-y-3">
              {[
                {
                  title: 'AI identity disclosure',
                  body: 'Every AI agent — outbound and inbound — must identify itself as an AI at the very first exchange. This is hardcoded into every persona prompt and cannot be disabled.',
                },
                {
                  title: 'Do Not Contact (DNC)',
                  body: 'If a prospect says "remove me", "don\'t call again", or any equivalent, the AI immediately says "Absolutely, I\'ll remove you from our list right away" and ends the call. The number is added to the DNC list automatically within seconds.',
                },
                {
                  title: 'Call window enforcement',
                  body: 'Calls are only placed between 8 am and 9 pm in the prospect\'s local time zone. The worker checks the prospect\'s area code and enforces this on every call attempt.',
                },
                {
                  title: 'Mobile number filtering',
                  body: 'Mobile/cell phone numbers are filtered out during the phone lookup stage. Only landline business numbers are called. This is non-negotiable.',
                },
                {
                  title: 'No pressure tactics',
                  body: 'Personas are instructed never to use pressure tactics, false urgency, or deceptive language. The prompt explicitly forbids this.',
                },
              ].map(rule => (
                <div key={rule.title} className="flex gap-3">
                  <ShieldCheck className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-slate-800">{rule.title}</p>
                    <p className="text-slate-600 mt-0.5">{rule.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <Callout type="warning">
              To manually add a number to the DNC list (e.g. if someone calls in to complain), go to
              Leads → find the lead → Add to DNC. You can also ask Claude via the MCP: "Add +1XXXXXXXXXX
              to the DNC list."
            </Callout>
          </Section>

          {/* Credits */}
          <Section id="credits" icon={Zap} title="Cost & credit optimisation" color="bg-yellow-500">
            <p>
              ElevenLabs credits and Claude API usage are the two primary ongoing costs. Here is what
              drives them and how to keep them under control.
            </p>
            <p className="font-medium text-slate-700">ElevenLabs credits</p>
            <Table
              headers={['Cost driver', 'Impact', 'How to reduce']}
              rows={[
                ['LLM tokens (biggest)', 'High', 'Use Claude Haiku 4.5 — ~20× cheaper than Opus. Set in ElevenLabs agent settings.'],
                ['TTS characters', 'Medium', 'Shorter agent responses. Voice guidelines in prompts enforce brief answers.'],
                ['STT minutes', 'Low–Medium', 'Shorter calls. Crisp qualification = faster to a yes/no.'],
                ['Knowledge Base retrieval', 'Low', 'KB is retrieved on-demand (not sent every turn) — already optimised.'],
              ]}
            />
            <Callout type="tip">
              The single biggest lever is the LLM model in ElevenLabs. Switch every agent from
              Claude Opus 4.7 → Claude Haiku 4.5 in ElevenLabs settings. This alone reduces per-call
              credit cost by roughly 20×.
            </Callout>
            <p className="font-medium text-slate-700 mt-2">Claude API (transcript analysis)</p>
            <Table
              headers={['Use', 'Recommended model']}
              rows={[
                ['Real-time voice (ElevenLabs agents)', 'claude-haiku-4-5 (fast + cheap)'],
                ['Transcript analysis (offline, workers)', 'claude-sonnet-4-6 (better reasoning)'],
                ['Backfill / bulk scripts', 'claude-haiku-4-5 (cost-sensitive batch work)'],
              ]}
            />
            <p>
              To check monthly Claude API spend, ask Claude via MCP: <em>"How much has Claude cost us
              this month?"</em> — this runs <code className="bg-slate-100 px-1 rounded text-xs">get_cost_summary</code>.
            </p>
          </Section>

        </div>
      </div>
    </>
  );
}
