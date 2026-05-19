import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
export declare const QUEUE_NAMES: {
    readonly LEAD_IMPORT: "lead-import";
    readonly ENRICHMENT: "enrichment";
    readonly PHONE_LOOKUP: "phone-lookup";
    readonly CALL_SCHEDULE: "call-schedule";
    readonly CALL_EXECUTE: "call-execute";
    readonly TRANSCRIPT_PROCESS: "transcript-process";
    readonly EMAIL_SEND: "email-send";
    readonly EMAIL_SEQUENCE: "email-sequence";
    readonly REPORTING: "reporting";
    readonly CRM_SYNC: "crm-sync";
};
export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];
export declare function createQueues(connection: Redis): Record<QueueName, Queue>;
export interface LeadImportJobPayload {
    campaignId: string;
    page: number;
    pageSize: number;
    filter?: Record<string, unknown>;
}
export interface EnrichmentJobPayload {
    companyId: string;
    leadId: string;
    domain: string;
    website?: string;
}
export interface PhoneLookupJobPayload {
    contactId: string;
    leadId: string;
    phone: string;
}
export interface CallScheduleJobPayload {
    leadId: string;
    campaignId: string;
    scheduledFor?: string;
}
export interface CallExecuteJobPayload {
    leadId: string;
    contactId: string;
    companyId: string;
    campaignId: string;
    phone: string;
    persona: string;
    attemptNumber: number;
}
export interface TranscriptProcessJobPayload {
    callId: string;
    leadId: string;
    conversationId: string;
}
export interface EmailSendJobPayload {
    emailId: string;
}
export interface EmailSequenceJobPayload {
    contactSequenceId: string;
}
export interface ReportingJobPayload {
    type: 'daily_digest' | 'weekly_digest' | 'mv_refresh';
    date?: string;
}
export interface CrmSyncJobPayload {
    entity: 'lead' | 'contact' | 'company' | 'appointment';
    entityId: string;
    action: 'create' | 'update';
    provider: string;
}
//# sourceMappingURL=queue.registry.d.ts.map