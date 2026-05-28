/**
 * AirDesk360 CRM adapter — REAL implementation against the Manage-Leads-Pro
 * style REST API (apidoc at https://airdesk360.com/apiguide/index.html).
 *
 * Key API quirks vs typical REST:
 *  - Auth header is literally `authtoken: <RAW_KEY>` (no Bearer, no base64).
 *  - Request bodies are application/x-www-form-urlencoded (not JSON).
 *  - Mutations return `{ status: bool, message: string, error?: object }`.
 *  - GETs return naked objects/arrays (no `data` wrapper).
 *  - DELETE paths use `api/delete/<resource>/:id` (note the `delete/` prefix).
 *  - Contacts live UNDER a customer: `customer_id` is required.
 *  - No `/notes` or `/calls` endpoints — we model those as `tasks` with rel_type.
 *
 * Requires (`config`):
 *   - AIRDESK360_BASE_URL (e.g. https://airbs.airdesk360.com)
 *   - AIRDESK360_API_KEY  (tenant authtoken)
 */
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import qs from 'querystring';
import { ICrmAdapter, CrmContact, CrmDeal, CrmNote } from '../crm.interface';

interface MutationResponse {
  status: boolean;
  message?: string;
  error?: Record<string, string>;
  // Some POSTs include the inserted row id:
  data?: { id?: string | number } | string | number;
  id?: string | number;
}

export interface AirDeskTicketParams {
  subject: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  contactId?: string | number;
  customerId?: string | number;
  department?: string | number;
  userId?: string | number;
}

export interface AirDeskTaskParams {
  name: string;
  description?: string;
  rel_type: 'lead' | 'customer' | 'project' | 'ticket';
  rel_id: string | number;
  startdate?: string;
  duedate?: string;
  priority?: number;
}

export class AirDesk360Adapter implements ICrmAdapter {
  private readonly http: AxiosInstance;
  private readonly defaultUserId: string;
  private readonly defaultDepartmentId: string;

