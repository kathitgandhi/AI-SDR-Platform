import crypto from 'crypto';

/**
 * Validate an ElevenLabs webhook signature.
 *
 * ElevenLabs signs webhooks with HMAC-SHA256. The `ElevenLabs-Signature`
 * header looks like `t=<unix_ts>,v0=<hex_digest>`, and the signed payload is
 * `"<t>.<raw_request_body>"`.
 *
 * @see https://elevenlabs.io/docs/conversational-ai/customization/personalization/conversation-initiation-webhooks
 *
 * NOTE: verify the exact header name / format against your ElevenLabs portal
 * webhook settings — ElevenLabs has used both `ElevenLabs-Signature` and
 * `elevenlabs-signature` casings.
 *
 * @param secret    Webhook signing secret from the ElevenLabs portal
 * @param header    Raw value of the `ElevenLabs-Signature` header
 * @param rawBody   Exact raw request body bytes/string
 * @param toleranceSecs  Max allowed clock skew (default 30 min)
 */
export function validateElevenLabsWebhookSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  toleranceSecs = 1800
): boolean {
  if (!header) return false;

  const parts = header.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts['t'];
  const provided = parts['v0'];
  if (!timestamp || !provided) return false;

  // Reject stale timestamps (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSecs = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSecs - ts) > toleranceSecs) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
