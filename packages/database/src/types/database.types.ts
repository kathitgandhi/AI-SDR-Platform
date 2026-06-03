// ============================================================
// AI SDR PLATFORM — DATABASE TYPES
// Auto-generated from Supabase schema — run: pnpm db:generate-types
// ============================================================

export type LeadStage =
  | 'new' | 'enriching' | 'enriched' | 'phone_lookup_pending'
  | 'callable' | 'email_only' | 'in_call_queue' | 'calling'
  | 'called_no_answer' | 'called_voicemail' | 'called_gatekeeper'
  | 'connected' | 'qualified' | 'meeting_booked' | 'meeting_held'
  | 'nurturing_30d' | 'nurturing_90d' | 'nurturing_180d'
  | 'disqualified' | 'dnc' | 'dead';

export type LineType = 'landline' | 'mobile' | 'voip' | 'toll_free' | 'premium' | 'unknown' | 'invalid';
export type CallStatus = 'pending' | 'dialing' | 'ringing' | 'answered' | 'voicemail' | 'no_answer' | 'busy' | 'failed' | 'completed' | 'dnc_blocked' | 'window_blocked';
export type CallOutcome = 'meeting_booked' | 'callback_requested' | 'not_interested' | 'not_decision_maker' | 'wrong_number' | 'voicemail_left' | 'voicemail_full' | 'no_answer' | 'busy' | 'gatekeeper_blocked' | 'dnc_requested' | 'already_customer' | 'using_competitor' | 'too_small' | 'qualified_nurture' | 'error';
export type EmailStatus = 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'spam' | 'unsubscribed' | 'failed';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type RetailVertical = 'grocery' | 'general_retail' | 'wholesale_distribution' | 'automotive_retail' | 'electronics' | 'specialty' | 'cpg_operator' | 'pharmacy' | 'convenience' | 'home_improvement' | 'fashion_apparel' | 'furniture' | 'unknown';
/** The 7 outbound SDR personas. */
export type SdrPersonaName = 'mike' | 'sarah' | 'david' | 'rachel' | 'chris' | 'emma' | 'daniel';
/** All values of the persona_name enum — SDRs plus the inbound receptionist. */
export type PersonaName = SdrPersonaName | 'receptionist';
export type CrmProvider = 'hubspot' | 'salesforce' | 'pipedrive' | 'zoho' | 'none';

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  retail_vertical: RetailVertical;
  employee_count: number | null;
  annual_revenue: number | null;
  store_count: number | null;
  location_count: number | null;
  headquarters_city: string | null;
  headquarters_state: string | null;
  headquarters_country: string;
  description: string | null;
  has_esl: boolean;
  esl_vendor: string | null;
  has_pos: boolean;
  pos_vendor: string | null;
  has_erp: boolean;
  erp_vendor: string | null;
  has_wms: boolean;
  wms_vendor: string | null;
  enriched_at: string | null;
  enrichment_source: string | null;
  enrichment_confidence: number;
  icp_score: number;
  icp_tier: 'A' | 'B' | 'C' | 'D' | null;
  zoominfo_company_id: string | null;
  hubspot_company_id: string | null;
  salesforce_account_id: string | null;
  pipedrive_org_id: string | null;
  zoho_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string | null;
  full_name: string;
  title: string | null;
  department: string | null;
  seniority: string | null;
  email: string | null;
  email_valid: boolean;
  phone_direct: string | null;
  phone_direct_type: LineType | null;
  phone_direct_valid: boolean;
  phone_mobile: string | null;
  phone_hq: string | null;
  linkedin_url: string | null;
  is_decision_maker: boolean;
  decision_authority: string | null;
  email_opted_out: boolean;
  email_opted_out_at: string | null;
  call_opted_out: boolean;
  call_opted_out_at: string | null;
  zoominfo_contact_id: string | null;
  hubspot_contact_id: string | null;
  salesforce_contact_id: string | null;
  pipedrive_person_id: string | null;
  zoho_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  contact_id: string;
  company_id: string;
  campaign_id: string | null;
  stage: LeadStage;
  score: number;
  priority: number;
  call_attempts: number;
  last_called_at: string | null;
  next_contact_at: string | null;
  assigned_persona: PersonaName | null;
  store_count_confirmed: number | null;
  current_esl_vendor: string | null;
  current_pos_vendor: string | null;
  current_erp_vendor: string | null;
  current_wms_vendor: string | null;
  pain_points: string[] | null;
  rollout_timeline: string | null;
  budget_range: string | null;
  is_decision_maker: boolean | null;
  decision_process: string | null;
  pipeline_stage: string | null;
  meeting_booked_at: string | null;
  meeting_date: string | null;
  disqualified_reason: string | null;
  last_call_summary: string | null;
  handoff_summary: string | null;
  internal_notes: string | null;
  source: string;
  source_list_id: string | null;
  imported_at: string;
  created_at: string;
  updated_at: string;
}

export interface Call {
  id: string;
  lead_id: string;
  contact_id: string;
  company_id: string;
  campaign_id: string | null;
  telnyx_call_id: string | null;
  telnyx_call_leg_id: string | null;
  call_control_id: string | null;
  persona: PersonaName;
  from_number: string;
  to_number: string;
  status: CallStatus;
  outcome: CallOutcome | null;
  direction: string;
  initiated_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  ring_duration_seconds: number | null;
  talk_time_seconds: number | null;
  elevenlabs_session_id: string | null;
  claude_session_id: string | null;
  ai_confidence_score: number | null;
  outcome_score: number | null;
  qualification_score: number | null;
  sentiment_score: number | null;
  meeting_booked: boolean;
  dnc_requested: boolean;
  voicemail_left: boolean;
  gatekeeper_reached: boolean;
  decision_maker_reached: boolean;
  call_summary: string | null;
  next_steps: string | null;
  internal_notes: string | null;
  attempt_number: number;
  retry_scheduled_at: string | null;
  ai_disclosed: boolean;
  company_identified: boolean;
  purpose_stated: boolean;
  compliance_passed: boolean;
  created_at: string;
  updated_at: string;
}

