export interface SequenceDefinition {
  name: string;
  description: string;
  triggerEvent: string;
  steps: SequenceStepDefinition[];
}

export interface SequenceStepDefinition {
  stepNumber: number;
  delayDays: number;
  delayHours: number;
  subjectTemplate: string;
  personalizationPromptKey: string;
  sendTimeHour: number;
}

export const EMAIL_SEQUENCES: SequenceDefinition[] = [
  {
    name: 'cold_followup',
    description: 'Follow-up after a call where we spoke briefly but didn\'t book a meeting',
    triggerEvent: 'call_connected_no_meeting',
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        delayHours: 2,
        subjectTemplate: 'Following up — {company_name} + {seller_company}',
        personalizationPromptKey: 'cold_followup_step1',
        sendTimeHour: 9,
      },
      {
        stepNumber: 2,
        delayDays: 3,
        delayHours: 0,
        subjectTemplate: 'Quick question about your price change process',
        personalizationPromptKey: 'cold_followup_step2',
        sendTimeHour: 10,
      },
      {
        stepNumber: 3,
        delayDays: 7,
        delayHours: 0,
        subjectTemplate: '{vertical} case study — {store_count_range} stores',
        personalizationPromptKey: 'cold_followup_step3',
        sendTimeHour: 9,
      },
      {
        stepNumber: 4,
        delayDays: 14,
        delayHours: 0,
        subjectTemplate: 'Last note from {seller_company}',
        personalizationPromptKey: 'cold_followup_step4_breakup',
        sendTimeHour: 9,
      },
    ],
  },

  {
    name: 'no_answer_email',
    description: 'Email sequence for prospects we couldn\'t reach by phone',
    triggerEvent: 'no_answer',
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        delayHours: 4,
        subjectTemplate: 'Tried to reach you — {company_name}',
        personalizationPromptKey: 'no_answer_step1',
        sendTimeHour: 10,
      },
      {
        stepNumber: 2,
        delayDays: 4,
        delayHours: 0,
        subjectTemplate: 'One thing {vertical} retailers are doing differently in 2026',
        personalizationPromptKey: 'no_answer_step2',
        sendTimeHour: 9,
      },
      {
        stepNumber: 3,
        delayDays: 10,
        delayHours: 0,
        subjectTemplate: 'Quick question — still relevant for {company_name}?',
        personalizationPromptKey: 'no_answer_step3',
        sendTimeHour: 8,
      },
    ],
  },

  {
    name: 'meeting_confirmation',
    description: 'Confirmation and prep email for booked meetings',
    triggerEvent: 'meeting_booked',
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        delayHours: 0,
        subjectTemplate: 'Confirmed: {meeting_date} — {company_name} + {seller_company}',
        personalizationPromptKey: 'meeting_confirmation_step1',
        sendTimeHour: 9,
      },
      {
        stepNumber: 2,
        delayDays: -1,
        delayHours: 0,
        subjectTemplate: 'See you tomorrow — quick prep for our call',
        personalizationPromptKey: 'meeting_reminder_step2',
        sendTimeHour: 9,
      },
    ],
  },

  {
    name: 'post_demo',
    description: 'Follow-up after a demo or discovery call with a human rep',
    triggerEvent: 'demo_held',
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        delayHours: 2,
        subjectTemplate: 'Great talking — next steps for {company_name}',
        personalizationPromptKey: 'post_demo_step1',
        sendTimeHour: 14,
      },
      {
        stepNumber: 2,
        delayDays: 5,
        delayHours: 0,
        subjectTemplate: 'Answers to your questions from {meeting_date}',
        personalizationPromptKey: 'post_demo_step2',
        sendTimeHour: 9,
      },
      {
        stepNumber: 3,
        delayDays: 14,
        delayHours: 0,
        subjectTemplate: 'Checking in — {company_name} evaluation',
        personalizationPromptKey: 'post_demo_step3',
        sendTimeHour: 9,
      },
    ],
  },

  {
    name: 'nurture_30d',
    description: '30-day nurture for interested but not ready prospects',
    triggerEvent: 'not_ready_30d',
    steps: [
      {
        stepNumber: 1,
        delayDays: 7,
        delayHours: 0,
        subjectTemplate: 'How {vertical} retailers are preparing for Q4',
        personalizationPromptKey: 'nurture_30d_step1',
        sendTimeHour: 9,
      },
      {
        stepNumber: 2,
        delayDays: 14,
        delayHours: 0,
        subjectTemplate: 'ROI calculator: what\'s manual price labeling actually costing you?',
        personalizationPromptKey: 'nurture_30d_step2',
        sendTimeHour: 9,
      },
      {
        stepNumber: 3,
        delayDays: 30,
        delayHours: 0,
        subjectTemplate: 'Checking back in — {company_name}',
        personalizationPromptKey: 'nurture_30d_step3',
        sendTimeHour: 9,
      },
    ],
  },

  {
    name: 'nurture_90d',
    description: '90-day nurture for cold/competitor-locked prospects',
    triggerEvent: 'not_ready_90d',
    steps: [
      {
        stepNumber: 1,
        delayDays: 30,
        delayHours: 0,
        subjectTemplate: 'Industry update: ESL adoption in {vertical}',
        personalizationPromptKey: 'nurture_90d_step1',
        sendTimeHour: 9,
      },
      {
        stepNumber: 2,
        delayDays: 60,
        delayHours: 0,
        subjectTemplate: 'Case study: {comparable_company} reduced labor 70% in 6 months',
        personalizationPromptKey: 'nurture_90d_step2',
        sendTimeHour: 9,
      },
      {
        stepNumber: 3,
        delayDays: 90,
        delayHours: 0,
        subjectTemplate: 'Still relevant? Quick check-in',
        personalizationPromptKey: 'nurture_90d_step3',
        sendTimeHour: 9,
      },
    ],
  },

  {
    name: 'reactivation',
    description: 'Reactivation sequence for prospects who went cold 180+ days ago',
    triggerEvent: 'reactivation',
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        delayHours: 0,
        subjectTemplate: 'It\'s been a while — still thinking about store tech at {company_name}?',
        personalizationPromptKey: 'reactivation_step1',
        sendTimeHour: 9,
      },
      {
        stepNumber: 2,
        delayDays: 7,
        delayHours: 0,
        subjectTemplate: 'What\'s changed since we last talked',
        personalizationPromptKey: 'reactivation_step2',
        sendTimeHour: 9,
      },
      {
        stepNumber: 3,
        delayDays: 21,
        delayHours: 0,
        subjectTemplate: 'Final note — {company_name} + {seller_company}',
        personalizationPromptKey: 'reactivation_step3_breakup',
        sendTimeHour: 9,
      },
    ],
  },
];
