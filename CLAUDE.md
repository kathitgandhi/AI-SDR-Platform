# AI SDR Platform — Claude Control Reference

You have full remote-control access to this AI outbound sales platform via MCP tools.

## WHAT THIS PLATFORM DOES

Automated outbound SDR system for AirRetail Technologies (sells AirESL, AirPOS, AirBiz, AirWMS).
- Pulls leads from ZoomInfo → enriches → filters by phone type → calls via ElevenLabs AI voice agents → Claude reasoning → Gmail follow-up → Supabase storage
- 7 AI SDR personas: Mike, Sarah, David, Rachel, Chris, Emma, Daniel
- Full DNC/compliance system — AI always discloses identity on calls

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
| `get_agent_leaderboard` | Performance ranking for all 7 AI personas |
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

## COMPLIANCE RULES (non-negotiable)
- DNC requests from calls are automatic — processed immediately
- AI always opens with: "Hi [name], this is AI [persona] calling from [company]..."
- Call window: 8am–9pm prospect local time (enforced in worker)
- Never call mobile numbers (filtered at phone lookup stage)

## ARCHITECTURE QUICK REFERENCE
- **API**: `apps/api` — Express, webhooks, health check
- **Workers**: `apps/workers` — BullMQ, call execution, transcript processing
- **MCP Server**: `apps/mcp-server` — these tools you're using now
- **Database**: Supabase PostgreSQL — all state lives here
- **Queue**: Redis + BullMQ — 10 named queues
- **Personas**: `packages/core/src/personas/personas.registry.ts`
- **Claude Prompts**: `packages/integrations/src/anthropic/prompts/`
- **Schema**: `packages/database/migrations/`
