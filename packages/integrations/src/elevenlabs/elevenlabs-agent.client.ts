import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';
import {
  ElevenLabsConversationDetails,
  ElevenLabsTelephonyCallRequest,
  ElevenLabsTelephonyCallResponse,
} from './elevenlabs.types';

export class ElevenLabsAgentClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;

  constructor(apiKey: string, baseUrl: string, logger: Logger) {
    this.logger = logger.child({ module: 'ElevenLabsAgentClient' });
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  async initiateOutboundCall(
    request: ElevenLabsTelephonyCallRequest
  ): Promise<ElevenLabsTelephonyCallResponse> {
    this.logger.info(
      { agentId: request.agent_id, toNumber: request.to_number },
      'Initiating ElevenLabs outbound call'
    );

    try {
      const response = await this.http.post<ElevenLabsTelephonyCallResponse>(
        '/convai/twilio/outbound-call',
        request
      );
      return response.data;
    } catch (error) {
      this.logger.error({ error, request }, 'ElevenLabs outbound call failed');
      throw error;
    }
  }

  async getConversation(conversationId: string): Promise<ElevenLabsConversationDetails> {
    try {
      const response = await this.http.get<ElevenLabsConversationDetails>(
        `/convai/conversations/${conversationId}`
      );
      return response.data;
    } catch (error) {
      this.logger.error({ error, conversationId }, 'Failed to get ElevenLabs conversation');
      throw error;
    }
  }

  async waitForConversationComplete(
    conversationId: string,
    maxWaitMs = 300000,
    pollIntervalMs = 5000
  ): Promise<ElevenLabsConversationDetails> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const details = await this.getConversation(conversationId);

      if (details.status === 'done' || details.status === 'failed') {
        return details;
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new Error(`Conversation ${conversationId} did not complete within ${maxWaitMs}ms`);
  }

  async updateAgentSystemPrompt(agentId: string, systemPrompt: string): Promise<void> {
    await this.http.patch(`/convai/agents/${agentId}`, {
      prompt: { prompt: systemPrompt },
    });
    this.logger.info({ agentId }, 'Agent system prompt updated');
  }

  async getAgentDetails(agentId: string): Promise<Record<string, unknown>> {
    const response = await this.http.get(`/convai/agents/${agentId}`);
    return response.data as Record<string, unknown>;
  }

  buildDynamicVariables(params: {
    contactFirstName: string;
    companyName: string;
    callerName: string;
    sellerCompanyName: string;
    contactTitle: string;
    storeCount?: number;
    currentEslVendor?: string;
    currentPosVendor?: string;
    vertical?: string;
  }): Record<string, string> {
    return {
      contact_first_name: params.contactFirstName,
      company_name: params.companyName,
      caller_name: params.callerName,
      seller_company_name: params.sellerCompanyName,
      contact_title: params.contactTitle,
      store_count: params.storeCount?.toString() ?? 'unknown',
      current_esl_vendor: params.currentEslVendor ?? 'unknown',
      current_pos_vendor: params.currentPosVendor ?? 'unknown',
      retail_vertical: params.vertical ?? 'retail',
    };
  }
}
