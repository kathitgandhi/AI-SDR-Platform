import { Worker, Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Logger } from 'pino';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  ZoomInfoClient,
  ZoomInfoCompany,
  ZoomInfoContact,
  IcpFilter,
  DEFAULT_ICP_FILTER,
} from '@ai-sdr/integrations';
import {
  LeadImportJobPayload,
  EnrichmentJobPayload,
  QUEUE_NAMES,
} from '../queues/queue.registry';

interface LeadImportDeps {
  supabase: SupabaseClient;
  zoomInfoClient: ZoomInfoClient;
  enrichmentQueue: Queue;
  leadImportQueue: Queue;
  connection: Redis;
  logger: Logger;
}

export function createLeadImportWorker(deps: LeadImportDeps): Worker {
  const { supabase, zoomInfoClient, enrichmentQueue, leadImportQueue, connection, logger } = deps;
  const workerLogger = logger.child({ worker: 'lead-import' });

  return new Worker<LeadImportJobPayload>(
    QUEUE_NAMES.LEAD_IMPORT,
    async (job: Job<LeadImportJobPayload>) => {
      const { campaignId, page, pageSize, filter } = job.data;
      const jobLogger = workerLogger.child({ jobId: job.id, campaignId, page });

      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('id, name, target_verticals, target_titles, target_states, target_min_employees')
        .eq('id', campaignId)
        .single();

      if (campaignError || !campaign) {
        throw new Error(`Campaign ${campaignId} not found: ${campaignError?.message}`);
      }

      const icpFilter = buildIcpFilter(campaign, filter);

      jobLogger.info({ page, pageSize }, 'Pulling ZoomInfo leads');
      const { companies, contacts, totalPages } = await zoomInfoClient.pullIcpLeads(
        icpFilter,
        page,
        pageSize,
      );
      jobLogger.info({ companies: companies.length, contacts: contacts.length, totalPages }, 'ZoomInfo pull complete');

      const companyMap = new Map<number, { supabaseId: string; domain: string; website: string }>();

      for (const company of companies) {
        const supabaseId = await upsertCompany(supabase, company, jobLogger);
        if (supabaseId) {
          companyMap.set(company.id, {
            supabaseId,
            domain: company.domainList?.[0] ?? '',
            website: company.website ?? '',
          });
        }
      }

      let newLeads = 0;
      for (const contact of contacts) {
        const companyEntry = companyMap.get(contact.companyId);
        if (!companyEntry) continue;

        const contactId = await upsertContact(supabase, contact, companyEntry.supabaseId, jobLogger);
        if (!contactId) continue;

        const leadId = await createLeadIfNew(
          supabase,
          contactId,
          companyEntry.supabaseId,
          campaignId,
          jobLogger,
        );
        if (leadId) {
          newLeads++;
          await enrichmentQueue.add(
            'enrich-lead',
            {
              companyId: companyEntry.supabaseId,
              leadId,
              domain: companyEntry.domain,
              website: companyEntry.website,
            } satisfies EnrichmentJobPayload,
            { jobId: `enrich-${leadId}`, attempts: 3 },
          );
        }
      }

      if (page < totalPages) {
        await leadImportQueue.add(
          'import-leads',
          { campaignId, page: page + 1, pageSize, filter },
          { attempts: 2 },
        );
        jobLogger.info({ nextPage: page + 1, totalPages }, 'Queued next page');
      }

      jobLogger.info({ newLeads, page, totalPages }, 'Lead import job complete');
      return { newLeads, page, totalPages };
    },
    { connection, concurrency: 2 },
  );
}

function buildIcpFilter(
  campaign: {
    target_verticals?: string[] | null;
    target_titles?: string[] | null;
    target_states?: string[] | null;
    target_min_employees?: number | null;
  },
  filterOverride?: Record<string, unknown>,
): IcpFilter {
  const filter: IcpFilter = { ...DEFAULT_ICP_FILTER };

  if (campaign.target_titles?.length) {
    filter.targetTitles = campaign.target_titles;
  }
  if (campaign.target_states?.length) {
    filter.targetStates = campaign.target_states;
  }
  if (campaign.target_min_employees) {
    filter.minEmployees = campaign.target_min_employees;
  }
  if (campaign.target_verticals?.length) {
    filter.targetIndustries = mapVerticalsToIndustries(campaign.target_verticals);
  }

  return { ...filter, ...(filterOverride as Partial<IcpFilter> ?? {}) };
}

