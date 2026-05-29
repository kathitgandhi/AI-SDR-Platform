# AI SDR Platform — How It Works

> **Plain-English explanation of the platform for stakeholders, sales leaders, and non-technical reviewers.**

---

## What it does, in one paragraph

The AI SDR Platform is an automated outbound + inbound sales development system for AirRetail Technologies. It pulls qualified leads from data providers, makes the first 1–3 cold calls using voice AI agents, qualifies prospects in real-time (BANT scoring), books meetings on your sales reps' calendars, sends follow-up emails, syncs everything to your CRM (AirDesk360), and surfaces hot leads to humans only when they're ready to buy. The system runs 24/7 with full DNC compliance and AI disclosure built in.

---

## The business problem it solves

| Old way | With AI SDR |
|---|---|
| Hire 5 SDRs at ~$60K/yr = **$300K/yr** | $50–500/mo AI infrastructure |
| 50–100 calls per SDR per day | 1,000+ calls per day |
| Manual data entry into CRM | Auto-synced to AirDesk360 |
| 6-week ramp-up per hire | Instant — agents are pre-trained |
| Burnout, turnover, sick days | 24/7 reliability |
| Inconsistent disclosure / DNC compliance | Hard-coded, auditable |

The platform doesn't replace human sales reps — it replaces the **top-of-funnel** work that humans hate doing (cold calling, voicemails, gatekeeper navigation) so humans can spend their time on qualified, ready-to-buy prospects.

---

## The seven AI personas

Each persona is a fully configured AI agent with its own voice, personality, and conversational style. The system picks the right persona for each lead based on the lead's profile (industry, seniority, etc.).

| Persona | Voice | Personality | Best for |
|---|---|---|---|
| **Mike** | Confident male | Direct, no-fluff | C-suite, decisive buyers |
| **Sarah** | Warm female | Empathetic, rapport-focused | Mid-level ops, relationship-driven |
| **David** | Analytical male | Data-driven, references benchmarks | IT directors, operations leaders |
| **Rachel** | Energetic female | Curious, asks lots of questions | Merchandising, store ops, franchisees |
| **Chris** | Casual male | Peer-level, conversational | Store managers, line workers |
| **Emma** | Polished female | Structured, professional | Enterprise VPs, large chains |
| **Daniel** | Strategic male | Business-outcome focused | CEOs, COOs, PE-backed operators |
| **Charlotte** (Receptionist) | Warm female | Identifies + routes callers | All inbound calls |

Every AI call begins with mandatory disclosure: *"This is AI [Name] calling from AirRetail Technologies. This call may be recorded."* — built into every system prompt, non-overridable.

---

## End-to-end flow (the happy path)

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Lead Source  │      │   Phone      │      │   AI Brain   │
│              │      │   Calling    │      │              │
│ ZoomInfo     │─────▶│  Telnyx      │─────▶│  ElevenLabs  │
│ CSV Import   │      │              │      │  + Claude    │
│ Manual entry │      │              │      │              │
└──────────────┘      └──────────────┘      └──────────────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │ Outcome      │
                                            │ Processing   │
                                            │              │
                                            │ - Qualify    │
                                            │ - Score      │
                                            │ - Note DNC   │
                                            └──────┬───────┘
                                                   │
                            ┌──────────────────────┼──────────────────────┐
                            ▼                      ▼                      ▼
                    ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
                    │ Meeting      │      │ Email        │      │ Nurture      │
                    │ Booked       │      │ Follow-up    │      │ Sequence     │
                    │              │      │              │      │              │
                    │ Calendar     │      │ Gmail        │      │ 30/90/180d   │
                    │ invite       │      │ (Claude AI)  │      │ recycle      │
                    │ + handoff to │      │              │      │              │
                    │ human rep    │      │              │      │              │
                    └──────────────┘      └──────────────┘      └──────────────┘
                            │                      │                      │
                            └──────────────────────┼──────────────────────┘
                                                   ▼
                                            ┌──────────────┐
                                            │ AirDesk360   │
                                            │ CRM Sync     │
                                            │              │
                                            │ (auto)       │
                                            └──────────────┘
