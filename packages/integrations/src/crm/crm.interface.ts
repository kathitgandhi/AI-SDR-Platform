export interface CrmContact {
  id?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  companyName?: string;
  companyId?: string;
  source?: string;
  notes?: string;
}

export interface CrmDeal {
  id?: string;
  contactId: string;
  companyId?: string;
  name: string;
  stage: string;
  amount?: number;
  closeDate?: string;
  notes?: string;
  customProperties?: Record<string, string | number | boolean>;
}

export interface CrmNote {
  entityId: string;
  entityType: 'contact' | 'company' | 'deal';
  body: string;
  timestamp?: string;
}

export interface ICrmAdapter {
  createOrUpdateContact(contact: CrmContact): Promise<string>;
  createOrUpdateCompany(company: {
    name: string;
    domain?: string;
    industry?: string;
    employeeCount?: number;
    storeCount?: number;
  }): Promise<string>;
  createDeal(deal: CrmDeal): Promise<string>;
  updateDealStage(dealId: string, stage: string): Promise<void>;
  addNote(note: CrmNote): Promise<void>;
  bookMeeting(params: {
    contactId: string;
    title: string;
    startTime: string;
    endTime: string;
    description?: string;
  }): Promise<string>;
}

export class NullCrmAdapter implements ICrmAdapter {
  async createOrUpdateContact(): Promise<string> { return 'noop'; }
  async createOrUpdateCompany(): Promise<string> { return 'noop'; }
  async createDeal(): Promise<string> { return 'noop'; }
  async updateDealStage(): Promise<void> { return; }
  async addNote(): Promise<void> { return; }
  async bookMeeting(): Promise<string> { return 'noop'; }
}

export function createCrmAdapter(provider: string, config: Record<string, string>): ICrmAdapter {
  switch (provider) {
    case 'hubspot':
      return new (require('./hubspot/hubspot.client').HubSpotAdapter)(config);
    case 'salesforce':
      return new (require('./salesforce/salesforce.client').SalesforceAdapter)(config);
    case 'pipedrive':
      return new (require('./pipedrive/pipedrive.client').PipedriveAdapter)(config);
    case 'zoho':
      return new (require('./zoho/zoho.client').ZohoAdapter)(config);
    default:
      return new NullCrmAdapter();
  }
}