export interface CallTranscript {
  id: string;
  call_id: string;
  lead_id: string;
  full_transcript: string | null;
  transcript_json: TranscriptTurn[] | null;
  objections_raised: string[] | null;
  pain_points_mentioned: string[] | null;
  competitors_mentioned: string[] | null;
  interest_signals: string[] | null;
  next_steps_agreed: string[] | null;
  claude_analysis: ClaudeAnalysis | null;
  qualification_data: QualificationData | null;
  meeting_details: MeetingDetails | null;
  processed: boolean;
  processed_at: string | null;
  processing_error: string | null;
  created_at: string;
}

export interface TranscriptTurn {
  speaker: 'agent' | 'prospect';
  text: string;
  timestamp_ms: number;
  confidence?: number;
}

export interface ClaudeAnalysis {
  summary: string;
  sentiment: 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';
  interest_level: number;
  qualification_score: number;
  key_insights: string[];
  recommended_next_action: string;
  objections: string[];
  buying_signals: string[];
  competitors_mentioned?: string[];
  interest_signals?: string[];
}

export interface QualificationData {
  store_count: number | null;
  current_esl_vendor: string | null;
  current_pos_vendor: string | null;
  current_erp_vendor: string | null;
  current_wms_vendor: string | null;
  pain_points: string[];
  rollout_timeline: string | null;
  budget_range: string | null;
  decision_authority: string | null;
  decision_process: string | null;
  is_decision_maker: boolean | null;
  budget_confirmed: boolean;
  timeline_confirmed: boolean;
  authority_confirmed: boolean;
  need_confirmed: boolean;
  bant_score: number;
}

export interface MeetingDetails {
  booked: boolean;
  proposed_date: string | null;
  confirmed_date: string | null;
  timezone: string | null;
  duration_minutes: number | null;
  attendee_name: string | null;
  attendee_email: string | null;
  meeting_type: string | null;
  notes: string | null;
}

export interface Email {
  id: string;
  contact_id: string;
  lead_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  sequence_step_id: string | null;
  contact_sequence_id: string | null;
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  from_address: string;
  to_address: string;
  cc_addresses: string[] | null;
  subject: string;
  body_html: string | null;
  body_text: string | null;
  status: EmailStatus;
  is_hot_lead_cc: boolean;
  opened_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  clicked_count: number;
  first_clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  bounce_reason: string | null;
  sent_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  target_verticals: RetailVertical[] | null;
  target_titles: string[] | null;
  target_min_store_count: number;
  target_min_employees: number | null;
  target_states: string[] | null;
  daily_call_limit: number;
  hourly_call_limit: number;
  max_concurrent_calls: number;
  call_retry_max: number;
  call_window_start: number;
  call_window_end: number;
  enabled_personas: PersonaName[];
  email_sequence_id: string | null;
  email_enabled: boolean;
  total_leads: number;
  calls_made: number;
  meetings_booked: number;
  emails_sent: number;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  lead_id: string;
  contact_id: string;
  company_id: string;
  call_id: string | null;
  campaign_id: string | null;
  status: 'scheduled' | 'confirmed' | 'held' | 'cancelled' | 'no_show' | 'rescheduled';
  scheduled_at: string;
  duration_minutes: number;
  timezone: string;
  meeting_type: string;
  meeting_link: string | null;
  calendar_event_id: string | null;
  assigned_rep_email: string | null;
  assigned_rep_name: string | null;
  contact_confirmed: boolean;
  contact_confirmed_at: string | null;
  qualification_summary: string | null;
  key_pain_points: string[] | null;
  products_of_interest: string[] | null;
  store_count: number | null;
  budget_indication: string | null;
  decision_timeline: string | null;
  held_at: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  reminder_sent: boolean;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DncEntry {
  id: string;
  phone: string | null;
  email: string | null;
  source: string;
  added_reason: string | null;
  added_by: string | null;
  expires_at: string | null;
  is_permanent: boolean;
  contact_id: string | null;
  created_at: string;
}

export interface AgentPersona {
  id: string;
  name: PersonaName;
  display_name: string;
  elevenlabs_agent_id: string;
  voice_id: string;
  tone: string;
  style: string;
  opening_style: string;
  system_prompt_override: string | null;
  is_active: boolean;
  calls_made: number;
  meetings_booked: number;
  connect_rate: number;
  meeting_rate: number;
  avg_call_duration: number;
  created_at: string;
  updated_at: string;
}

// DTO types for inserts / updates
export type InsertCompany = Omit<Company, 'id' | 'full_name' | 'created_at' | 'updated_at'> & { id?: string };
export type UpdateCompany = Partial<InsertCompany>;
export type InsertContact = Omit<Contact, 'id' | 'full_name' | 'created_at' | 'updated_at'> & { id?: string };
export type UpdateContact = Partial<InsertContact>;
export type InsertLead = Omit<Lead, 'id' | 'created_at' | 'updated_at'> & { id?: string };
export type UpdateLead = Partial<InsertLead>;
export type InsertCall = Omit<Call, 'id' | 'created_at' | 'updated_at'> & { id?: string };
export type UpdateCall = Partial<InsertCall>;
export type InsertEmail = Omit<Email, 'id' | 'created_at' | 'updated_at'> & { id?: string };
export type UpdateEmail = Partial<InsertEmail>;
