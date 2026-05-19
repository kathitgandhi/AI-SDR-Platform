import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';
import { TelnyxPhoneLookupResponse, TelnyxLineType } from './telnyx.types';
import { LineType } from '@ai-sdr/database';

const CALLABLE_LINE_TYPES: TelnyxLineType[] = ['landline'];
const EMAIL_ONLY_LINE_TYPES: TelnyxLineType[] = ['mobile', 'voip'];

export interface PhoneLookupResult {
  phoneNumber: string;
  lineType: LineType;
  isCallable: boolean;
  isEmailOnly: boolean;
  isDead: boolean;
  carrierName: string | null;
  isValid: boolean;
  fraudRiskScore: number | null;
  rawLineType: TelnyxLineType;
}

export class TelnyxLookupClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;

  constructor(apiKey: string, baseUrl: string, logger: Logger) {
    this.logger = logger.child({ module: 'TelnyxLookupClient' });
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async lookupPhone(phoneNumber: string): Promise<PhoneLookupResult> {
    const normalized = this.normalizePhone(phoneNumber);

    try {
      const response = await this.http.get<TelnyxPhoneLookupResponse>(
        `/phone_numbers/${encodeURIComponent(normalized)}`,
        {
          params: {
            type: 'carrier,caller-name,fraud',
          },
        }
      );

      const data = response.data.data;
      const rawLineType = data.line_type;
      const lineType = this.mapLineType(rawLineType);
      const fraudScore = data.fraud?.risk_score ?? null;

      const isCallable =
        data.valid &&
        CALLABLE_LINE_TYPES.includes(rawLineType) &&
        (fraudScore === null || fraudScore < 70);

      const isEmailOnly =
        data.valid && EMAIL_ONLY_LINE_TYPES.includes(rawLineType);

      const isDead = !data.valid;

      this.logger.debug({ phoneNumber: normalized, rawLineType, isCallable }, 'Phone lookup complete');

      return {
        phoneNumber: normalized,
        lineType,
        isCallable,
        isEmailOnly,
        isDead,
        carrierName: data.carrier?.name ?? null,
        isValid: data.valid,
        fraudRiskScore: fraudScore,
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

  private mapLineType(telnyxType: TelnyxLineType): LineType {
    const map: Record<TelnyxLineType, LineType> = {
      landline: 'landline',
      mobile: 'mobile',
      voip: 'voip',
      toll_free: 'toll_free',
      premium_rate: 'premium',
      shared_cost: 'unknown',
      personal_number: 'mobile',
      pager: 'unknown',
      uan: 'unknown',
      voicemail: 'unknown',
      unknown: 'unknown',
    };
    return map[telnyxType] ?? 'unknown';
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
