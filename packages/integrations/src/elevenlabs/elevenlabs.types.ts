export interface ElevenLabsAgentConfig {
  agent_id: string;
  name: string;
  first_message?: string;
  system_prompt?: string;
  model_id?: string;
  voice_id?: string;
  language?: string;
}

export interface ElevenLabsConversationSession {
  conversation_id: string;
  agent_id: string;
  status: 'active' | 'ended';
  start_time: string;
  end_time?: string;
  call_duration_secs?: number;
}

export interface ElevenLabsConversationCreateRequest {
  agent_id: string;
  dynamic_variables?: Record<string, string>;
  conversation_config_override?: {
    agent?: {
      prompt?: {
        prompt?: string;
        llm?: string;
        temperature?: number;
        max_tokens?: number;
      };
      first_message?: string;
      language?: string;
    };
    tts?: {
      voice_id?: string;
    };
  };
}

export interface ElevenLabsConversationResponse {
  conversation_id: string;
  signed_url?: string;
}

export interface ElevenLabsTranscriptMessage {
  role: 'agent' | 'user';
  message: string;
  time_in_call_secs: number;
}

export interface ElevenLabsConversationDetails {
  conversation_id: string;
  agent_id: string;
  status: 'processing' | 'done' | 'failed';
  transcript: ElevenLabsTranscriptMessage[];
  metadata: {
    start_time_unix_secs: number;
    call_duration_secs: number;
  };
  analysis: {
    call_successful: 'success' | 'failure' | 'unknown';
    transcript_summary: string;
    data_collection_results: Record<string, {
      type: string;
      value: string | null;
      rationale: string;
    }>;
  };
}

export interface ElevenLabsTelephonyCallRequest {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  conversation_initiation_client_data?: {
    dynamic_variables?: Record<string, string>;
    conversation_config_override?: ElevenLabsConversationCreateRequest['conversation_config_override'];
  };
}

export interface ElevenLabsTelephonyCallResponse {
  call_id: string;
  conversation_id: string;
  status: string;
}
