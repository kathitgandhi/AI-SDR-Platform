export type EmailSequenceType =
  | 'cold_followup'
  | 'no_answer'
  | 'meeting_confirmation'
  | 'post_demo'
  | 'long_nurture'
  | 'reactivation';

export interface EmailWriterContext {
  sequenceType: EmailSequenceType;
  stepNumber: number;
  contactFirstName: string;
  contactLastName: string;
  contactTitle: string;
  companyName: string;
  senderName: string;
  senderTitle: string;
  senderCompany: string;
  storeCount?: number;
  painPoints?: string[];
  productsOfInterest?: string[];
  callSummary?: string;
  meetingDate?: string;
  /** Google Meet join URL — included verbatim in meeting-confirmation emails. */
  meetingLink?: string;
  demoNotes?: string;
  lastContactDate?: string;
  vertical?: string;
}

export function buildEmailWriterPrompt(ctx: EmailWriterContext): string {
  const sequenceInstructions: Record<EmailSequenceType, string> = {
    cold_followup: `This email follows an outbound AI call where we spoke briefly. The prospect showed some interest but didn't book a meeting. Goal: re-engage, add value, drive to a meeting.`,
    no_answer: `This email follows an outbound call attempt where we did not reach the prospect (no answer or went to voicemail). Goal: introduce ourselves via email and offer value.`,
    meeting_confirmation: `This email confirms an upcoming meeting with one of our human sales reps. Goal: confirm details, set expectations, build excitement.`,
    post_demo: `This email follows a product demo or discovery call with a human rep. Goal: summarize value discussed, next steps, keep momentum.`,
    long_nurture: `This is a long-term nurture email (30/90/180 day). The prospect is not ready now but is worth staying in contact with. Goal: deliver value, stay top of mind, no hard sell.`,
    reactivation: `This is a reactivation email for a prospect who went cold 90-180+ days ago. Goal: re-engage with fresh angle, acknowledge time passed, offer new value.`,
  };

  const stepToneGuide: Record<number, string> = {
    1: 'Direct and brief — reference the call/previous touchpoint, clear value prop, single CTA',
    2: 'Add a specific insight or case study relevant to their vertical — soft follow-up',
    3: 'Create mild urgency — reference a relevant trend or timing factor, offer alternative CTA',
    4: 'Break-up email — respectful, leaves door open, no pressure',
  };

  return `You are a B2B email copywriter for ${ctx.senderCompany}, a retail technology company. Write a highly personalized, conversational sales email.

## EMAIL CONTEXT
- Sequence type: ${ctx.sequenceType}
- Step: ${ctx.stepNumber} of sequence
- Step tone guide: ${stepToneGuide[ctx.stepNumber] ?? 'Professional and direct'}

## SEQUENCE PURPOSE
${sequenceInstructions[ctx.sequenceType]}

## RECIPIENT
- Name: ${ctx.contactFirstName} ${ctx.contactLastName}
- Title: ${ctx.contactTitle}
- Company: ${ctx.companyName}
${ctx.storeCount ? `- Store count: ${ctx.storeCount}` : ''}
${ctx.vertical ? `- Retail vertical: ${ctx.vertical}` : ''}
${ctx.painPoints?.length ? `- Known pain points: ${ctx.painPoints.join(', ')}` : ''}
${ctx.productsOfInterest?.length ? `- Products of interest: ${ctx.productsOfInterest.join(', ')}` : ''}
${ctx.callSummary ? `- Previous call notes: ${ctx.callSummary}` : ''}
${ctx.meetingDate ? `- Meeting date/time: ${ctx.meetingDate}` : ''}
${ctx.meetingLink ? `- Google Meet link (include this EXACT URL in the email as the join link): ${ctx.meetingLink}` : ''}
${ctx.demoNotes ? `- Demo notes: ${ctx.demoNotes}` : ''}
${ctx.lastContactDate ? `- Last contacted: ${ctx.lastContactDate}` : ''}

## SENDER
- Name: ${ctx.senderName}
- Title: ${ctx.senderTitle}
- Company: ${ctx.senderCompany}

## WRITING RULES
- Subject line: 6-9 words, no spam triggers, no ALL CAPS, no excessive punctuation
- Opening: NO "I hope this email finds you well" — ever
- Body: 3-5 sentences max for standard emails, 5-7 for post-demo
- One clear CTA only
- Personalize using company name, store count, or vertical at least once
- Natural, human-sounding — not corporate robot speak
- Never use: "synergy", "circle back", "touch base", "per my last email"
- If there are pain points, reference at least one specifically
- Sign off naturally: "Best," or "Talk soon," — not "Sincerely" or "Regards"

## OUTPUT FORMAT
Return JSON:
\`\`\`json
{
  "subject": "<email subject line>",
  "body_text": "<plain text email body>",
  "body_html": "<HTML formatted email body with <p> tags and <strong> for emphasis>",
  "preview_text": "<email preview text under 100 chars>"
}
\`\`\``;
}
