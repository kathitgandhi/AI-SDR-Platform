import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';
import {
  ZoomInfoAuthResponse,
  ZoomInfoCompany,
  ZoomInfoContact,
  ZoomInfoCompanySearchParams,
  ZoomInfoContactSearchParams,
  ZoomInfoSearchResponse,
  IcpFilter,
  DEFAULT_ICP_FILTER,
} from './zoominfo.types';

interface ZoomInfoClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  rateLimitRpm: number;
  logger: Logger;
}

export class ZoomInfoClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;
  private readonly rateLimitRpm: number;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private requestCount = 0;
  private requestWindowStart = Date.now();

  constructor(private readonly config: ZoomInfoClientConfig) {
    this.logger = config.logger.child({ module: 'ZoomInfoClient' });
    this.rateLimitRpm = config.rateLimitRpm;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async authenticate(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiresAt) return;

    try {
      const response = await axios.post<ZoomInfoAuthResponse>(
        'https://api.zoominfo.com/authenticate',
        {
          username: this.config.clientId,
          password: this.config.clientSecret,
        },
        { timeout: 10000 }
      );
      this.token = response.data.jwt;
      this.tokenExpiresAt = Date.now() + (response.data.expiresIn - 60) * 1000;
      this.http.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
      this.logger.info('ZoomInfo authentication successful');
    } catch (error) {
      this.logger.error({ error }, 'ZoomInfo authentication failed');
      throw new Error('ZoomInfo authentication failed');
    }
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.requestWindowStart;

    if (elapsed >= 60000) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    if (this.requestCount >= this.rateLimitRpm) {
      const waitMs = 60000 - elapsed;
      this.logger.debug({ waitMs }, 'ZoomInfo rate limit pause');
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.requestCount = 0;
      this.requestWindowStart = Date.now();
    }

    this.requestCount++;
  }

  async searchCompanies(
    params: ZoomInfoCompanySearchParams
  ): Promise<ZoomInfoSearchResponse<ZoomInfoCompany>> {
    await this.authenticate();
    await this.enforceRateLimit();

    try {
      const response = await this.http.post<ZoomInfoSearchResponse<ZoomInfoCompany>>(
        '/company/search',
        {
          ...params,
          outputFields: [
            'id', 'name', 'website', 'domainList', 'phone', 'street', 'city', 'state',
            'zipCode', 'country', 'employeeCount', 'revenue', 'revenueRange',
            'employeeRange', 'industryKeywords', 'companyType', 'description',
            'techAttributeList', 'linkedInUrl',
          ],
        }
      );
      return response.data;
    } catch (error) {
      this.logger.error({ error, params }, 'ZoomInfo company search failed');
      throw error;
    }
  }

  async searchContacts(
    params: ZoomInfoContactSearchParams
  ): Promise<ZoomInfoSearchResponse<ZoomInfoContact>> {
    await this.authenticate();
    await this.enforceRateLimit();

    try {
      const response = await this.http.post<ZoomInfoSearchResponse<ZoomInfoContact>>(
        '/contact/search',
        {
          ...params,
          outputFields: [
            'id', 'firstName', 'lastName', 'email', 'phone', 'mobilePhone',
            'directPhoneDoNotCall', 'mobilePhoneDoNotCall', 'jobTitle',
            'jobFunction', 'managementLevel', 'department', 'companyId',
            'companyName', 'companyWebsite', 'linkedInUrl', 'hasEmail', 'hasPhone',
          ],
        }
      );
      return response.data;
    } catch (error) {
      this.logger.error({ error, params }, 'ZoomInfo contact search failed');
      throw error;
    }
  }

  async pullIcpLeads(
    filter: IcpFilter = DEFAULT_ICP_FILTER,
    pageNum = 1,
    pageSize = 100
  ): Promise<{ companies: ZoomInfoCompany[]; contacts: ZoomInfoContact[]; totalPages: number }> {
    const companyResults = await this.searchCompanies({
      industryKeywords: filter.targetIndustries,
      employeeCountRanges: [
        { minEmployee: filter.minEmployees, maxEmployee: filter.maxEmployees },
      ],
      locationCountries: filter.targetCountries,
      ...(filter.targetStates.length > 0 ? { locationStates: filter.targetStates } : {}),
      pageNum,
      pageSize,
    });

    const companies = companyResults.data;
    const contactPromises = companies.slice(0, 10).map((company) =>
      this.searchContacts({
        companyId: company.id,
        titles: filter.targetTitles,
        managementLevels: filter.targetManagementLevels,
        departments: filter.targetDepartments,
        pageNum: 1,
        pageSize: 5,
      }).then((r) => r.data).catch(() => [] as ZoomInfoContact[])
    );

    const contactResults = await Promise.all(contactPromises);
    const contacts = contactResults.flat();
    const totalPages = Math.ceil(companyResults.totalResults / pageSize);

    this.logger.info(
      { companies: companies.length, contacts: contacts.length, totalPages },
      'ZoomInfo ICP pull complete'
    );

    return { companies, contacts, totalPages };
  }
}
