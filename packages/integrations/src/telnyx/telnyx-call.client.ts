import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';
import {
  TelnyxCallInitiateRequest,
  TelnyxCallResponse,
  TransferCallRequest,
} from './telnyx.types';

export class TelnyxCallClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;

  constructor(apiKey: string, baseUrl: string, logger: Logger) {
    this.logger = logger.child({ module: 'TelnyxCallClient' });
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status;
        const detail = err.response?.data?.errors?.[0]?.detail ?? err.message;
        this.logger.error({ status, detail }, 'Telnyx API error');
        throw new TelnyxApiError(detail, status, err.response?.data);
      }
    );
  }

  async initiateCall(request: TelnyxCallInitiateRequest): Promise<TelnyxCallResponse> {
    this.logger.info({ to: request.to, from: request.from }, 'Initiating outbound call');

    const response = await this.http.post<TelnyxCallResponse>('/calls', request);
    return response.data;
  }

  async hangup(callControlId: string): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/hangup`, {});
    this.logger.info({ callControlId }, 'Call hung up');
  }

  async answer(callControlId: string): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/answer`, {});
  }

  async transfer(request: TransferCallRequest): Promise<void> {
    const { call_control_id, ...body } = request;
    await this.http.post(`/calls/${call_control_id}/actions/transfer`, body);
    this.logger.info({ callControlId: call_control_id, to: request.to }, 'Call transferred');
  }

  async sendDtmf(callControlId: string, digits: string): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/send_dtmf`, { digits });
  }

  async bridgeToElevenLabs(
    callControlId: string,
    _elevenLabsStreamUrl: string
  ): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/bridge`, {
      call_control_id: callControlId,
      park_after_unbridge: false,
    });
  }

  async startRecording(
    callControlId: string,
    options: {
      format?: 'wav' | 'mp3';
      channels?: 'single' | 'dual';
    } = {}
  ): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/record_start`, {
      format: options.format ?? 'mp3',
      channels: options.channels ?? 'dual',
    });
  }

  async stopRecording(callControlId: string): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/record_stop`, {});
  }

  async speak(
    callControlId: string,
    text: string,
    options: { voice?: string; language?: string } = {}
  ): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/speak`, {
      payload: text,
      payload_type: 'text',
      voice: options.voice ?? 'female',
      language: options.language ?? 'en-US',
    });
  }

  async playAudio(callControlId: string, audioUrl: string): Promise<void> {
    await this.http.post(`/calls/${callControlId}/actions/playback_start`, {
      audio_url: audioUrl,
    });
  }

  async getCallDetails(callControlId: string): Promise<TelnyxCallResponse> {
    const response = await this.http.get<TelnyxCallResponse>(`/calls/${callControlId}`);
    return response.data;
  }
}

export class TelnyxApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly responseData: unknown
  ) {
    super(message);
    this.name = 'TelnyxApiError';
  }
}

export function validateTelnyxWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const crypto = require('crypto');
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSig, 'hex')
  );
}
