import { QualificationData } from '@ai-sdr/database';

export interface QualificationAnalysisRequest {
  transcript: string;
  companyName: string;
  contactName: string;
  contactTitle: string;
  retailVertical: string;
}

export function buildQualificationAnalysisPrompt(req: QualificationAnalysisRequest): string {
  return `You are analyzing a sales call transcript to extract qualification data and score the lead.

## CALL INFORMATION
- Company: ${req.companyName}
- Contact: ${req.contactName} (${req.contactTitle})
- Retail Vertical: ${req.retailVertical}

## TRANSCRIPT
${req.transcript}

## YOUR TASK

Extract ALL qualification data from the transcript and return a JSON object with these exact fields:

\`\`\`json
{
  "qualification_data": {
    "store_count": <number or null>,
    "current_esl_vendor": "<string or null>",
    "current_pos_vendor": "<string or null>",
    "current_erp_vendor": "<string or null>",
    "current_wms_vendor": "<string or null>",
    "pain_points": ["<pain1>", "<pain2>"],
    "rollout_timeline": "<string or null>",
    "budget_range": "<string or null>",
    "decision_authority": "<string or null>",
    "decision_process": "<string or null>",
    "is_decision_maker": <true/false/null>,
    "budget_confirmed": <true/false>,
    "timeline_confirmed": <true/false>,
    "authority_confirmed": <true/false>,
    "need_confirmed": <true/false>,
    "bant_score": <0-100>
  },
  "call_analysis": {
    "outcome": "<meeting_booked|callback_requested|not_interested|not_decision_maker|wrong_number|voicemail_left|voicemail_full|no_answer|gatekeeper_blocked|dnc_requested|already_customer|using_competitor|too_small|qualified_nurture>",
    "summary": "<2-3 sentence call summary>",
    "sentiment": "<very_positive|positive|neutral|negative|very_negative>",
    "interest_level": <1-10>,
    "qualification_score": <0-100>,
    "outcome_score": <0-100>,
    "key_insights": ["<insight1>", "<insight2>"],
    "objections_raised": ["<objection1>"],
    "interest_signals": ["<signal1>"],
    "competitors_mentioned": ["<competitor1>"],
    "next_steps": "<agreed next steps>",
    "recommended_follow_up": "<email_sequence|call_back_date|meeting_booked|nurture_30d|nurture_90d|nurture_180d|dnc|dead>",
    "recommended_sequence": "<sequence_name>",
    "meeting_details": {
      "booked": <true/false>,
      "proposed_date": "<ISO date or null>",
      "confirmed_date": "<ISO date or null>",
      "timezone": "<timezone or null>",
      "duration_minutes": <30 or null>,
      "attendee_name": "<name or null>",
      "attendee_email": "<email or null>",
      "meeting_type": "discovery"
    },
    "dnc_requested": <true/false>,
    "opt_out_requested": <true/false>,
    "decision_maker_reached": <true/false>,
    "gatekeeper_reached": <true/false>
  },
  "crm_notes": "<Professional CRM-ready notes that a human sales rep would want to read before a follow-up call. Include all relevant context, pain points, tech stack, and next steps.>"
}
\`\`\`

## SCORING GUIDE

**BANT Score (0-100):**
- Budget confirmed: +25
- Authority confirmed (decision maker): +25
- Need confirmed (pain point identified): +25
- Timeline confirmed: +25

**Qualification Score (0-100):**
- Store count 1-4: +10
- Store count 5-19: +20
- Store count 20-99: +30
- Store count 100+: +40
- Paper labels / no ESL: +20
- Legacy POS identified: +15
- No ERP / QuickBooks: +15
- No WMS / manual warehouse: +10
- Active modernization project: +20
- Budget available: +15
- Short timeline (<6 months): +10

**Outcome Score (0-100):**
- Meeting booked: 90-100
- Callback with date: 70-80
- Sent-email with context: 50-60
- Voicemail left: 30-40
- No answer: 10-20
- Not interested: 5
- DNC requested: 0

Return ONLY the JSON object. No explanation text.`;
}

export function buildHandoffSummaryPrompt(params: {
  contactName: string;
  contactTitle: string;
  companyName: string;
  storeCount: number | null;
  vertical: string;
  qualificationData: Partial<QualificationData>;
  callSummary: string;
  appointmentDate?: string;
}): string {
  return `Generate a professional sales handoff summary for a human sales rep who will conduct the next call or meeting.

## PROSPECT DETAILS
- Name: ${params.contactName}
- Title: ${params.contactTitle}
- Company: ${params.companyName}
- Retail Vertical: ${params.vertical}
- Store Count: ${params.storeCount ?? 'Unknown'}
${params.appointmentDate ? `- Meeting Scheduled: ${params.appointmentDate}` : ''}

## QUALIFICATION DATA
${JSON.stringify(params.qualificationData, null, 2)}

## CALL SUMMARY
${params.callSummary}

## YOUR TASK

Write a handoff summary with these sections:

**Prospect Overview** — Who they are and what their business looks like (2-3 sentences)

**Pain Points Identified** — Bulleted list of confirmed problems we can solve

**Tech Stack** — Current ESL, POS, ERP, WMS vendors (or "none confirmed")

**Qualification Status** — BANT assessment (what's confirmed vs unknown)

**Opportunity Assessment** — Which of our products (AirESL, AirPOS, AirBiz, AirWMS) are most relevant and why

**Competitive Landscape** — Any competitors mentioned and their position

**Recommended Approach** — What the human rep should lead with, what to avoid, what questions to ask

**Next Steps** — Clear action items for the rep

Keep the tone professional and factual. This will be read immediately before a sales call.`;
}
