# Lovable Frontend Spec — AI SDR Platform

Goal: **every backend action is reachable from the UI.** This maps each API endpoint to a screen + control. Paste sections into Lovable as needed.

## Global conventions
- **Base URL:** `https://34-199-206-157.nip.io`
- **Auth:** `Authorization: Bearer <supabase access token>` on every request. NEVER use `x-api-key` in the frontend. No `VITE_`/`NEXT_PUBLIC` secrets.
- **Enums must be sent as values, not labels.** Show a friendly label, submit the value:
  - `retail_vertical`: `grocery`, `general_retail`, `wholesale_distribution`, `automotive_retail`, `electronics`, `specialty`, `cpg_operator`, `pharmacy`, `convenience`, `home_improvement`, `fashion_apparel`, `furniture`, `unknown`
  - `persona`: `mike`, `sarah`, `david`, `rachel`, `chris`, `emma`, `daniel`
  - `campaign status`: `draft`, `active`, `paused`, `completed`, `archived`
- **Phone numbers** in E.164 (`+1XXXXXXXXXX`).
- After any mutation, refetch the affected list/detail so the UI reflects new state.

---

## 1. Dashboard  (`GET /api/v1/dashboard`)
Read-only KPIs: today's calls/meetings, this-month totals + cost, week meetings, active campaigns, hot leads, recent calls, agent stats, funnel. Just render the response; no actions.

## 2. Campaigns
| Action | Method + endpoint | Notes |
|---|---|---|
| List | `GET /api/v1/campaigns` | table |
| Detail | `GET /api/v1/campaigns/{id}` | + `stageCounts` + `recentCalls` |
| Create | `POST /api/v1/campaigns` | body below |
| **Activate** | `PATCH /api/v1/campaigns/{id}/resume` | sets `active`; show when status is draft/paused |
| **Pause** | `PATCH /api/v1/campaigns/{id}/pause` | show when status is active |
| Edit pacing | `PATCH /api/v1/campaigns/{id}/pacing` | `{ daily_call_limit, hourly_call_limit, max_concurrent_calls }` |

**Create body** (add an "Advanced" collapsible for the optional fields):
```json
{
  "name": "Q3 Grocery Outbound",
  "target_verticals": ["grocery"],
  "enabled_personas": ["sarah","mike"],
  "target_titles": ["Store Manager","Operations Manager"],
  "daily_call_limit": 100,
  "hourly_call_limit": 20,
  "max_concurrent_calls": 5,
  "status": "draft"
}
```
- Only `name` is required. Verticals/personas/titles optional.
- **Add the Activate/Pause buttons** — there is currently no way to leave `draft` from the UI. Optionally add a "Start immediately" checkbox on create that sends `"status":"active"`.
- A campaign only dials when **active AND it has callable leads AND the scheduler worker is running.**

## 3. Leads
| Action | Method + endpoint | Notes |
|---|---|---|
| List (filters) | `GET /api/v1/leads?stage=&score_min=&vertical=&company=&campaign_id=` | |
| Hot leads | `GET /api/v1/leads/hot` | |
| Detail | `GET /api/v1/leads/{id}` | + calls + emails |
| Persona dropdown source | `GET /api/v1/leads/personas` | name/display_name/tone/best_for |
| **Add lead** | `POST /api/v1/leads` | body below |
| Change stage | `PATCH /api/v1/leads/{id}/stage` | `{ stage, reason? }` |
| Assign agent | `PATCH /api/v1/leads/{id}/persona` | `{ persona }` |
| **Call now** | `POST /api/v1/leads/{id}/call` | `{ persona? }` — dials immediately |
| Add to DNC | `POST /api/v1/leads/{id}/dnc` | `{ reason? }` |
| Bulk update | `POST /api/v1/leads/bulk-update` | **POST**, body: `{ lead_ids:[], updates:{ stage?, campaign_id?, score?, priority?, assigned_persona? } }` |
| Bulk DNC | `POST /api/v1/leads/bulk-dnc` | `{ lead_ids:[], reason? }` |

**Add Lead body:**
```json
{
  "company_name": "Test Store LLC",
  "first_name": "Jane", "last_name": "Doe",
  "title": "Store Manager",
  "phone": "+19175550123",
  "email": "jane@store.com",
  "retail_vertical": "grocery",
  "campaign_id": "<uuid>",
  "run_phone_lookup": true
}
```
Required: `first_name`, `company_name`, and `email` OR `phone`.

**Controls to ADD on these screens:**
- **Add Lead form:** a **"Skip phone validation (mark callable immediately)"** toggle → sends `run_phone_lookup: false`. Helper text: *"Use only for test numbers / numbers you trust — bypasses the mobile filter."* (Mobiles are otherwise routed to email-only.)
- **Lead detail:** an **agent/persona selector** (populated from `GET /leads/personas`) wired to `PATCH /leads/{id}/persona`, and a **"Call now"** button → `POST /leads/{id}/call` with the selected persona.
- **Bulk toolbar** on the list: select rows → reassign campaign/stage/persona (`POST /bulk-update`) and bulk DNC.
- **Notes panel** on lead detail (see §6).

## 4. Conversations  (calls)
| Action | Method + endpoint | Notes |
|---|---|---|
| List | `GET /api/v1/calls?persona=&outcome=&campaign_id=&direction=` | |
| Detail + transcript + **cost** | `GET /api/v1/calls/{id}/transcript` | response has a `cost` object: `total_usd`, `by_provider[]`, `line_items[]` |
| Booked meetings | `GET /api/v1/calls/meetings?status=` | also drives the Meetings screen |
| Transcript search | `GET /api/v1/calls/search?q=` | full-text |
| Log a manual call | `POST /api/v1/calls/log` | for calls made outside the AI |

