# How It Works — AI SDR Platform

A complete walkthrough of the platform: how to create a campaign, add leads, and
how every step of the pipeline works behind the scenes. This is the content for
the in-app **"How it works"** page.

---

## What this platform does

It runs **automated outbound sales development** for AirRetail (ESL, POS, ERP,
WMS). You define who to target; the system sources/loads leads, validates them,
calls them with an AI voice agent that always discloses it's an AI, analyzes
every call, sends follow-up emails, books demos, and surfaces hot leads for your
human reps — all tracked on the dashboard.

There are 7 AI agent personas (Mike, Sarah, David, Rachel, Chris, Emma, Daniel),
each with a distinct style, so different prospects get the right approach.

---

## The big picture (end to end)

```
Create campaign ─▶ Add leads ─▶ Enrich & validate phone ─▶ Callable / Email-only
        │                                                        │
        ▼                                                        ▼
  Activate campaign ─▶ AI calls the lead ─▶ Post-call analysis ─▶ Follow-up email
                                │                   │
                                ▼                   ▼
                        Transfer to human?     Book a demo / score the lead
                                                    │
                                                    ▼
                                   Meeting booked + handoff summary for your rep
```

---

## Step 1 — Create a campaign

A campaign is a target audience + the rules for how aggressively to work it.

1. Go to **Campaigns → New campaign**.
2. Fill in:
   - **Name** — e.g. "Q3 Grocery Outbound".
   - **Target verticals** — e.g. Grocery, Convenience.
   - **Enabled personas** — which AI agents may call (pick one for a focused test).
   - *(Advanced)* **Daily / hourly call limits**, **max concurrent calls** —
     pacing. Defaults: 100/day, 20/hour, 5 concurrent.
