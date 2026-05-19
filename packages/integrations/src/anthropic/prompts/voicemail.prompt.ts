import { PersonaName } from '@ai-sdr/database';

export interface VoicemailContext {
  persona: PersonaName;
  callerCompanyName: string;
  contactFirstName: string;
  prospectCompanyName: string;
  callAttempt: number;
  callerPhone: string;
}

export function buildVoicemailScript(ctx: VoicemailContext): string {
  const personaDisplayName = ctx.persona.charAt(0).toUpperCase() + ctx.persona.slice(1);

  const scripts: Record<number, string> = {
    1: `Hi ${ctx.contactFirstName}, this is AI ${personaDisplayName} calling from ${ctx.callerCompanyName}. We help retail chains automate their shelf labels and modernize their store technology — and based on ${ctx.prospectCompanyName}'s footprint, I thought it was worth a quick conversation. I'll try you again, but if it's easier, you can reach our team directly. Again, this is ${personaDisplayName} from ${ctx.callerCompanyName}. Have a great day.`,

    2: `Hi ${ctx.contactFirstName}, AI ${personaDisplayName} again from ${ctx.callerCompanyName} — I don't want to be a pest, but I did want to make one more attempt. We're working with several [retail vertical] operators right now on eliminating the manual labor around price changes, and the ROI numbers have been pretty compelling. If now's not the right time, no worries at all — but if you're ever curious what that looks like for ${ctx.prospectCompanyName}, I hope you'll reach out. Take care.`,

    3: `Hi ${ctx.contactFirstName}, last message from me — AI ${personaDisplayName} at ${ctx.callerCompanyName}. I'll get out of your voicemail after this one. If electronic shelf labels or store technology modernization ever becomes a priority for ${ctx.prospectCompanyName}, we'd love to be on your shortlist. You can always find us at ${ctx.callerCompanyName}.com. Best of luck, and thanks for your patience.`,
  };

  return scripts[ctx.callAttempt] ?? scripts[3]!;
}

export function buildVoicemailPrompt(ctx: VoicemailContext): string {
  return `Generate a natural, compliant voicemail script for an AI SDR.

## CONTEXT
- AI persona name: ${ctx.persona.charAt(0).toUpperCase() + ctx.persona.slice(1)}
- Calling company: ${ctx.callerCompanyName}
- Contact first name: ${ctx.contactFirstName}
- Prospect company: ${ctx.prospectCompanyName}
- Call attempt number: ${ctx.callAttempt} of 3
- Callback number: ${ctx.callerPhone}

## REQUIREMENTS
- Identify as AI immediately ("this is AI [name]")
- State company name
- State call purpose briefly (retail technology / shelf labels / store modernization)
- Keep under 25 seconds when spoken aloud
- Natural, not robotic
- For attempt 2+: acknowledge it's a follow-up, don't sound desperate
- For attempt 3: signal it's the last message
- Never promise things we can't deliver
- Include a soft call to action (call back or say they'll follow up)

Return ONLY the voicemail script text, no labels or formatting.`;
}
