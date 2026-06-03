/**
 * Twilio API types.
 *
 * Covers the two surfaces this platform uses directly:
 *  - Lookup v2 (`line_type_intelligence`) — phone qualification at the
 *    phone_lookup stage.
 *  - Programmable Messaging — outbound SMS + inbound/status webhooks.
 *
 * Note: ElevenLabs is the actual voice-call engine (it owns the Twilio
 * voice number), so Twilio's Programmable Voice API is intentionally NOT
 * wrapped here — call origination flows through ElevenLabs.
 */

// --- Lookup v2 ---

/**
 * `type` values returned by Twilio Lookup v2 line_type_intelligence.
 * @see https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence
 */
export type TwilioLineType =
  | 'landline'
  | 'mobile'
  | 'fixedVoip'
  | 'nonFixedVoip'
  | 'voip'
  | 'personal'
  | 'tollFree'
  | 'premium'
  | 'sharedCost'
  | 'uan'
  | 'voicemail'
  | 'pager'
  | 'unknown';

export interface TwilioLineTypeIntelligence {
  error_code: number | null;
  mobile_country_code: string | null;
  mobile_network_code: string | null;
  carrier_name: string | null;
  type: TwilioLineType | null;
}

export interface TwilioLookupResponse {
  calling_country_code: string;
  country_code: string | null;
  phone_number: string;
  national_format: string | null;
  valid: boolean;
  validation_errors: string[] | null;
  line_type_intelligence: TwilioLineTypeIntelligence | null;
  url: string;
}

// --- Programmable Messaging ---

export interface TwilioSmsSendRequest {
  from: string;
  to: string;
  text: string;
  /** Optional Messaging Service SID; if provided, takes precedence over `from`. */
  messagingServiceSid?: string | undefined;
  /** Optional status callback URL for delivery receipts. */
  statusCallback?: string | undefined;
}

/** Subset of the Message resource Twilio returns from POST /Messages.json */
export interface TwilioSmsSendResponse {
  sid: string;
  status: string;
  to: string;
  from: string | null;
  body: string;
  messaging_service_sid: string | null;
  date_created: string;
  error_code: number | null;
  error_message: string | null;
}

/**
 * Inbound SMS / status webhook payload (application/x-www-form-urlencoded,
 * parsed into an object). Twilio uses PascalCase keys.
 */
export interface TwilioInboundSmsPayload {
  MessageSid: string;
  SmsSid?: string;
  AccountSid: string;
  MessagingServiceSid?: string;
  From: string;
  To: string;
  Body?: string;
  NumMedia?: string;
  // Status-callback fields
  MessageStatus?: string;
  SmsStatus?: string;
  ErrorCode?: string;
  [key: string]: string | undefined;
}