  constructor(config: Record<string, string>) {
    const baseUrl = (config['AIRDESK360_BASE_URL'] ?? '').replace(/\/+$/, '');
    const apiKey = config['AIRDESK360_API_KEY'] ?? '';
    this.defaultUserId = config['AIRDESK360_DEFAULT_USER_ID'] ?? '1';
    this.defaultDepartmentId = config['AIRDESK360_DEFAULT_DEPARTMENT_ID'] ?? '1';

    if (!baseUrl) throw new Error('AIRDESK360_BASE_URL required');
    if (!apiKey) throw new Error('AIRDESK360_API_KEY required');

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 20000,
      headers: { authtoken: apiKey },
      validateStatus: (s) => s < 500, // we want to inspect 4xx ourselves
    });
  }

  // -----------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------

  private async post<T = MutationResponse>(path: string, body: Record<string, unknown>): Promise<AxiosResponse<T>> {
    const cleaned = Object.fromEntries(
      Object.entries(body).filter(([_, v]) => v !== undefined && v !== null && v !== ''),
    );
    return this.http.post<T>(path, qs.stringify(cleaned as any), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  private async put<T = MutationResponse>(path: string, body: Record<string, unknown>): Promise<AxiosResponse<T>> {
    const cleaned = Object.fromEntries(
      Object.entries(body).filter(([_, v]) => v !== undefined && v !== null && v !== ''),
    );
    return this.http.put<T>(path, qs.stringify(cleaned as any), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  private extractId(resp: MutationResponse): string {
    if (resp.id != null) return String(resp.id);
    if (resp.data && typeof resp.data === 'object' && (resp.data as { id?: string | number }).id != null) {
      return String((resp.data as { id: string | number }).id);
    }
    // AirDesk often returns just `{status:true, message:"Added..."}` with no id.
    // Caller can search by unique field (email/phone) to re-discover the id.
    return '';
  }

  // -----------------------------------------------------------------
  // ICrmAdapter implementation
  // -----------------------------------------------------------------

  /** Our "company" ↔ AirDesk360 "customer". Customer ID field is `userid`. */
  async createOrUpdateCompany(company: {
    name: string; domain?: string; industry?: string;
    employeeCount?: number; storeCount?: number;
  }): Promise<string> {
    const existingId = await this.findCustomerIdByName(company.name);
    if (existingId) {
      await this.put(`/api/customers/${existingId}`, this.mapCompany(company));
      return existingId;
    }

    const res = await this.post(`/api/customers`, this.mapCompany(company));
    if (!res.data?.status) {
      throw new Error(`AirDesk360 createCustomer failed: ${res.data?.message ?? res.status}`);
    }

    // POST returns {status:true, message:"Added"} with no id — search to find it
    const newId = await this.findCustomerIdByName(company.name);
    if (!newId) {
      throw new Error(`AirDesk360 customer was created but ID could not be resolved by search for "${company.name}"`);
    }
    return newId;
  }

  private async findCustomerIdByName(name: string): Promise<string | null> {
    if (!name) return null;
    try {
      // AirDesk search is broad — pull all matches and find the closest by name equality
      const search = await this.http.get(`/api/customers/search/${encodeURIComponent(name)}`);
      if (!Array.isArray(search.data)) return null;
      type Row = { userid?: string; id?: string; company?: string; datecreated?: string };
      const rows = search.data as Row[];

      // Prefer exact (trimmed, case-insensitive) match. Fall back to newest match.
      const wanted = name.trim().toLowerCase();
      const exact = rows.find((r) => (r.company ?? '').trim().toLowerCase() === wanted);
      const pick = exact ?? rows.sort((a, b) =>
        (b.datecreated ?? '').localeCompare(a.datecreated ?? ''),
      )[0];
      return pick ? String(pick.userid ?? pick.id ?? '') || null : null;
    } catch {
      return null;
    }
  }

  /** Our "contact" ↔ AirDesk360 "contact" (nested under customer) */
  async createOrUpdateContact(contact: CrmContact): Promise<string> {
    if (!contact.companyId) {
      throw new Error('AirDesk360 contacts require companyId (maps to customer_id)');
    }

    // Look for existing contact by email under this customer
    const existing = contact.email
      ? await this.findContactIdByEmail(String(contact.companyId), contact.email)
      : null;
    if (existing) {
      await this.put(`/api/contacts/${existing}`, this.mapContact(contact));
      return existing;
    }

    const res = await this.post(`/api/contacts/`, this.mapContact(contact));
    if (!res.data?.status) {
      const errMsg = res.data?.error ? JSON.stringify(res.data.error) : res.data?.message ?? `HTTP ${res.status}`;
      throw new Error(`AirDesk360 createContact failed: ${errMsg}`);
    }

    if (contact.email) {
      const newId = await this.findContactIdByEmail(String(contact.companyId), contact.email);
      if (newId) return newId;
    }
    return ''; // created but ID unresolved
  }

  private async findContactIdByEmail(customerId: string, email: string): Promise<string | null> {
    try {
      // GET /api/contacts/{customer_id} → list contacts for that customer
      const res = await this.http.get(`/api/contacts/${encodeURIComponent(customerId)}`);
      if (!Array.isArray(res.data)) return null;
      type Row = { id?: string; email?: string };
      const wanted = email.trim().toLowerCase();
      const match = (res.data as Row[]).find((r) => (r.email ?? '').trim().toLowerCase() === wanted);
      return match?.id ? String(match.id) : null;
    } catch {
      return null;
    }
  }

  /**
   * AirDesk360 has no "deals" entity. The closest analog is **Lead** which has a
   * status/source/assigned flow. Map our Deal → AirDesk360 Lead.
   */
  async createDeal(deal: CrmDeal): Promise<string> {
    const body: Record<string, unknown> = {
      name: deal.name,
      source: 1, // AirDesk source IDs — '1' is usually "Other". Configurable per tenant.
      status: 1, // AirDesk status IDs — '1' is usually "New". Configurable.
      assigned: this.defaultUserId,
      client_id: deal.companyId,
      description: deal.notes,
    };
    const res = await this.post(`/api/leads`, body);
    if (!res.data?.status) {
      throw new Error(`AirDesk360 createLead failed: ${res.data?.message ?? res.status}`);
    }
    // Lead create doesn't return the ID either — search by name to recover it
    const newId = await this.findLeadIdByName(deal.name);
    return newId ?? '';
  }

  private async findLeadIdByName(name: string): Promise<string | null> {
    if (!name) return null;
    try {
      const res = await this.http.get(`/api/leads/search/${encodeURIComponent(name)}`);
      if (!Array.isArray(res.data)) return null;
      type Row = { id?: string; name?: string; dateadded?: string; datecreated?: string };
      const wanted = name.trim().toLowerCase();
      const rows = res.data as Row[];
      const exact = rows.find((r) => (r.name ?? '').trim().toLowerCase() === wanted);
      const pick = exact ?? rows.sort((a, b) =>
        (b.dateadded ?? b.datecreated ?? '').localeCompare(a.dateadded ?? a.datecreated ?? ''),
      )[0];
      return pick?.id ? String(pick.id) : null;
    } catch {
      return null;
    }
  }

  /** No status enum mapping in AirDesk360 — depends on tenant's configured lead statuses. */
  async updateDealStage(dealId: string, stage: string): Promise<void> {
    // Tenant-specific: `stage` would need to be a numeric status ID.
    // For now we just write it to `description` so the change is visible.
    await this.put(`/api/leads/${dealId}`, { description: `Stage updated to: ${stage}` });
  }

  /** No /notes endpoint — model as a Task with description. */
  async addNote(note: CrmNote): Promise<void> {
    const relTypeMap: Record<CrmNote['entityType'], 'customer' | 'lead' | 'project'> = {
      contact: 'customer', // contacts are nested under customer; attach to that
      company: 'customer',
      deal: 'lead',
    };
    const body: Record<string, unknown> = {
      name: note.body.slice(0, 100),
      description: note.body,
      rel_type: relTypeMap[note.entityType],
      rel_id: note.entityId,
      startdate: new Date(note.timestamp ?? Date.now()).toISOString().slice(0, 10),
    };
    await this.post(`/api/tasks`, body);
  }

  /** Calendar event surrogate for meetings */
  async bookMeeting(params: {
    contactId: string; title: string; startTime: string; endTime: string; description?: string;
  }): Promise<string> {
    const body = {
      title: params.title,
      description: params.description ?? '',
      start: params.startTime,
      reminder_before_type: 'minutes',
      reminder_before: 30,
      color: '#2196F3',
      userid: this.defaultUserId,
      isstartnotified: 0,
      public: 1,
    };
    const res = await this.post(`/api/calendar/`, body);
    if (!res.data?.status) {
      throw new Error(`AirDesk360 createCalendar failed: ${res.data?.message ?? res.status}`);
    }
    return this.extractId(res.data);
  }

  /** Create a support ticket. Beyond ICrmAdapter — call directly. */
  async createTicket(params: AirDeskTicketParams): Promise<string> {
    if (!params.contactId) throw new Error('AirDesk360 ticket requires contactId');

    const body: Record<string, unknown> = {
      subject: params.subject,
      department: params.department ?? this.defaultDepartmentId,
      contactid: params.contactId,           // note: no underscore (AirDesk quirk)
      userid: params.userId ?? this.defaultUserId,
      priority: this.mapTicketPriority(params.priority),
      message: params.description ?? '',
    };
    const res = await this.post(`/api/tickets`, body);
    if (!res.data?.status) {
      throw new Error(`AirDesk360 createTicket failed: ${res.data?.message ?? res.status}`);
    }
    return this.extractId(res.data);
  }

  /** Smoke-test the connection (used by /api/v1/crm/health). */
  async ping(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.http.get(`/api/customers`);
      if (res.status === 401 || (res.data as any)?.status === false) {
        return { ok: false, detail: (res.data as any)?.message ?? `HTTP ${res.status}` };
      }
      return { ok: true, detail: `Connected. Returned ${Array.isArray(res.data) ? res.data.length : 0} customers.` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }

  // -----------------------------------------------------------------
  // Field mapping
  // -----------------------------------------------------------------

  private mapCompany(c: { name: string; domain?: string; employeeCount?: number; storeCount?: number }): Record<string, unknown> {
    return {
      company: c.name,
      website: c.domain,
      // Defaults required by some Perfex-style schemas
      default_language: 'english',
      default_currency: 1,
    };
  }

  private mapContact(c: CrmContact): Record<string, unknown> {
    const [first, ...rest] = (c.firstName ?? '').split(' ');
    return {
      customer_id: c.companyId,
      firstname: first ?? c.firstName,
      lastname: c.lastName ?? rest.join(' ') ?? '',
      email: c.email,
      phonenumber: c.phone,
      title: c.title,
      is_primary: 'on',
      donotsendwelcomeemail: 'on',
    };
  }

  private mapTicketPriority(p?: 'low' | 'medium' | 'high' | 'urgent'): number {
    // AirDesk priority IDs (Perfex defaults): 1=Low, 2=Medium, 3=High, 4=Urgent
    switch (p) {
      case 'low': return 1;
      case 'high': return 3;
      case 'urgent': return 4;
      case 'medium':
      default: return 2;
    }
  }
}
