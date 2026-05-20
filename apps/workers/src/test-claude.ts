/**
 * Smoke test: verify Anthropic API key + Claude reasoning service work end-to-end
 * by analyzing a fake call transcript.
 *
 * Run on EC2:
 *   sudo docker compose exec call-workers node /app/apps/workers/dist/test-claude.js
 */
import pino from 'pino';
import { ClaudeReasoningService } from '@ai-sdr/integrations';
import { workerEnv } from './config/env';

const logger = pino({ level: 'info' });

const FAKE_TRANSCRIPT = `
[Agent Mike]: Hi, is this John?
[John]: Yes, this is John. Who's calling?
[Agent Mike]: Hi John, this is AI Mike calling from AirRetail Technologies. I help grocery chains modernize their pricing systems with electronic shelf labels. Do you have a quick moment?
[John]: We're actually looking at ESL options right now. What's the pitch?
[Agent Mike]: We're working with chains your size — around 500 stores — to roll out ESL across produce and dry goods. Our system updates 50,000 prices in under 90 seconds. Are you currently using anything?
[John]: We piloted SES-imagotag in 12 stores last year. Performance was OK but the price was high and integration with our Oracle POS was painful.
[Agent Mike]: That's a really common story. We integrate natively with Oracle Retail and our pricing is about 35% below SES at scale. What's your timeline looking like?
[John]: We need to make a decision by Q3. Budget is around $4 million for the full rollout. I make the call but my CFO needs to sign off.
[Agent Mike]: Perfect. Can I get 30 minutes on your calendar next week with our VP of Sales to walk through a tailored proposal for Whole Foods?
[John]: Yeah, Thursday at 2pm Eastern works. Send the invite to john@wholefoods.com.
[Agent Mike]: Done. Thursday 2pm Eastern. Talk soon, John.
`;

async function main() {
  if (!workerEnv.ANTHROPIC_API_KEY?.startsWith('sk-ant-')) {
    logger.error('ANTHROPIC_API_KEY missing or malformed');
    process.exit(1);
  }

  const service = new ClaudeReasoningService(
    workerEnv.ANTHROPIC_API_KEY,
    workerEnv.ANTHROPIC_MODEL,
    workerEnv.ANTHROPIC_MAX_TOKENS,
    logger,
  );

  logger.info({ model: workerEnv.ANTHROPIC_MODEL }, 'Calling Claude with fake transcript...');
  const t0 = Date.now();

  try {
    const result = await service.analyzeCallTranscript({
      transcript: FAKE_TRANSCRIPT,
      companyName: 'Whole Foods',
      contactName: 'John Doe',
      contactTitle: 'VP of Operations',
      retailVertical: 'grocery',
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    logger.info({ elapsedSeconds: elapsed }, '✅ Claude analysis complete');

    console.log('\n========== CLAUDE ANALYSIS RESULT ==========');
    console.log('\n--- Qualification Data ---');
    console.log(JSON.stringify(result.qualificationData, null, 2));
    console.log('\n--- Call Analysis ---');
    console.log(JSON.stringify(result.callAnalysis, null, 2));
    console.log('\n--- CRM Notes ---');
    console.log(result.crmNotes);
    console.log('\n--- Token Usage ---');
    console.log(`Input: ${result.inputTokens} tokens`);
    console.log(`Output: ${result.outputTokens} tokens`);
    console.log(`Cost: $${result.costUsd.toFixed(4)}`);
    console.log('\n============================================\n');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '❌ Claude call failed');
    process.exit(1);
  }
}

void main();