**Add:** show the **per-call cost breakdown** (Claude + ElevenLabs + Twilio) on the call detail using the `cost` object.

## 5. Meetings  (`GET /api/v1/calls/meetings`)
Table of appointments with qualification summary, scheduled time, rep, products of interest. Filter by `status`.

## 6. Notes  (on lead/call detail)
| Action | Endpoint |
|---|---|
| List | `GET /api/v1/notes?lead_id=` or `?call_id=` |
| Create | `POST /api/v1/notes` `{ lead_id?/call_id?, body }` |
| Edit | `PATCH /api/v1/notes/{id}` `{ body }` |
| Delete | `DELETE /api/v1/notes/{id}` |

## 7. Tickets
| Action | Endpoint |
|---|---|
| List (filters) | `GET /api/v1/tickets?status=&priority=&lead_id=` |
| Detail | `GET /api/v1/tickets/{id}` |
| Create | `POST /api/v1/tickets` |
| Update | `PATCH /api/v1/tickets/{id}` |
| Delete | `DELETE /api/v1/tickets/{id}` |

## 8. Emails  (on lead detail + an Emails view)
| Action | Endpoint | Notes |
|---|---|---|
| List | `GET /api/v1/emails?lead_id=&contact_id=` | |
| **Preview (AI draft)** | `POST /api/v1/emails/preview` | returns subject+body synchronously |
| **Send** | `POST /api/v1/emails/send` | queues the send |

**Add:** a "Compose with AI" flow — call `/preview`, show editable subject/body, then `/send`.

## 9. Messages (SMS)
| Action | Endpoint |
|---|---|
| Thread list | `GET /api/v1/sms/threads` |
| Messages | `GET /api/v1/sms?contact_id=&lead_id=&direction=` |
| Send | `POST /api/v1/sms/send` |

## 10. Sequences
There is currently **no `/sequences` API** — this screen should read `email_sequences` / `contact_sequences` directly via Supabase (RLS off), OR ask backend for a `GET /api/v1/sequences` endpoint. Enrollments are created automatically (post-call, and for email-only leads on add/import). Show: sequence name, enrolled contacts, current step, status.

## 11. Transfer Rules  (replaces the dead "transfer now")
| Action | Endpoint |
|---|---|
| List | `GET /api/v1/transfer-rules` |
| Create | `POST /api/v1/transfer-rules` |
| Update | `PATCH /api/v1/transfer-rules/{id}` |
| Delete | `DELETE /api/v1/transfer-rules/{id}` |

**Create body:**
```json
{
  "name": "Caller requests human",
  "trigger": "explicit_request",
  "transfer_to_number": "+19295449529",
  "transfer_to_name": "Sales team",
  "enabled": true,
  "priority": 100
}
```
`trigger` ∈ `explicit_request | qualification_threshold | keyword | outcome | always`.
**Do NOT build a "transfer now" button** — `POST /transfer-rules/transfer-now` returns `501` by design (ElevenLabs owns the live call leg). The actual transfer is performed by a **"Transfer to number" tool configured on each ElevenLabs agent**; these rules are config/record-keeping. Surface a help note saying so.

## 12. DNC List
| Action | Endpoint |
|---|---|
| List | `GET /api/v1/dnc?type=phone|email&q=` |
| Add | `POST /api/v1/dnc` |
| Remove | `DELETE /api/v1/dnc/{id}` |

## 13. CSV Import
| Action | Endpoint |
|---|---|
| Past imports | `GET /api/v1/imports` |
| Import rows | `POST /api/v1/imports/leads` `{ rows:[...], campaign_id?, filename?, default_vertical? }` |
Parse the CSV client-side and post the row array. Imported leads now auto-advance through enrichment → calling/email.

## 14. Settings  (`GET /api/v1/settings`, `GET/PUT /api/v1/settings/{key}`)
Replace the "coming soon" page with editable setting blocks: company name, AI disclosure text/required, call window, etc. `PUT /api/v1/settings/{key}` upserts a block. These are per-user (`user_id`-scoped) — keep using the JWT.

## 15. Analytics  (Reporting)
| Endpoint | Shows |
|---|---|
| `GET /api/v1/reporting/stats?date_from=&date_to=` | daily call breakdown |
| `GET /api/v1/reporting/leaderboard?days=` | per-persona performance |
| `GET /api/v1/reporting/pipeline` | funnel by stage |
| `GET /api/v1/reporting/costs?date_from=&date_to=` | spend by provider |

## 16. Queues  (ops/admin)
`GET /api/v1/queues/` — show waiting/active/failed per queue. (Retry/drain are MCP/admin-only; optional.)

---

## Cross-cutting fixes to verify in the current build
1. **Campaign create** must send enum **values** (`grocery`, not `Grocery`).
2. **Activate/Pause** buttons exist (PATCH resume/pause).
3. **Add Lead** has the skip-phone-lookup toggle.
4. **Lead detail** has persona selector + Call now.
5. **Bulk update** uses **POST** with `{ lead_ids, updates:{...} }` (not PATCH, not top-level fields).
6. **Conversations** show the per-call `cost` object.
7. **Transfer Rules** is a CRUD screen, not a "transfer now" button.
8. **Settings** is implemented (not "coming soon").
9. Every screen uses the **Bearer JWT**, never `x-api-key`.
