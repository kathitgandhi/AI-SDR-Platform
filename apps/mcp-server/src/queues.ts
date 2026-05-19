// Queue name constants — keep in sync with apps/workers/src/queues/queue.registry.ts
export const QUEUE_NAMES = {
  LEAD_IMPORT: 'lead-import',
  ENRICHMENT: 'enrichment',
  PHONE_LOOKUP: 'phone-lookup',
  CALL_SCHEDULE: 'call-schedule',
  CALL_EXECUTE: 'call-execute',
  TRANSCRIPT_PROCESS: 'transcript-process',
  EMAIL_SEND: 'email-send',
  EMAIL_SEQUENCE: 'email-sequence',
  REPORTING: 'reporting',
  CRM_SYNC: 'crm-sync',
} as const;
