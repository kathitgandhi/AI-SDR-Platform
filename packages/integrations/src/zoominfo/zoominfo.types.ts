export interface ZoomInfoAuthResponse {
  jwt: string;
  expiresIn: number;
}

export interface ZoomInfoCompanySearchParams {
  industryKeywords?: string[];
  sicCodes?: string[];
  naicsCodes?: string[];
  employeeCountRanges?: Array<{ minEmployee: number; maxEmployee: number }>;
  revenueRanges?: Array<{ minRevenue: number; maxRevenue: number }>;
  locationStates?: string[];
  locationCountries?: string[];
  companyTypes?: string[];
  pageNum?: number;
  pageSize?: number;
}

export interface ZoomInfoContactSearchParams {
  companyId?: number;
  titles?: string[];
  managementLevels?: string[];
  departments?: string[];
  industryKeywords?: string[];
  pageNum?: number;
  pageSize?: number;
}

export interface ZoomInfoCompany {
  id: number;
  name: string;
  website: string;
  domainList: string[];
  phone: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  employeeCount: number;
  revenue: number;
  revenueRange: string;
  employeeRange: string;
  sicCodes: string[];
  naicsCodes: string[];
  industryKeywords: string[];
  subIndustryCodes: string[];
  companyType: string;
  ticker: string;
  description: string;
  founded: number;
  linkedInUrl: string;
  facebookUrl: string;
  twitterUrl: string;
  techAttributeList: ZoomInfoTechAttribute[];
}

export interface ZoomInfoContact {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  mobilePhone: string;
  directPhoneDoNotCall: boolean;
  mobilePhoneDoNotCall: boolean;
  jobTitle: string;
  jobFunction: string;
  managementLevel: string;
  department: string;
  companyId: number;
  companyName: string;
  companyWebsite: string;
  linkedInUrl: string;
  hasEmail: boolean;
  hasPhone: boolean;
  hasMobilePhone: boolean;
  validDate: string;
}

export interface ZoomInfoTechAttribute {
  categoryName: string;
  product: string;
  vendor: string;
}

export interface ZoomInfoSearchResponse<T> {
  data: T[];
  maxResults: number;
  totalResults: number;
  currentPage: number;
  pageSize: number;
}

export interface ZoomInfoEnrichCompanyRequest {
  matchCompanyInput: Array<{
    zi_c_name?: string;
    zi_c_url?: string;
    zi_c_phone?: string;
  }>;
  outputFields: string[];
}

// ICP filter config
export interface IcpFilter {
  targetTitles: string[];
  targetManagementLevels: string[];
  targetDepartments: string[];
  targetIndustries: string[];
  minEmployees: number;
  maxEmployees: number;
  targetCountries: string[];
  targetStates: string[];
}

export const DEFAULT_ICP_FILTER: IcpFilter = {
  targetTitles: [
    'VP of Operations',
    'Director of Operations',
    'Director of Retail Operations',
    'Store Operations Manager',
    'VP of IT',
    'Director of IT',
    'IT Manager',
    'CIO',
    'CTO',
    'VP of Merchandising',
    'Director of Merchandising',
    'VP of Logistics',
    'Director of Logistics',
    'Director of Supply Chain',
    'VP Supply Chain',
    'POS Manager',
    'Technology Director',
    'Head of Technology',
    'Chief Operating Officer',
    'COO',
    'SVP Operations',
  ],
  targetManagementLevels: ['C-Level', 'VP-Level', 'Director', 'Manager'],
  targetDepartments: ['Operations', 'Information Technology', 'Merchandising', 'Logistics', 'Supply Chain', 'Finance', 'Executive'],
  targetIndustries: [
    'Retail',
    'Grocery Stores',
    'Wholesale',
    'Distribution',
    'Automotive Parts Retail',
    'Consumer Electronics',
    'Specialty Retail',
    'Food & Beverage',
    'Pharmacy',
    'Convenience Stores',
    'Home Improvement',
    'Fashion Retail',
    'Furniture Retail',
  ],
  minEmployees: 50,
  maxEmployees: 50000,
  targetCountries: ['United States', 'Canada'],
  targetStates: [],
};
