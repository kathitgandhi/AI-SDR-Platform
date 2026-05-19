import { Queue } from 'bullmq';
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
};
const DEFAULT_OPTIONS = {
    defaultJobOptions: {
        removeOnComplete: { count: 1000, age: 24 * 3600 },
        removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
    },
};
export function createQueues(connection) {
    const make = (name, overrides) => new Queue(name, { connection, ...DEFAULT_OPTIONS, ...overrides });
    return {
        [QUEUE_NAMES.LEAD_IMPORT]: make(QUEUE_NAMES.LEAD_IMPORT, {
            defaultJobOptions: { ...DEFAULT_OPTIONS.defaultJobOptions, attempts: 2 },
        }),
        [QUEUE_NAMES.ENRICHMENT]: make(QUEUE_NAMES.ENRICHMENT, {
            defaultJobOptions: { ...DEFAULT_OPTIONS.defaultJobOptions, attempts: 3 },
        }),
        [QUEUE_NAMES.PHONE_LOOKUP]: make(QUEUE_NAMES.PHONE_LOOKUP),
        [QUEUE_NAMES.CALL_SCHEDULE]: make(QUEUE_NAMES.CALL_SCHEDULE, {
            defaultJobOptions: { ...DEFAULT_OPTIONS.defaultJobOptions, attempts: 1 },
        }),
        [QUEUE_NAMES.CALL_EXECUTE]: make(QUEUE_NAMES.CALL_EXECUTE, {
            defaultJobOptions: {
                ...DEFAULT_OPTIONS.defaultJobOptions,
                attempts: 1,
                removeOnComplete: { count: 500, age: 3600 },
            },
        }),
        [QUEUE_NAMES.TRANSCRIPT_PROCESS]: make(QUEUE_NAMES.TRANSCRIPT_PROCESS, {
            defaultJobOptions: { ...DEFAULT_OPTIONS.defaultJobOptions, attempts: 3, delay: 30000 },
        }),
        [QUEUE_NAMES.EMAIL_SEND]: make(QUEUE_NAMES.EMAIL_SEND),
        [QUEUE_NAMES.EMAIL_SEQUENCE]: make(QUEUE_NAMES.EMAIL_SEQUENCE),
        [QUEUE_NAMES.REPORTING]: make(QUEUE_NAMES.REPORTING, {
            defaultJobOptions: { ...DEFAULT_OPTIONS.defaultJobOptions, attempts: 2 },
        }),
        [QUEUE_NAMES.CRM_SYNC]: make(QUEUE_NAMES.CRM_SYNC, {
            defaultJobOptions: { ...DEFAULT_OPTIONS.defaultJobOptions, attempts: 5 },
        }),
    };
}
//# sourceMappingURL=queue.registry.js.map