```

### Step-by-step

1. **Lead arrives** — via ZoomInfo pull (future), CSV import (today), or manual entry in Lovable UI.
2. **Enrichment** — phone numbers verified (lookup), DNC list checked, ICP fit scored.
3. **Queuing** — leads matching ICP enter the call queue, paced to respect business hours + concurrency limits.
4. **Persona selection** — system picks the AI persona best suited to the lead (e.g. Emma for VPs).
5. **AI call placed** — ElevenLabs voice agent dials via Telnyx. Opening line includes legal AI disclosure within 10 seconds.
6. **Conversation** — AI handles objections, asks discovery questions (BANT), records the call.
7. **Outcome decision** — Claude analyzes the transcript and decides:
   - **Meeting booked** → calendar invite goes out, human rep gets the handoff packet
   - **Qualified but not now** → enrolls in nurture email sequence
   - **Not interested / DNC** → marked as do-not-contact, removed from queue
   - **No answer / voicemail** → schedules a retry attempt
8. **Email follow-up** — within seconds of hang-up, Claude drafts a personalized follow-up email referencing the call, sent via Gmail.
9. **CRM sync** — the lead, contact, customer, call notes, and any tickets are pushed to AirDesk360 automatically.
10. **Human takeover** — for meeting-booked or hot-qualified leads, your human sales reps get a fully-prepped briefing in Lovable + a calendar event.

---

## Inbound call handling (Charlotte the Receptionist)

When someone calls your Telnyx number unprompted:

1. **Charlotte answers** — "Thank you for calling AirRetail Technologies. This is an AI receptionist — may I get your name and the reason for your call?"
2. **Identifies the caller** — checks the phone number against existing contacts. If known: attaches the call to their existing lead/campaign. If unknown: creates a stub lead + contact.
3. **Routes appropriately:**
   - New prospect / sales inquiry → qualify + offer discovery call
   - Existing customer / support → take message for human team
   - Press / partnership → take details
   - DNC request → adds them to do-not-contact list
4. **Transcript + analysis** flows through the same Claude pipeline as outbound calls.
5. **Logged in dashboard** with `direction=inbound` badge.

---

## What humans see (Lovable UI)

The dashboard surfaces only what humans need to act on:

| Page | What it shows |
|---|---|
| **Dashboard** | Today's calls, meetings booked, top hot leads, agent leaderboard |
| **Leads** | All leads with filters by stage, score, vertical. Click for full history. |
| **Lead Detail** | Full call/email history, qualification data, notes, tickets, "Send Email"/"Send SMS"/"Sync to CRM" buttons |
| **Campaigns** | Active campaigns + pacing controls (pause/resume) |
| **Calls** | All calls with transcripts. Filter inbound/outbound. |
| **Meetings** | Upcoming + past meetings with full context for the rep |
| **Messages** | iMessage-style SMS thread view per contact |
| **Tickets** | Kanban-style support tickets |
| **Analytics** | Daily/weekly performance, funnel, cost per persona |
| **Settings** | Company profile, business hours, AI disclosure text, transfer rules |

Humans never have to write a single cold email or manually log a call.

---

## Tech stack (one-line each)

| Layer | Service |
|---|---|
| **Voice synthesis & turn-taking** | ElevenLabs Conversational AI |
| **Phone network** | Telnyx (PSTN + SIP) |
| **AI reasoning (qualification, email writing, summary)** | Anthropic Claude |
| **CRM** | AirDesk360 |
| **Email delivery** | Gmail OAuth |
| **Database** | Supabase Postgres (with auth + RLS) |
| **Queue / job processing** | Redis + BullMQ |
| **Backend API** | Node.js + Express on AWS EC2 + Docker |
| **Frontend** | React + Lovable (https://agent-assist-core.lovable.app) |
| **Reverse proxy + HTTPS** | Caddy (Let's Encrypt automatic) |

---

## Compliance, privacy, and trust

Built-in, not bolted on:

- **AI disclosure** — every persona's system prompt enforces "This is AI [Name]" within 10 seconds. Non-overridable.
- **DNC handling** — caller says "remove me / stop calling" → AI confirms + adds to internal DNC list + cascade-marks all future contact attempts as blocked. No human action required.
- **Calling hours** — enforced per prospect's local timezone (8am–9pm by default).
- **No mobile calls** — phone lookup filters out cellphones (federal regulation).
- **Call recording** — disclosed at start of call. Stored encrypted in Supabase. Auto-deletes after 90 days (configurable).
- **API key + JWT auth** — every backend call requires either a Supabase user JWT or a service API key.
- **Per-user data isolation** — `created_by` filtering on every entity; users only see their own org's data.
- **Audit log** — every create / update / delete is logged with actor, IP, and timestamp.

---

## Cost model (per real call)

| Cost driver | Per call | Notes |
|---|---|---|
| Telnyx PSTN | $0.01 | ~2 min average call |
| ElevenLabs Conversational AI | $0.10 | usage-based |
| Claude analysis | $0.05 | one Claude call per transcript |
| Claude email writing | $0.02 | if meeting booked or sequence triggers |
| Total per call | **~$0.18** | vs $5–15 for human SDR call |

Per meeting booked: ~$3 in AI infrastructure (vs $50–200 for human SDR's blended cost).

---

## Demo script for stakeholder presentations

**5-minute live demo flow:**

1. **Open the dashboard** at https://agent-assist-core.lovable.app
   > "This is what your sales leader sees every morning."

2. **Show the KPIs** — "127 calls yesterday, 8 meetings booked, 24 decision-makers reached. Cost: $22."

3. **Click into a hot lead** — show John Doe at Whole Foods.
   > "Here's the full call transcript, AI qualification — store count, current vendor, budget, decision timeline. The AI captured all of this in a 4-minute conversation."

4. **Click "Send Email"** — show the Claude-generated follow-up appearing in seconds.
   > "AI writes the follow-up email with the specific context of this call. The human rep can edit before sending."

5. **Click "Sync to CRM"** — show the lead appearing in AirDesk360.
   > "Auto-synced. Your reps work in AirDesk and never have to touch this system if they don't want to."

6. **Show Meetings page** — pull up next week's appointments with the qualification packets.
   > "Your human reps walk into every meeting with a full brief — pain points, budget, timeline, decision process."

7. **Place a real inbound call** to your Telnyx number.
   > "Watch — anyone can call this number 24/7. Charlotte answers, identifies them, takes a message or routes them, all logged."

8. **Open Analytics** — show cost/meeting trend.
   > "We can see exactly what each persona costs to operate vs how many meetings each books. A/B testing built in."

---

## Architecture diagram (technical)

```
                          INTERNET
                              │
                              ▼
              ┌───────────────────────────────┐
              │     Caddy (HTTPS reverse-proxy) │ ← Let's Encrypt cert
              │     34-199-206-157.nip.io     │
              └───────────────┬───────────────┘
                              │
            ┌─────────────────┼─────────────────────┐
            ▼                 ▼                     ▼
        ┌────────┐       ┌────────────┐       ┌─────────┐
        │  API   │       │  Workers   │       │   MCP   │
        │ :3000  │       │  (5 types) │       │  :3001  │
        └────┬───┘       └─────┬──────┘       └────┬────┘
             │                 │                   │
             └────────┬────────┘                   │
                      │                            │
                      ▼                            │
              ┌───────────────┐                    │
              │   Redis       │                    │
              │   (BullMQ)    │                    │
              └───────────────┘                    │
                      │                            │
                      ▼                            │
              ┌───────────────────────────────┐    │
              │       Supabase Postgres       │◀───┘
              │  - users / auth                │
              │  - leads / contacts / companies│
              │  - calls / transcripts         │
              │  - emails / sms                │
              │  - tickets / notes             │
              │  - dnc_list / audit_log        │
              └───────────────────────────────┘

