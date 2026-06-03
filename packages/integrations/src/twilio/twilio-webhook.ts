import crypto from 'crypto';

/**
 * Validate a Twilio webhook request signature.
 *
 * Twilio signs each request with HMAC-SHA1 using your Auth Token as the key.
 * The signed string is the full request URL with all POST params appended in
 * alphabetical order (key immediately followed by value), then base64-encoded.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * @param authToken  Twilio Auth Token (the HMAC key)
 * @param signature  Value of the `X-Twilio-Signature` header
 * @param url        The full URL Twilio requested (exactly as configured, incl. scheme/host/path/query)
 * @param params     The parsed application/x-www-form-urlencoded POST body
 */
export function validateTwilioWebhookSignature(
  authToken: string,
  signature: string | undefined,
  url: string,
  params: Record<string, string | undefined>
): boolean {
  if (!signature) return false;

  // Append POST params sorted alphabetically by key: key + value, no separators.
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + (params[key] ?? '');
  }

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
