import axios, { AxiosInstance } from 'axios';
import { ICrmAdapter, CrmContact, CrmDeal, CrmNote } from '../crm.interface';

export class HubSpotAdapter implements ICrmAdapter {
  private readonly http: AxiosInstance;

  constructor(config: Record<string, string>) {
    this.http = axios.create({
      baseURL: 'https://api.hubapi.com',
      headers: { Authorization: `Bearer ${config['HUBSPOT_ACCESS_TOKEN']}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  }

  async createOrUpdateContact(contact: CrmContact): Promise<string> {
    const properties = {
      firstname: contact.firstName,
      lastname: contact.lastName,
      email: contact.email,
      phone: contact.phone,
      jobtitle: contact.title,
      company: contact.companyName,
      hs_lead_status: 'IN_PROGRESS',
      lead_source: contact.source ?? 'AI_SDR',
    };

    // Search for existing
    if (contact.email) {
      const search = await this.http.post('/crm/v3/objects/contacts/search', {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: contact.email }] }],
      });
      const existing = search.data.results?.[0];
      if (existing) {
        await this.http.patch(`/crm/v3/objects/contacts/${existing.id}`, { properties });
        return existing.id;
      }
    }

    const response = await this.http.post('/crm/v3/objects/contacts', { properties });
    return response.data.id;
  }

  async createOrUpdateCompany(company: { name: string; domain?: string; industry?: string; employeeCount?: number; storeCount?: number }): Promise<string> {
    const properties = {
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      numberofemployees: company.employeeCount,
      store_count__c: company.storeCount,
    };

    if (company.domain) {
      const search = await this.http.post('/crm/v3/objects/companies/search', {
        filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: company.domain }] }],
      });
      const existing = search.data.results?.[0];
      if (existing) {
        await this.http.patch(`/crm/v3/objects/companies/${existing.id}`, { properties });
        return existing.id;
      }
    }

    const response = await this.http.post('/crm/v3/objects/companies', { properties });
    return response.data.id;
  }

  async createDeal(deal: CrmDeal): Promise<string> {
    const response = await this.http.post('/crm/v3/objects/deals', {
      properties: {
        dealname: deal.name,
        dealstage: deal.stage,
        amount: deal.amount,
        closedate: deal.closeDate,
        pipeline: 'default',
      },
      associations: [
        { to: { id: deal.contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] },
        ...(deal.companyId ? [{ to: { id: deal.companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }] }] : []),
      ],
    });
    return response.data.id;
  }

  async updateDealStage(dealId: string, stage: string): Promise<void> {
    await this.http.patch(`/crm/v3/objects/deals/${dealId}`, { properties: { dealstage: stage } });
  }

  async addNote(note: CrmNote): Promise<void> {
    await this.http.post('/crm/v3/objects/notes', {
      properties: { hs_note_body: note.body, hs_timestamp: note.timestamp ?? new Date().toISOString() },
      associations: [{
        to: { id: note.entityId },
        types: [{
          associationCategory: 'HUBSPOT_DEFINED',
          associationTypeId: note.entityType === 'contact' ? 1 : note.entityType === 'company' ? 2 : 3,
        }],
      }],
    });
  }

  async bookMeeting(params: { contactId: string; title: string; startTime: string; endTime: string; description?: string }): Promise<string> {
    const response = await this.http.post('/crm/v3/objects/meetings', {
      properties: {
        hs_meeting_title: params.title,
        hs_meeting_start_time: params.startTime,
        hs_meeting_end_time: params.endTime,
        hs_meeting_body: params.description,
        hs_meeting_outcome: 'SCHEDULED',
      },
      associations: [{
        to: { id: params.contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 200 }],
      }],
    });
    return response.data.id;
  }
}
