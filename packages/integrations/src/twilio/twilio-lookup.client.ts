import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';
import { TwilioLookupResponse, TwilioLineType } from './twilio.types';
import { LineType } from '@ai-sdr/database';

/**
 * Drop-in replacement for TelnyxLookupClient. Returns the IDENTICAL
 * PhoneLookupResult shape so the phone_lookup worker stays unchanged.
 *
 * Backed by Twilio Lookup v2 line_type_intelligence.
 */

const CALLABLE_LINE_TYPES: TwilioLineType[] = ['landline'];
const EMAIL_ONLY_LINE_TYPES: TwilioLineType[] = ['mobile', 'voip', 'fixedVoip', 'nonFixedVoip'];

export interface PhoneLookupResult {
  phoneNumber: string;
  lineType: LineType;
  isCallable: boolean;
  isEmailOnly: boolean;
  isDead: boolean;
  carrierName: string | null;
  isValid: boolean;
  /** Twilio Lookup v2 does not return a fraud score; always null. */
  fraudRiskScore: number | null;
  rawLineType: TwilioLineType;
}

const TWILIO_LOOKUP_BASE_URL = 'https://lookups.twilio.com';

export class TwilioLookupClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;

  /**
   * @param accountSid Twilio Account SID (basic-auth username)
   * @param authToken  Twilio Auth Token (basic-auth password)
   * @param logger     pino logger
   * @param baseUrl    override (defaults to https://lookups.twilio.com)
   */
  constructor(accountSid: string, authToken: string, logger: Logger, baseUrl: string = TWILIO_LOOKUP_BASE_URL) {
    this.logger = logger.child({ module: 'TwilioLookupClient' });
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      auth: { username: accountSid, password: authToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  async lookupPhone(phoneNumber: string): Promise<PhoneLookupResult> {
    const normalized = this.normalizePhone(phoneNumber);

    try {
      const response = await this.http.get<TwilioLookupResponse>(
        `/v2/PhoneNumbers/${encodeURIComponent(normalized)}`,
        { params: { Fields: 'line_type_intelligence' } }
      );

      const data = response.data;
      const rawLineType: TwilioLineType = data.line_type_intelligence?.type ?? 'unknown';
      const lineType = this.mapLineType(rawLineType);

      const isCallable = data.valid && CALLABLE_LINE_TYPES.includes(rawLineType);
      const isEmailOnly = data.valid && EMAIL_ONLY_LINE_TYPES.includes(rawLineType);
      const isDead = !data.valid;

      this.logger.debug({ phoneNumber: normalized, rawLineType, isCallable }, 'Phone lookup complete');

      return {
        phoneNumber: normalized,
        lineType,
        isCallable,
        isEmailOnly,
        isDead,
        carrierName: data.line_type_intelligence?.carrier_name ?? null,
        isValid: data.valid,
        fraudRiskScore: null,
        rawLineType,
      };
    } catch (error) {
      this.logger.error({ error, phoneNumber: normalized }, 'Phone lookup failed');
      return {
        phoneNumber: normalized,
        lineType: 'unknown',
        isCallable: false,
        isEmailOnly: false,
        isDead: true,
        carrierName: null,
        isValid: false,
        fraudRiskScore: null,
        rawLineType: 'unknown',
      };
    }
  }

  async lookupBatch(
    phoneNumbers: string[],
    concurrency = 5
  ): Promise<Map<string, PhoneLookupResult>> {
    const results = new Map<string, PhoneLookupResult>();
    const chunks = this.chunkArray(phoneNumbers, concurrency);

    for (const chunk of chunks) {
      const lookups = await Promise.all(chunk.map((phone) => this.lookupPhone(phone)));
      lookups.forEach((result, idx) => {
        results.set(chunk[idx]!, result);
      });
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return results;
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  private mapLineType(twilioType: TwilioLineType): LineType {
    const map: Record<TwilioLineType, LineType> = {
      landline: 'landline',
      mobile: 'mobile',
      voip: 'voip',
      fixedVoip: 'voip',
      nonFixedVoip: 'voip',
      tollFree: 'toll_free',
      premium: 'premium',
      sharedCost: 'unknown',
      personal: 'mobile',
      pager: 'unknown',
      uan: 'unknown',
      voicemail: 'unknown',
      unknown: 'unknown',
    };
    return map[twilioType] ?? 'unknown';
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
