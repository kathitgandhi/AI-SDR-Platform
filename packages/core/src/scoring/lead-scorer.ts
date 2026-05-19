import { Company, Contact, RetailVertical } from '@ai-sdr/database';

export interface LeadScoreFactors {
  companyFit: number;        // 0-30: ICP alignment
  sizeFit: number;           // 0-20: store count / employee count
  techStack: number;         // 0-25: technology gap signals
  verticalFit: number;       // 0-15: retail vertical alignment
  contactFit: number;        // 0-10: title / seniority alignment
  total: number;             // 0-100
  tier: 'A' | 'B' | 'C' | 'D';
  reasoning: string[];
}

const VERTICAL_SCORES: Record<RetailVertical, number> = {
  grocery: 15,
  general_retail: 13,
  wholesale_distribution: 12,
  automotive_retail: 11,
  electronics: 14,
  specialty: 10,
  cpg_operator: 11,
  pharmacy: 12,
  convenience: 9,
  home_improvement: 12,
  fashion_apparel: 10,
  furniture: 9,
  unknown: 3,
};

const DECISION_MAKER_TITLES = [
  'ceo', 'coo', 'cio', 'cto', 'vp', 'vice president', 'director',
  'head of', 'svp', 'evp', 'chief', 'operations manager',
];

export class LeadScorer {
  scoreLeadFromRaw(company: Company, contact: Contact): LeadScoreFactors {
    const reasoning: string[] = [];
    let companyFit = 0;
    let sizeFit = 0;
    let techStack = 0;
    let verticalFit = 0;
    let contactFit = 0;

    // --- COMPANY FIT (0-30) ---
    if (company.domain && !company.domain.includes('gmail') && !company.domain.includes('yahoo')) {
      companyFit += 10;
      reasoning.push('Has business domain');
    }
    if (company.store_count && company.store_count >= 1) {
      companyFit += 10;
      reasoning.push(`${company.store_count} store locations confirmed`);
    }
    if (company.annual_revenue && company.annual_revenue >= 5_000_000) {
      companyFit += 10;
      reasoning.push(`Revenue ≥ $5M`);
    }

    // --- SIZE FIT (0-20) ---
    const stores = company.store_count ?? 0;
    if (stores >= 100) {
      sizeFit = 20;
      reasoning.push('100+ locations — enterprise tier');
    } else if (stores >= 20) {
      sizeFit = 16;
      reasoning.push('20-99 locations — strong fit');
    } else if (stores >= 5) {
      sizeFit = 12;
      reasoning.push('5-19 locations — good fit');
    } else if (stores >= 1) {
      sizeFit = 6;
      reasoning.push('1-4 locations — marginal fit');
    } else if (company.employee_count && company.employee_count >= 200) {
      sizeFit = 8;
      reasoning.push('200+ employees (location count unknown)');
    }

    // --- TECH STACK (0-25) ---
    if (!company.has_esl) {
      techStack += 12;
      reasoning.push('No ESL detected — AirESL opportunity');
    } else if (company.esl_vendor && !['air', 'airretail'].some(v => company.esl_vendor!.toLowerCase().includes(v))) {
      techStack += 6;
      reasoning.push(`Uses competitor ESL: ${company.esl_vendor}`);
    }

    if (!company.has_pos) {
      techStack += 6;
      reasoning.push('No POS confirmed — AirPOS opportunity');
    } else if (company.pos_vendor) {
      const legacyPos = ['ncr', 'ibm', 'micros', 'retalix', 'aloha', 'radiant'];
      if (legacyPos.some(v => company.pos_vendor!.toLowerCase().includes(v))) {
        techStack += 5;
        reasoning.push(`Legacy POS: ${company.pos_vendor}`);
      }
    }

    if (!company.has_erp) {
      techStack += 5;
      reasoning.push('No ERP confirmed — AirBiz opportunity');
    } else if (company.erp_vendor) {
      const legacyErp = ['quickbooks', 'sage', 'peachtree', 'mas90'];
      if (legacyErp.some(v => company.erp_vendor!.toLowerCase().includes(v))) {
        techStack += 2;
        reasoning.push(`Legacy ERP: ${company.erp_vendor}`);
      }
    }

    if (!company.has_wms && (stores >= 10 || (company.employee_count ?? 0) >= 500)) {
      techStack += 2;
      reasoning.push('No WMS for large operation — AirWMS opportunity');
    }

    techStack = Math.min(techStack, 25);

    // --- VERTICAL FIT (0-15) ---
    verticalFit = VERTICAL_SCORES[company.retail_vertical] ?? 3;
    reasoning.push(`Vertical: ${company.retail_vertical} (${verticalFit}/15)`);

    // --- CONTACT FIT (0-10) ---
    if (contact.title) {
      const title = contact.title.toLowerCase();
      const isDM = DECISION_MAKER_TITLES.some((t) => title.includes(t));
      if (isDM) {
        contactFit += 7;
        reasoning.push(`Decision maker title: ${contact.title}`);
      } else {
        contactFit += 3;
        reasoning.push(`Influencer title: ${contact.title}`);
      }
    }
    if (contact.phone_direct && contact.phone_direct_type === 'landline') {
      contactFit += 3;
      reasoning.push('Direct landline available');
    }

    const total = Math.min(
      companyFit + sizeFit + techStack + verticalFit + contactFit,
      100
    );

    const tier: 'A' | 'B' | 'C' | 'D' =
      total >= 75 ? 'A' : total >= 55 ? 'B' : total >= 35 ? 'C' : 'D';

    return {
      companyFit,
      sizeFit,
      techStack,
      verticalFit,
      contactFit,
      total,
      tier,
      reasoning,
    };
  }

  shouldCallLead(score: LeadScoreFactors, phoneValid: boolean): boolean {
    return phoneValid && score.total >= 30 && score.tier !== 'D';
  }

  shouldEmailOnly(score: LeadScoreFactors, phoneValid: boolean): boolean {
    return !phoneValid && score.total >= 20;
  }

  getPriority(score: LeadScoreFactors): number {
    if (score.tier === 'A') return 10;
    if (score.tier === 'B') return 7;
    if (score.tier === 'C') return 4;
    return 1;
  }
}