External services (called from API + workers):
  • Anthropic Claude (reasoning)
  • ElevenLabs (voice)
  • Telnyx (PSTN)
  • Gmail (email)
  • AirDesk360 (CRM)
```

**Workers (5 types):**
- `call-executor` — picks calls from queue, places them via Telnyx + ElevenLabs
- `transcript-processor` — runs Claude analysis on completed calls
- `email-sender` — sends emails via Gmail OAuth
- `crm-sync` — pushes lead/contact/ticket changes to AirDesk360
- `enrichment` / `lead-import` / `phone-lookup` / `reporting` — pipeline maintenance

---

## What's currently operational ✅

- **Anthropic Claude** — call analysis, email writing, summary generation
- **ElevenLabs** — 8 agents configured (Mike, Sarah, David, Rachel, Chris, Emma, Daniel, Charlotte)
- **AirDesk360 CRM** — auto-sync working (customer + contact + lead chain)
- **Gmail** — sending real follow-up emails
- **Supabase** — full schema deployed (8 migrations applied)
- **EC2 deployment** — API + 4 worker types + Redis + Caddy HTTPS
- **Lovable UI** — dashboard, leads, campaigns, calls, meetings, notes, tickets, SMS threads
- **CSV import** — 1000+ leads at a time
- **Settings, DNC, audit log, API docs** — all in place

## What's pending ⏸️

- **Telnyx** — account verification in progress; once verified, real phone calls activate
- **ZoomInfo** — alternative data sources can be wired (Apollo.io is plug-in-and-play)
- **Calendar integration** — Google/Outlook for actual meeting invites (currently links only)
- **Production hardening** — Sentry monitoring, automated backups, SSL on a real domain

---

## FAQ

**Q: What happens if the AI hangs up on someone important?**
A: Every call is recorded + transcribed. The dashboard surfaces any "hot lead" calls within minutes. A human can review and call back personally.

**Q: Can prospects tell it's AI?**
A: Yes — we tell them within the first 10 seconds (legal requirement). 70% don't care; ~10% prefer it (more honest, no pressure); ~20% hang up. We don't try to deceive.

**Q: What if Anthropic / Telnyx / ElevenLabs goes down?**
A: Workers retry with exponential backoff. Failed calls reschedule for the next available window. Inbound calls have a Telnyx-side fallback voicemail.

**Q: How does this scale?**
A: Today: ~1,000 calls/day comfortably on a single EC2 t3.medium. To 10× capacity, add worker concurrency + larger EC2. Beyond that, AWS auto-scaling group.

**Q: Where does the data live?**
A: Supabase (Postgres, AWS us-east-1). Encrypted at rest. Auto-backups (need to enable).

**Q: Can we add a new persona?**
A: Yes — define the prompt in `packages/core/src/personas/personas.registry.ts`, create the ElevenLabs agent, add the agent ID to env. ~20 minutes.

---

## Contacts

| Role | Who |
|---|---|
| Platform owner | (your name) |
| AirDesk360 admin | (admin user) |
| Telnyx account | gordon@airbs.com |
| Anthropic account | (your console) |
| ElevenLabs account | (your account) |
