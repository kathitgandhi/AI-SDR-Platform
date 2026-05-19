import Anthropic from '@anthropic-ai/sdk';
import { Logger } from 'pino';
import { buildQualificationAnalysisPrompt, QualificationAnalysisRequest } from './prompts/qualification.prompt';
import { buildEmailWriterPrompt, EmailWriterContext } from './prompts/email-writer.prompt';
import { buildHandoffSummaryPrompt } from './prompts/qualification.prompt';
import { QualificationData, ClaudeAnalysis, MeetingDetails } from '@ai-sdr/database';

export interface CallAnalysisResult {
  qualificationData: QualificationData;
  callAnalysis: ClaudeAnalysis & {
    outcome: string;
    dnc_requested: boolean;
    opt_out_requested: boolean;
    decision_maker_reached: boolean;
    gatekeeper_reached: boolean;
    next_steps: string;
    recommended_follow_up: string;
    recommended_sequence: string;
    meeting_details: MeetingDetails;
  };
  crmNotes: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export interface GeneratedEmail {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  previewText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class ClaudeReasoningService {
  private readonly client: Anthropic;
  private readonly logger: Logger;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(
    apiKey: string,
    model: string,
    maxTokens: number,
    logger: Logger
  ) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxTokens = maxTokens;
    this.logger = logger.child({ module: 'ClaudeReasoningService' });
  }

  async analyzeCallTranscript(request: QualificationAnalysisRequest): Promise<CallAnalysisResult> {
    const prompt = buildQualificationAnalysisPrompt(request);

    this.logger.info(
      { company: request.companyName, contact: request.contactName },
      'Analyzing call transcript with Claude'
    );

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: 'You are a sales intelligence AI. Always return valid JSON matching the exact schema requested.',
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content?.type !== 'text') throw new Error('Unexpected response type from Claude');

      const jsonMatch = content.text.match(/```json\n?([\s\S]*?)\n?```/) ?? [null, content.text];
      const parsed = JSON.parse(jsonMatch[1]!);

      const usage = response.usage;
      const inputCost = (usage.input_tokens / 1_000_000) * 15.0;
      const outputCost = (usage.output_tokens / 1_000_000) * 75.0;
      const cacheReadCost = ((usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0) / 1_000_000 * 1.5;

      return {
        qualificationData: parsed.qualification_data,
        callAnalysis: parsed.call_analysis,
        crmNotes: parsed.crm_notes,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheReadTokens: (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
        costUsd: inputCost + outputCost + cacheReadCost,
      };
    } catch (error) {
      this.logger.error({ error }, 'Call transcript analysis failed');
      throw error;
    }
  }

  async generateEmail(ctx: EmailWriterContext): Promise<GeneratedEmail> {
    const prompt = buildEmailWriterPrompt(ctx);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1500,
        system: 'You are a B2B email copywriter. Always return valid JSON matching the exact schema requested.',
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content?.type !== 'text') throw new Error('Unexpected response type');

      const jsonMatch = content.text.match(/```json\n?([\s\S]*?)\n?```/) ?? [null, content.text];
      const parsed = JSON.parse(jsonMatch[1]!);

      const usage = response.usage;
      const costUsd =
        (usage.input_tokens / 1_000_000) * 15.0 +
        (usage.output_tokens / 1_000_000) * 75.0;

      return {
        subject: parsed.subject,
        bodyText: parsed.body_text,
        bodyHtml: parsed.body_html,
        previewText: parsed.preview_text,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        costUsd,
      };
    } catch (error) {
      this.logger.error({ error }, 'Email generation failed');
      throw error;
    }
  }

  async generateHandoffSummary(params: Parameters<typeof buildHandoffSummaryPrompt>[0]): Promise<string> {
    const prompt = buildHandoffSummaryPrompt(params);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      system: 'You are a sales intelligence assistant. Write clear, professional handoff summaries for sales reps.',
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content?.type !== 'text') throw new Error('Unexpected response type');
    return content.text;
  }

  async generateDailyDigest(params: {
    date: string;
    stats: Record<string, number>;
    topLeads: Array<{ company: string; score: number; stage: string }>;
    meetings: Array<{ company: string; contact: string; date: string }>;
    agentPerformance: Array<{ persona: string; calls: number; meetings: number; rate: number }>;
  }): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: `Generate a concise daily sales digest email for the sales leadership team.

Date: ${params.date}

Stats:
${JSON.stringify(params.stats, null, 2)}

Top Qualified Leads:
${params.topLeads.map(l => `- ${l.company}: score ${l.score}, stage: ${l.stage}`).join('\n')}

Meetings Booked:
${params.meetings.map(m => `- ${m.company} (${m.contact}) — ${m.date}`).join('\n')}

Agent Performance:
${params.agentPerformance.map(a => `- ${a.persona}: ${a.calls} calls, ${a.meetings} meetings, ${(a.rate * 100).toFixed(1)}% meeting rate`).join('\n')}

Write a clear, executive-friendly digest with:
1. Summary (3-4 sentences)
2. Key metrics in a scannable format
3. Meetings booked (list)
4. Top opportunities to watch
5. Agent of the day
6. One key insight or recommendation

Keep it under 400 words. Use bullet points liberally. Make it something a VP would actually read.`,
        },
      ],
    });

    const content = response.content[0];
    if (content?.type !== 'text') throw new Error('Unexpected response type');
    return content.text;
  }
}
