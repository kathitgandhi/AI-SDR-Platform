/**
 * AirDesk360 CRM adapter — STUB.
 *
 * The documented API at https://airdesk360.com/saas/api/docs is a platform
 * provisioning API (tenants, plans, subscriptions) — NOT a CRM data API.
 *
 * The actual CRM endpoints (contacts, deals, tickets, etc.) live on a
 * per-tenant URL like https://<tenant>.airdesk360.com/api/... and the user
 * needs to provide:
 *   - AIRDESK360_BASE_URL  (e.g. https://aisdr.airdesk360.com)
 *   - AIRDESK360_API_KEY   (tenant API key)
 *
 * Once those are confirmed, replace the TODO endpoint paths below with the
 * real ones from the tenant API docs.
 */
import axios, { AxiosInstance } from 'axios';
import { ICrmAdapter, CrmContact, CrmDeal, CrmNote } from '../crm.interface';

export class AirDesk360Adapter implements ICrmAdapter {
  private readonly http: AxiosInstance;
  private readonly verbose: boolean;

  constructor(config: Record<string, string>) {
    const baseUrl = config['AIRDESK360_BASE_URL'] ?? 'https://airdesk360.com';
    const apiKey = config['AIRDESK360_API_KEY'] ?? '';
    this.verbose = config['AIRDESK360_DEBUG'] === 'true';

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: {
        Authorization: apiKey, // AirDesk360 docs show api_key value sent in Authorization header
        'Content-Type': 'application/json',
      },
    });
  }

  private warn(method: string): void {
    if (this.verbose) {
      console.warn(`[AirDesk360Adapter.${method}] Endpoint not yet confirmed. Provide the tenant CRM API spec to enable this.`);
    }
  }

  /**
   * Create or update a CRM contact.
   * TODO: replace `/api/v1/contacts` with the actual tenant endpoint.
   */
  async createOrUpdateContact(contact: CrmContact): Promise<string> {
    this.warn('createOrUpdateContact');
    try {
      // Search by email first (typical pattern)
      if (contact.email) {
        const search = await this.http.get('/api/v1/contacts', {
          params: { email: contact.email },
        }).catch(() => null);
        const existing = search?.data?.data?.[0] ?? search?.data?.results?.[0];
        if (existing?.id) {
          await this.http.put(`/api/v1/contacts/${existing.id}`, this.mapContact(contact));
          return String(existing.id);
        }
      }
      const res = await this.http.post('/api/v1/contacts', this.mapContact(contact));
      return String(res.data?.id ?? res.data?.data?.id ?? 'unknown');
    } catch (err) {
      this.warn(`createOrUpdateContact failed: ${(err as Error).message}`);
      return 'error';
    }
  }

  async createOrUpdateCompany(company: {
    name: string; domain?: string; industry?: string;
    employeeCount?: number; storeCount?: number;
  }): Promise<string> {
    this.warn('createOrUpdateCompany');
    try {
      const res = await this.http.post('/api/v1/companies', {
        name: company.name,
        website: company.domain,
        industry: company.industry,
        employee_count: company.employeeCount,
        store_count: company.storeCount,
      });
      return String(res.data?.id ?? res.data?.data?.id ?? 'unknown');
    } catch (err) {
      this.warn(`createOrUpdateCompany failed: ${(err as Error).message}`);
      return 'error';
    }
  }

  async createDeal(deal: CrmDeal): Promise<string> {
    this.warn('createDeal');
    try {
      const res = await this.http.post('/api/v1/deals', {
        contact_id: deal.contactId,
        company_id: deal.companyId,
        name: deal.name,
        stage: deal.stage,
        amount: deal.amount,
        close_date: deal.closeDate,
        notes: deal.notes,
        custom: deal.customProperties,
      });
      return String(res.data?.id ?? res.data?.data?.id ?? 'unknown');
    } catch (err) {
      this.warn(`createDeal failed: ${(err as Error).message}`);
      return 'error';
    }
  }

  async updateDealStage(dealId: string, stage: string): Promise<void> {
    this.warn('updateDealStage');
    try {
      await this.http.put(`/api/v1/deals/${dealId}`, { stage });
    } catch (err) {
      this.warn(`updateDealStage failed: ${(err as Error).message}`);
    }
  }

  async addNote(note: CrmNote): Promise<void> {
    this.warn('addNote');
    try {
      await this.http.post('/api/v1/notes', {
        entity_type: note.entityType,
        entity_id: note.entityId,
        body: note.body,
        created_at: note.timestamp ?? new Date().toISOString(),
      });
    } catch (err) {
      this.warn(`addNote failed: ${(err as Error).message}`);
    }
  }

  async bookMeeting(params: {
    contactId: string; title: string; startTime: string; endTime: string; description?: string;
  }): Promise<string> {
    this.warn('bookMeeting');
    try {
      const res = await this.http.post('/api/v1/meetings', {
        contact_id: params.contactId,
        title: params.title,
        start_time: params.startTime,
        end_time: params.endTime,
        description: params.description,
      });
      return String(res.data?.id ?? res.data?.data?.id ?? 'unknown');
    } catch (err) {
      this.warn(`bookMeeting failed: ${(err as Error).message}`);
      return 'error';
    }
  }

  /**
   * Create a support ticket in AirDesk360.
   * Not part of ICrmAdapter (yet) — call directly from your ticketing flow.
   */
  async createTicket(params: {
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    contactId?: string;
    companyId?: string;
  }): Promise<string> {
    this.warn('createTicket');
    try {
      const res = await this.http.post('/api/v1/tickets', {
        subject: params.title,
        description: params.description,
        priority: params.priority ?? 'medium',
        contact_id: params.contactId,
        company_id: params.companyId,
      });
      return String(res.data?.id ?? res.data?.data?.id ?? 'unknown');
    } catch (err) {
      this.warn(`createTicket failed: ${(err as Error).message}`);
      return 'error';
    }
  }

  private mapContact(c: CrmContact): Record<string, unknown> {
    return {
      first_name: c.firstName,
      last_name: c.lastName,
      email: c.email,
      phone: c.phone,
      title: c.title,
      company_name: c.companyName,
      company_id: c.companyId,
      source: c.source ?? 'AI_SDR',
      notes: c.notes,
    };
  }
}
