import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';

export interface TelnyxSmsSendRequest {
  from: string;
  to: string;
  text: string;
  messaging_profile_id?: string;
}

export interface TelnyxSmsSendResponse {
  data: {
    id: string;
    to: Array<{ phone_number: string; status: string }>;
    from: { phone_number: string };
    text: string;
    received_at: string;
  };
}

export class TelnyxSmsClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;

  constructor(apiKey: string, baseUrl: string, logger: Logger) {
    this.logger = logger.child({ module: 'TelnyxSmsClient' });
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
  }

  async send(req: TelnyxSmsSendRequest): Promise<TelnyxSmsSendResponse> {
    this.logger.info({ to: req.to, from: req.from }, 'Sending SMS');
    const res = await this.http.post<TelnyxSmsSendResponse>('/messages', req);
    return res.data;
  }
}
