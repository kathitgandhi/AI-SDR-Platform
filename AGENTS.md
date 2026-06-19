# AI SDR Platform — Agent Control Reference

You have full remote-control access to this AI outbound + inbound sales platform via MCP tools.

## WHAT THIS PLATFORM DOES

Automated AI SDR system for AirRetail Technologies (sells AirESL, AirPOS, AirBiz, AirWMS).

**Outbound flow:**
Pulls leads from ZoomInfo → enriches → filters by phone type → calls via ElevenLabs AI voice agents → Claude reasoning → Gmail follow-up → Supabase storage

**Inbound flow:**
Telnyx SIP → ElevenLabs receptionist agent (Liam) → caller identity extracted from transcript → AirDesk360 contact created/matched → CRM note posted → email follow-up sequence enrolled → estimate or support ticket created automatically

**Personas:**
- Outbound SDRs: Mike, Sarah, David, Rachel, Chris, Emma, Daniel
- Inbound receptionist: Liam (always-on, handles all inbound calls)

Full DNC/compliance system — AI always discloses identity on every call.

---

## YOUR AVAILABLE TOOLS

### Campaign Control
| Tool | What it does |
|---|---|
| `list_campaigns` | See all campaigns + status + metrics |
| `get_campaign` | Deep dive on one campaign + lead stage breakdown |
| `create_campaign` | Create a new outbound campaign |
| `pause_campaign` | Stop new calls immediately (active calls finish) |
| `resume_campaign` | Restart a paused campaign |
| `update_campaign_pacing` | Change daily call limits, concurrency, hourly limits |

### Lead Management
| Tool | What it does |
|---|---|
| `search_leads` | Filter by stage, score, vertical, company name |
| `get_lead_detail` | Full history: all calls, emails, qualification data |
| `get_hot_leads` | Top qualified leads needing human follow-up |
| `update_lead_stage` | Manually move a lead through the pipeline |
| `add_to_dnc` | Add phone/email to Do Not Contact list |

### Reporting & Analytics
| Tool | What it does |
|---|---|
| `get_daily_stats` | Call volume, outcomes, meeting rates for any date range |
| `get_agent_leaderboard` | Performance ranking for all AI personas |
| `get_pipeline_summary` | Stage counts, avg scores, upcoming meetings |
| `get_cost_summary` | API spend breakdown by provider |

### Call Transcripts
| Tool | What it does |
|---|---|
| `get_call_transcript` | Full transcript + Claude analysis for a call |
| `search_transcripts` | Full-text search across all transcripts |
| `get_recent_calls` | Latest calls with outcomes (filter by persona/outcome) |
| `get_meetings_booked` | All booked appointments with qualification summaries |

### Queue Management
| Tool | What it does |
|---|---|
| `get_queue_stats` | Job counts across all 10 queues (waiting/active/failed) |
| `trigger_lead_import` | Fire a ZoomInfo pull for a campaign |
| `retry_failed_jobs` | Re-queue failed jobs in any queue |
| `drain_call_queue` | Emergency: clear all waiting calls |
| `trigger_reporting` | Generate daily/weekly digest on demand |

---

## EXAMPLE THINGS YOU CAN ASK ME TO DO

```
"Pause the Q3 Grocery campaign — we have a compliance review"
"Show me today's call stats"
"Who are our 10 hottest leads right now?"
"Get the transcript for the call with Sarah at Whole Foods"
"What's the agent leaderboard for the last 30 days?"
"Search all transcripts for mentions of NCR"
"Trigger a lead import for campaign X"
"Show me all meetings booked this week"
"How much has Claude cost us this month?"
"Add +15125550100 to the DNC list — they called to complain"
"Move lead [id] to qualified stage — rep spoke to them offline"
```

---

## PIPELINE STAGES (in order)
```
new → enriching → enriched → phone_lookup_pending →
callable / email_only →
in_call_queue → calling →
called_no_answer / called_voicemail / called_gatekeeper / connected →
qualified → meeting_booked → meeting_held →
nurturing_30d / nurturing_90d / nurturing_180d →
disqualified / dnc / dead
```

---

## INBOUND CALL FEATURES