3. Click **Create**. The campaign starts in **Draft** (it won't call anything yet).
4. When you're ready, click **Activate** to set it **Active**.

> A campaign only auto-dials when it is **Active** *and* has **callable leads**.
> Draft/Paused campaigns sit idle.

---

## Step 2 — Add leads

A "lead" = a **company** + a **contact** + a phone and/or email. Three ways to add them:

| Method | When to use |
|---|---|
| **Add Lead** (single) | One-off / testing. Enter company, contact, phone/email. |
| **CSV Import** | Bulk upload from a spreadsheet. |
| **ZoomInfo import** (automatic) | The campaign auto-pulls fresh leads when its pool runs low (requires ZoomInfo credentials). |

**Phone validation toggle:** by default a new lead's phone is line-type checked
(see Step 3). For a **test with your own (mobile) number**, turn on **"Skip phone
validation"** so it's marked callable immediately — otherwise mobiles are routed
to email-only by the compliance filter.

---

## Step 3 — Enrichment & phone validation (automatic)

Every new lead flows through validation before it can be called:

1. **Enrichment** — normalizes the lead and routes it forward.
2. **Phone lookup** — checks the number's line type and the Do-Not-Contact list:
   - **Landline** → **Callable** (ready to be dialed).
   - **Mobile / VoIP** → **Email-only** (compliance: the system never calls mobiles).
   - **On DNC** → marked **DNC**, never contacted.
   - **No usable phone or email** → **Dead**.

So after this step every lead is either **Callable**, **Email-only**, **DNC**, or **Dead**.

---

## Step 4 — The AI makes the call

When a campaign is active, the scheduler picks callable leads (respecting daily/
hourly limits, concurrency, and the **8am–9pm local calling window**) and dials
them. You can also dial a single lead instantly with **Call now** on the lead page.

On the call, the AI agent:
- **Always discloses it's an AI** in the opening line (e.g. *"Hi, this is AI Sarah
  from Air Business Solutions…"*) — legal + non-negotiable.
- Runs natural discovery (current POS/ESL setup, pain points, store count).
- Handles objections, and tries to **book a 15–30 min demo**.
- **Transfers to a human** at your transfer number if the prospect asks to speak
  to a real person.
- **Honors "remove me"** instantly — adds the number to DNC and ends the call.

---

## Step 5 — Post-call processing (automatic)

The moment a call ends, the system:
1. **Transcribes** the conversation.
2. **Analyzes it with Claude** — determines the **outcome**, a **qualification
   score**, pain points, objections, and next steps.
3. **Records the cost** of the call (Claude + ElevenLabs voice + Twilio telephony)
   so each call shows an all-in cost.
4. **Moves the lead** to the right stage based on the outcome.
5. **Writes a note** and, for qualified/booked leads, a **handoff summary** for your rep.
6. **Sends a follow-up email** (see Step 6).

### Call outcomes
| Outcome | Meaning | What happens next |
|---|---|---|
| **Meeting booked** | Prospect agreed to a demo | Appointment created + confirmation email |
| **Connected / Qualified** | Good conversation, no meeting yet | Follow-up email + nurture |
| **Not interested** | Declined | Reason captured, moved to long-term nurture |
| **No answer / Voicemail** | Didn't reach them | Retried later (up to the retry limit) + email |
| **Gatekeeper** | Reached a gatekeeper | Logged; retried |
| **DNC requested** | Asked to stop | Added to DNC, never contacted again |

---

## Step 6 — Email follow-up & sequences (automatic)

- After a **call**, the lead is enrolled in the matching email sequence and the
  first email goes out immediately; later steps are scheduled automatically.
- **Email-only leads** (mobiles, or contacts with only an email) are enrolled in a
  first-touch sequence **as soon as they're added/imported** — they don't wait for
  a call.
- Emails are AI-written, personalized to the contact/company, and sent from your
  connected mailbox. You can also **compose with AI** manually from a lead and send.

The **Sequences** screen shows each sequence, its steps, and who's currently enrolled.

---

## Step 7 — Meetings & human handoff

- Booked demos appear under **Meetings** with date/time, the contact, and a
  **qualification summary** (pain points, store count, budget signals, timeline).
- **Hot leads** (qualified or meeting-booked) surface on the **Dashboard** for your
  reps to pick up.
- A rep takes it from there — the AI's job is to qualify and book, not to close.

---

## Lead lifecycle (every stage)

```
new → enriching → enriched → phone_lookup_pending →
   callable ──▶ in_call_queue → calling →
        ├─ connected → qualified → meeting_booked → meeting_held
        ├─ called_no_answer / called_voicemail / called_gatekeeper  (retry)
        └─ not interested → nurturing_30d / 90d / 180d
   email_only ──▶ (email sequence)
   disqualified · dnc · dead   (end states)
```

---

## Autopilot vs. manual

- **Autopilot (campaign Active):** the scheduler continuously dials callable leads
  and, if ZoomInfo is connected, tops up the lead pool when it runs low.
- **Manual:** dial any single lead with **Call now**, send a one-off email, or move
  a lead's stage yourself. Useful for testing and for reps working specific accounts.

---

## Managing your data (CRUD)

- **Edit** a campaign (name, targeting, personas, pacing, status) or a lead
  (contact details, company, score, assigned agent) anytime.
- **Remove** a campaign or lead — this is a **soft delete**: it disappears from your
  lists but the call/email history is preserved (and it can be restored). The
  platform never hard-deletes records with history.

---

## Reporting & cost

- **Analytics** — daily call volume and outcomes, agent leaderboard, pipeline
  funnel, and **spend by provider** (Claude, ElevenLabs, Twilio).
- **Per-call cost** — open any call to see its all-in cost broken down by provider.
- **Digests** — automatic daily and weekly summary emails of activity and results.

---

## Compliance (always on, non-negotiable)

- The AI **always identifies itself as an AI** at the start of every call.
- **Calling window:** only 8am–9pm in the prospect's local time.
- **Mobiles are never called** — they're routed to email instead.
- **"Remove me" / DNC requests** are honored immediately and permanently.

---

## Quick start: your first test run

1. **Create** a campaign (one vertical, one persona, small limits).
2. **Add one lead** using **your own phone number**, with **"Skip phone validation"
   ON** (so your mobile is dialable for the test).
3. Open the lead → choose an agent → **Call now**.
4. **Answer** the call. Try: asking for a human (transfer), booking a demo, or
   saying "remove me from your list".
5. Check the results:
   - **Conversations** → your call, transcript, outcome, and cost.
   - **Meetings** → the demo if you booked one.
   - **Lead** → its new stage + the follow-up email.
   - **Dashboard** → today's activity.

That's the whole loop. Scale up by adding more leads (CSV/ZoomInfo) and activating
the campaign so the AI works them automatically.
