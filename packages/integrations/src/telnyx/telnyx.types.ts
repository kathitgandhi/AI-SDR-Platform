export interface TelnyxCallInitiateRequest {
  connection_id: string;
  to: string;
  from: string;
  from_display_name?: string;
  answering_machine_detection?: 'detect' | 'detect_beep' | 'disabled';
  answering_machine_detection_config?: {
    total_analysis_time_millis?: number;
    after_greeting_silence_millis?: number;
    between_words_silence_millis?: number;
    greeting_duration_millis?: number;
    initial_silence_millis?: number;
    maximum_number_of_words?: number;
    maximum_word_length_millis?: number;
    silence_threshold?: number;
    greeting_total_analysis_time_millis?: number;
    greeting_silence_duration_millis?: number;
  };
  webhook_url?: string;
  webhook_url_method?: 'GET' | 'POST';
  custom_headers?: Array<{ name: string; value: string }>;
  client_state?: string;
  timeout_secs?: number;
}

export interface TelnyxCallResponse {
  data: {
    call_control_id: string;
    call_leg_id: string;
    call_session_id: string;
    record_type: string;
    is_alive: boolean;
    state: string;
  };
}

export interface TelnyxWebhookPayload {
  data: {
    record_type: 'event';
    event_type: TelnyxEventType;
    id: string;
    occurred_at: string;
    payload: TelnyxCallPayload;
  };
  meta: {
    attempt: number;
    delivered_to: string;
  };
}

export type TelnyxEventType =
  | 'call.initiated'
  | 'call.ringing'
  | 'call.answered'
  | 'call.hangup'
  | 'call.machine.detection.ended'
  | 'call.bridged'
  | 'call.recording.saved'
  | 'call.speak.ended'
  | 'call.gather.ended'
  | 'call.transfer.completed'
  | 'call.dtmf.received';

export interface TelnyxCallPayload {
  call_control_id: string;
  call_leg_id: string;
  call_session_id: string;
  connection_id: string;
  client_state?: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  state: string;
  start_time?: string;
  answer_time?: string;
  end_time?: string;
  hangup_cause?: string;
  hangup_source?: string;
  result?: string;
  answering_machine_detection?: {
    result: 'human' | 'machine_start' | 'machine_end_beep' | 'machine_end_silence' | 'machine_end_other' | 'fax';
    confidence?: number;
  };
}

export interface TelnyxPhoneLookupResponse {
  data: {
    phone_number: string;
    line_type: TelnyxLineType;
    carrier: {
      name: string;
      mobile_country_code: string;
      mobile_network_code: string;
      type: string;
    } | null;
    caller_name: {
      caller_name: string;
      error_code: string | null;
    } | null;
    portability: {
      ported: boolean;
      ported_date: string | null;
      spid: string | null;
    } | null;
    fraud: {
      label: string;
      risk_score: number;
    } | null;
    valid: boolean;
    national_format: string;
    country_code: string;
  };
}

export type TelnyxLineType =
  | 'landline'
  | 'mobile'
  | 'voip'
  | 'toll_free'
  | 'premium_rate'
  | 'shared_cost'
  | 'personal_number'
  | 'pager'
  | 'uan'
  | 'voicemail'
  | 'unknown';

export interface CallControlAction {
  call_control_id: string;
}

export interface TransferCallRequest extends CallControlAction {
  to: string;
  from?: string;
  audio_url?: string;
}