When a caller dials the AirRetail inbound number, the following happens automatically:

### 1. Caller identity extraction
Claude analyses the transcript after each inbound call and extracts:
- `caller_name` — if the caller stated their name
- `caller_company` — company name mentioned
- `caller_title` — job title if mentioned
- `inbound_call_type` — classified as one of:
  - `esl_inquiry` — caller asking about ESL / pricing
  - `support_request` — existing customer with a support issue
  - `partnership` — reseller / partner inquiry
  - `press_media` — journalist / analyst
  - `vendor` — supplier calling in
  - `other` / `null`

If the contact record shows "Unknown Caller", it is automatically updated with the extracted name and company.

### 2. AirDesk360 CRM sync
- A **note** is posted to the lead/deal in AirDesk360 with full transcript, summary, and qualification data
- For **ESL inquiries**: an **estimate** is created automatically under the customer record with AirESL SLIM Series + AirLED AP line items (rate = $0, TBD by specialist)
- For **support requests**: a **support ticket** is opened automatically and linked to the contact
- If the caller has no email (phone-only), a contact is created in AirDesk360 by phone number and linked to the ticket

### 3. Email follow-up sequences
Automatically enrolled based on call type:
| Call type | Sequence | Steps |
|---|---|---|
| `esl_inquiry` | `inbound_esl_inquiry` | Immediate info email + 2-day follow-up |
| `support_request` | `inbound_support_ack` | Immediate acknowledgement email |
| `partnership` | `inbound_partnership` | Immediate response + 5-day follow-up |

### 4. Calendar invites
When a meeting is booked on an inbound call, a calendar invite is sent automatically (requires `CALENDAR_INVITES_ENABLED=true` in `.env`).

---

## COMPLIANCE RULES (non-negotiable)
- DNC requests from calls are automatic — processed immediately
- AI always opens with: "Hi [name], this is AI [persona] calling from [company]..."
- Inbound AI always opens with: "Thank you for calling AirRetail Technologies, this is Liam, an AI receptionist..."
- Call window: 8am–9pm prospect local time (enforced in worker)
- Never call mobile numbers (filtered at phone lookup stage)

---

## ARCHITECTURE QUICK REFERENCE
- **API**: `apps/api` — Express, webhooks, health check
- **Workers**: `apps/workers` — BullMQ, call execution, transcript processing
- **Web dashboard**: `apps/web` — Next.js admin dashboard
- **MCP Server**: `apps/mcp-server` — these tools you're using now
- **Database**: Supabase PostgreSQL — all state lives here
- **Queue**: Redis + BullMQ — 10 named queues
- **Personas**: `packages/core/src/personas/personas.registry.ts`
- **Claude Prompts**: `packages/integrations/src/anthropic/prompts/`
- **Schema**: `packages/database/migrations/`
- **CRM**: AirDesk360 (Perfex CRM) via `packages/integrations/src/crm/airdesk360/`
- **Voice**: ElevenLabs Conversational AI — inbound + outbound agents
- **Telephony**: Telnyx SIP trunking → ElevenLabs SIP URI

---

## CREDIT / COST OPTIMISATION

ElevenLabs credit usage is driven by (in order of impact):
1. **LLM tokens** — biggest cost. All agents should use `claude-haiku-4-5` (not Opus). Change in ElevenLabs agent settings.
2. **TTS characters** — keep agent responses short. Voice delivery guidelines in prompts enforce this.
3. **STT minutes** — call duration. Shorter, crisper calls = lower cost.

Claude API cost is driven by model tier. Use `claude-haiku-4-5` for real-time voice (ElevenLabs agents) and `claude-sonnet-4-6` for offline transcript analysis (workers).

---

## ELEVENLABS KNOWLEDGE BASE

A Knowledge Base document is attached to all agents (inbound and outbound) covering full AirESL SLIM Series specs, AirPOS, AirBiz, AirWMS, and competitive positioning. This replaces the PRODUCT KNOWLEDGE section that was previously embedded in system prompts (reducing per-turn token cost). Agents retrieve relevant product detail on-demand from the KB rather than receiving it every conversation turn.

To update product knowledge: edit the KB document in ElevenLabs → it applies to all agents instantly.
