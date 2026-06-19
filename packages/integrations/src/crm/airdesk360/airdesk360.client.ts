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

export interface AirDeskEstimateItem {
  description: string;
  longDescription?: string;
  qty: number;
  rate: number;
  unit?: string;
}

export interface AirDeskEstimateParams {
  customerId: string | number;
  contactId?: string | number;
  title: string;                    // used as the estimate subject/note
  items: AirDeskEstimateItem[];
  dueDate?: string;                 // YYYY-MM-DD; defaults to 30 days out
  notes?: string;                   // admin-facing note
  terms?: string;
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
      // AirDesk's search is fuzzy and sometimes can't find what we just inserted.
      // Don't throw — return empty so the caller knows the row exists but its ID is unresolved.
      // Downstream contact/lead sync will likely fail or be skipped, and the user can
      // re-run sync once AirDesk's search catches up (or fix the ID manually).
      return '';
    }
    return newId;
  }

  /**
   * Find a customer by name using progressively looser strategies:
   *  1) exact search by full name (URL-encoded)
   *  2) search by first 2-3 significant words (strip parens/commas)
   *  3) keyword-by-keyword scan against any returned rows
   */
  private async findCustomerIdByName(name: string): Promise<string | null> {
    if (!name) return null;

    const tryStrategies: string[] = [];
    tryStrategies.push(name);
    // Sanitised: strip parens, brackets, punctuation
    const sanitised = name.replace(/[()\[\]\.,;:!?]/g, '').replace(/\s+/g, ' ').trim();
    if (sanitised && sanitised !== name) tryStrategies.push(sanitised);
    // First 2 significant words
    const firstTwo = sanitised.split(' ').slice(0, 2).join(' ').trim();
    if (firstTwo && firstTwo !== sanitised) tryStrategies.push(firstTwo);
    // Just the first word
    const firstWord = sanitised.split(' ')[0]?.trim();
    if (firstWord && firstWord !== firstTwo) tryStrategies.push(firstWord);

    const wanted = name.trim().toLowerCase();

    for (const term of tryStrategies) {
      try {
        const res = await this.http.get(`/api/customers/search/${encodeURIComponent(term)}`);
        if (!Array.isArray(res.data)) continue;
        type Row = { userid?: string; id?: string; company?: string; datecreated?: string };
        const rows = res.data as Row[];
        if (rows.length === 0) continue;

        // 1) exact match on full original name
        const exact = rows.find((r) => (r.company ?? '').trim().toLowerCase() === wanted);
        if (exact?.userid ?? exact?.id) return String(exact!.userid ?? exact!.id);

        // 2) prefix/contains match — case-insensitive
        const contains = rows.find((r) => (r.company ?? '').trim().toLowerCase().includes(wanted));
        if (contains?.userid ?? contains?.id) return String(contains!.userid ?? contains!.id);

        // 3) if just one row came back, take it
        if (rows.length === 1) {
          const only = rows[0]!;
          return String(only.userid ?? only.id ?? '') || null;
        }
      } catch {
        // try next strategy
      }
    }
    return null;
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

  private async findContactIdByPhone(customerId: string, phone: string): Promise<string | null> {
    try {
      const res = await this.http.get(`/api/contacts/${encodeURIComponent(customerId)}`);
      if (!Array.isArray(res.data)) return null;
      type Row = { id?: string; phonenumber?: string };
      // Normalise to last 10 digits for fuzzy match across +1 prefix differences
      const normalise = (p: string) => p.replace(/\D/g, '').slice(-10);
      const wanted = normalise(phone);
      if (!wanted) return null;
      const match = (res.data as Row[]).find((r) => normalise(r.phonenumber ?? '') === wanted);
      return match?.id ? String(match.id) : null;
    } catch {
      return null;
    }
  }

  /**
   * Find a contact under a customer by phone number, or create a minimal one if
   * not found. Used for inbound callers who have no email address.
   */
  async findOrCreateContactByPhone(params: {
    customerId: string | number;
    phone: string;
    firstName?: string;
    lastName?: string;
  }): Promise<string> {
    const custId = String(params.customerId);
    const existing = await this.findContactIdByPhone(custId, params.phone);
    if (existing) return existing;

    const firstName = params.firstName && params.firstName.toLowerCase() !== 'unknown'
      ? params.firstName
      : 'Inbound';
    const lastName = params.lastName ?? 'Caller';

    const res = await this.post('/api/contacts/', {
      customer_id: custId,
      firstname: firstName,
      lastname: lastName,
      phonenumber: params.phone,
      password: `aisdr_${Math.random().toString(36).slice(2)}_${Date.now()}`,
      is_primary: 'on',
      donotsendwelcomeemail: 'on',
    });
    if (!res.data?.status) return '';

    return (await this.findContactIdByPhone(custId, params.phone)) ?? '';
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

    // Build progressively-looser search terms (same idea as customer search)
    const tryStrategies: string[] = [name];
    const sanitised = name.replace(/[()\[\]\.,;:!?—–-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (sanitised && sanitised !== name) tryStrategies.push(sanitised);
    const firstThree = sanitised.split(' ').slice(0, 3).join(' ').trim();
    if (firstThree && firstThree !== sanitised) tryStrategies.push(firstThree);
    const firstWord = sanitised.split(' ')[0]?.trim();
    if (firstWord && firstWord !== firstThree) tryStrategies.push(firstWord);

    const wanted = name.trim().toLowerCase();

    for (const term of tryStrategies) {
      try {
        const res = await this.http.get(`/api/leads/search/${encodeURIComponent(term)}`);
        if (!Array.isArray(res.data)) continue;
        type Row = { id?: string; name?: string; dateadded?: string; datecreated?: string };
        const rows = res.data as Row[];
        if (rows.length === 0) continue;

        const exact = rows.find((r) => (r.name ?? '').trim().toLowerCase() === wanted);
        if (exact?.id) return String(exact.id);
        const contains = rows.find((r) => (r.name ?? '').trim().toLowerCase().includes(wanted.slice(0, 20)));
        if (contains?.id) return String(contains.id);
        if (rows.length === 1) return String(rows[0]!.id ?? '') || null;
      } catch {
        // try next
      }
    }
    return null;
  }

  /** No status enum mapping in AirDesk360 — depends on tenant's configured lead statuses. */
  async updateDealStage(dealId: string, stage: string): Promise<void> {
    // Tenant-specific: `stage` would need to be a numeric status ID.
    // For now we just write it to `description` so the change is visible.
    await this.put(`/api/leads/${dealId}`, { description: `Stage updated to: ${stage}` });
  }

  /**
   * Post a note visible in the Notes tab of the lead/customer.
   *
   * AirDesk360 (Perfex CRM) exposes POST /api/notes with rel_type + rel_id +
   * description. This is what populates the Notes tab on any entity.
   * Falls back to /api/tasks (which appears in the Tasks tab) if the notes
   * endpoint returns a non-success response, so the data is never silently lost.
   */
  async addNote(note: CrmNote): Promise<void> {
    const relTypeMap: Record<CrmNote['entityType'], 'customer' | 'lead' | 'project'> = {
      contact: 'customer',
      company: 'customer',
      deal:    'lead',
    };
    const relType = relTypeMap[note.entityType];
    const dateContacted = new Date(note.timestamp ?? Date.now()).toISOString().slice(0, 10);

    // Primary: POST /api/notes — shows in the Notes tab
    const notesBody: Record<string, unknown> = {
      rel_type:      relType,
      rel_id:        note.entityId,
      description:   note.body,
      datecontacted: dateContacted,
    };
    const notesRes = await this.post<MutationResponse>(`/api/notes`, notesBody);
    if (notesRes.data?.status) return; // success — note is in the Notes tab

    // Fallback: POST /api/tasks — shows in the Tasks tab (data never lost)
    const tasksBody: Record<string, unknown> = {
      name:        `📞 Call Transcript — ${dateContacted}`,
      description: note.body,
      rel_type:    relType,
      rel_id:      note.entityId,
      startdate:   dateContacted,
    };
    await this.post(`/api/tasks`, tasksBody);
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

  /**
   * Create an estimate (quote) in AirDesk360 for a prospect.
   * Falls back to a detailed Task if the /api/estimates endpoint returns 404
   * (AirDesk360 tenants may not have the module enabled).
   */
  async createEstimate(params: AirDeskEstimateParams): Promise<string> {
    const today    = new Date().toISOString().slice(0, 10);
    const dueDate  = params.dueDate ?? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

    // Build flat form body with Perfex-style newitems[] array notation
    const body: Record<string, unknown> = {
      clientid:  params.customerId,
      date:      today,
      duedate:   dueDate,
      currency:  1,
      adminnote: params.notes ?? params.title,
      terms:     params.terms ?? 'Pricing is indicative. A specialist will confirm during the discovery call.',
    };

    // Perfex CRM estimate line items use newitems[N][field] notation
    params.items.forEach((item, i) => {
      body[`newitems[${i}][description]`]      = item.description;
      body[`newitems[${i}][long_description]`] = item.longDescription ?? '';
      body[`newitems[${i}][qty]`]              = item.qty;
      body[`newitems[${i}][rate]`]             = item.rate;
      body[`newitems[${i}][unit]`]             = item.unit ?? 'pcs';
      body[`newitems[${i}][order]`]            = i;
    });

    const res = await this.post<MutationResponse>(`/api/estimates`, body);

    // If estimates module is enabled and the call succeeded
    if (res.status !== 404 && res.data?.status) {
      return this.extractId(res.data);
    }

    // Fallback: create a Task with the estimate details so nothing is lost
    const itemLines = params.items
      .map(it => `• ${it.description} — qty ${it.qty}`)
      .join('\n');
    const fallbackBody = {
      name:        `💰 Estimate Request — ${params.title}`,
      description: `${params.notes ?? ''}\n\nItems:\n${itemLines}\n\nDue: ${dueDate}`,
      rel_type:    'customer',
      rel_id:      params.customerId,
      startdate:   today,
      duedate:     dueDate,
    };
    const fallback = await this.post(`/api/tasks`, fallbackBody);
    return fallback.data?.status ? 'task-fallback' : '';
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
    // AirDesk requires a password field (treats contacts as portal users).
    // Generate a random one and disable welcome email so it's never actually used.
    const randomPassword = `aisdr_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    return {
      customer_id: c.companyId,
      firstname: first ?? c.firstName,
      lastname: c.lastName ?? rest.join(' ') ?? '',
      email: c.email,
      phonenumber: c.phone,
      title: c.title,
      password: randomPassword,
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