const VERTICAL_TO_INDUSTRIES: Record<string, string[]> = {
  grocery: ['Grocery Stores', 'Food & Beverage'],
  general_retail: ['Retail', 'Specialty Retail'],
  wholesale_distribution: ['Wholesale', 'Distribution'],
  automotive_retail: ['Automotive Parts Retail'],
  electronics: ['Consumer Electronics'],
  specialty: ['Specialty Retail'],
  cpg_operator: ['Food & Beverage'],
  pharmacy: ['Pharmacy'],
  convenience: ['Convenience Stores'],
  home_improvement: ['Home Improvement'],
  fashion_apparel: ['Fashion Retail'],
  furniture: ['Furniture Retail'],
};

function mapVerticalsToIndustries(verticals: string[]): string[] {
  const industries = new Set<string>();
  for (const v of verticals) {
    for (const ind of (VERTICAL_TO_INDUSTRIES[v] ?? [])) industries.add(ind);
  }
  return industries.size > 0 ? Array.from(industries) : DEFAULT_ICP_FILTER.targetIndustries;
}

async function upsertCompany(
  supabase: SupabaseClient,
  company: ZoomInfoCompany,
  logger: Logger,
): Promise<string | null> {
  const tech = company.techAttributeList ?? [];

  const findVendor = (pattern: RegExp) =>
    tech.find(t => pattern.test(`${t.categoryName} ${t.product}`))?.vendor ?? null;

  const { data, error } = await supabase
    .from('companies')
    .upsert(
      {
        name: company.name,
        website: company.website || null,
        domain: company.domainList?.[0] || null,
        industry: company.industryKeywords?.[0] || null,
        employee_count: company.employeeCount || null,
        annual_revenue: company.revenue || null,
        headquarters_city: company.city || null,
        headquarters_state: company.state || null,
        headquarters_country: company.country || 'US',
        description: company.description || null,
        zoominfo_company_id: String(company.id),
        has_pos: tech.some(t => /pos|point.of.sale/i.test(t.categoryName)),
        pos_vendor: findVendor(/pos|point.of.sale/i),
        has_esl: tech.some(t => /esl|electronic.shelf.label/i.test(`${t.categoryName} ${t.product}`)),
        esl_vendor: findVendor(/esl|electronic.shelf.label/i),
        has_erp: tech.some(t => /erp|enterprise.resource/i.test(t.categoryName)),
        erp_vendor: findVendor(/erp|enterprise.resource/i),
        has_wms: tech.some(t => /wms|warehouse.management/i.test(t.categoryName)),
        wms_vendor: findVendor(/wms|warehouse.management/i),
        enrichment_source: 'zoominfo',
        enriched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'zoominfo_company_id', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) {
    logger.warn({ error: error.message, companyName: company.name }, 'Company upsert failed');
    return null;
  }
  return data.id;
}

async function upsertContact(
  supabase: SupabaseClient,
  contact: ZoomInfoContact,
  companyId: string,
  logger: Logger,
): Promise<string | null> {
  if (!contact.firstName) return null;

  const isDm = /vp|vice.president|director|c-level|chief|president|coo|cio|cto|svp/i.test(
    `${contact.managementLevel ?? ''} ${contact.jobTitle ?? ''}`,
  );

  const { data, error } = await supabase
    .from('contacts')
    .upsert(
      {
        company_id: companyId,
        first_name: contact.firstName,
        last_name: contact.lastName || null,
        title: contact.jobTitle || null,
        department: contact.department || null,
        seniority: contact.managementLevel || null,
        email: contact.email || null,
        email_valid: contact.hasEmail,
        phone_direct: contact.phone || null,
        phone_mobile: contact.mobilePhone || null,
        linkedin_url: contact.linkedInUrl || null,
        is_decision_maker: isDm,
        call_opted_out: contact.directPhoneDoNotCall || false,
        zoominfo_contact_id: String(contact.id),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'zoominfo_contact_id', ignoreDuplicates: false },
    )
    .select('id')
    .single();

  if (error) {
    logger.warn(
      { error: error.message, name: `${contact.firstName} ${contact.lastName}` },
      'Contact upsert failed',
    );
    return null;
  }
  return data.id;
}

async function createLeadIfNew(
  supabase: SupabaseClient,
  contactId: string,
  companyId: string,
  campaignId: string,
  logger: Logger,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('contact_id', contactId)
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (existing) return null;

  const { data, error } = await supabase
    .from('leads')
    .insert({
      contact_id: contactId,
      company_id: companyId,
      campaign_id: campaignId,
      stage: 'new',
      source: 'zoominfo',
      imported_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    logger.warn({ error: error.message, contactId, campaignId }, 'Lead creation failed');
    return null;
  }
  return data.id;
}
