import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { Logger } from 'pino';

export interface DncCheckResult {
  isOnDnc: boolean;
  reason?: string;
  source?: string;
  addedAt?: string;
}

export class DncChecker {
  private readonly supabase: SupabaseClient;
  private readonly logger: Logger;
  private readonly cache = new Map<string, { result: DncCheckResult; expiresAt: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(supabaseUrl: string, serviceRoleKey: string, logger: Logger) {
    this.supabase = createClient(supabaseUrl, serviceRoleKey);
    this.logger = logger.child({ module: 'DncChecker' });
  }

  async checkPhone(phone: string): Promise<DncCheckResult> {
    const normalized = this.normalizePhone(phone);
    const hash = this.hashValue(normalized);
    const cacheKey = `phone:${hash}`;

    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const { data, error } = await this.supabase
        .from('dnc_list')
        .select('source, added_reason, created_at, expires_at, is_permanent')
        .eq('phone_hash', hash)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const result: DncCheckResult = { isOnDnc: false };
        this.setCache(cacheKey, result);
        return result;
      }

      if (!data.is_permanent && data.expires_at && new Date(data.expires_at) < new Date()) {
        const result: DncCheckResult = { isOnDnc: false };
        this.setCache(cacheKey, result);
        return result;
      }

      const result: DncCheckResult = {
        isOnDnc: true,
        reason: data.added_reason ?? undefined,
        source: data.source,
        addedAt: data.created_at,
      };
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      this.logger.error({ error, hash }, 'DNC phone check failed — defaulting to blocked for safety');
      return { isOnDnc: true, reason: 'DNC check error — blocked for safety' };
    }
  }

  async checkEmail(email: string): Promise<DncCheckResult> {
    const normalized = email.toLowerCase().trim();
    const hash = this.hashValue(normalized);
    const cacheKey = `email:${hash}`;

    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const { data, error } = await this.supabase
        .from('dnc_list')
        .select('source, added_reason, created_at, expires_at, is_permanent')
        .eq('email_hash', hash)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const result: DncCheckResult = { isOnDnc: false };
        this.setCache(cacheKey, result);
        return result;
      }

      const result: DncCheckResult = {
        isOnDnc: true,
        reason: data.added_reason ?? undefined,
        source: data.source,
        addedAt: data.created_at,
      };
      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      this.logger.error({ error }, 'DNC email check failed');
      return { isOnDnc: true, reason: 'DNC check error — blocked for safety' };
    }
  }

  async addToPhoneDnc(params: {
    phone: string;
    source: string;
    reason?: string;
    contactId?: string;
    isPermanent?: boolean;
    expiresAt?: Date;
  }): Promise<void> {
    const normalized = this.normalizePhone(params.phone);
    await this.supabase.from('dnc_list').upsert({
      phone: normalized,
      source: params.source,
      added_reason: params.reason,
      contact_id: params.contactId,
      is_permanent: params.isPermanent ?? true,
      expires_at: params.expiresAt?.toISOString(),
    }, { onConflict: 'phone_hash' });

    this.logger.info({ phone: normalized, source: params.source }, 'Phone added to DNC');
    this.invalidateCacheForPhone(normalized);
  }

  async addToEmailDnc(params: {
    email: string;
    source: string;
    reason?: string;
    contactId?: string;
  }): Promise<void> {
    const normalized = params.email.toLowerCase().trim();
    await this.supabase.from('dnc_list').upsert({
      email: normalized,
      source: params.source,
      added_reason: params.reason,
      contact_id: params.contactId,
      is_permanent: true,
    }, { onConflict: 'email_hash' });

    this.logger.info({ email: normalized }, 'Email added to DNC');
    this.invalidateCacheForEmail(normalized);
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }

  private hashValue(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private getFromCache(key: string): DncCheckResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private setCache(key: string, result: DncCheckResult): void {
    this.cache.set(key, { result, expiresAt: Date.now() + this.cacheTtlMs });
  }

  private invalidateCacheForPhone(phone: string): void {
    const hash = this.hashValue(phone);
    this.cache.delete(`phone:${hash}`);
  }

  private invalidateCacheForEmail(email: string): void {
    const hash = this.hashValue(email);
    this.cache.delete(`email:${hash}`);
  }
}
