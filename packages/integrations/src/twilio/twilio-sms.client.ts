import axios, { AxiosInstance } from 'axios';
import { Logger } from 'pino';
import { TwilioSmsSendRequest, TwilioSmsSendResponse } from './twilio.types';

/**
 * Twilio Programmable Messaging client.
 *
 * Replaces TelnyxSmsClient. The router maps the returned `sid` into the
 * existing `telnyx_message_id` column (no DB migration) — see sms.router.
 */

const TWILIO_API_BASE_URL = 'https://api.twilio.com';

export class TwilioSmsClient {
  private readonly http: AxiosInstance;
  private readonly logger: Logger;
  private readonly accountSid: string;

  /**
   * @param accountSid Twilio Account SID (basic-auth username + path segment)
   * @param authToken  Twilio Auth Token (basic-auth password)
   * @param logger     pino logger
   * @param baseUrl    override (defaults to https://api.twilio.com)
   */
  constructor(accountSid: string, authToken: string, logger: Logger, baseUrl: string = TWILIO_API_BASE_URL) {
    this.accountSid = accountSid;
    this.logger = logger.child({ module: 'TwilioSmsClient' });
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15000,
      auth: { username: accountSid, password: authToken },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  async send(req: TwilioSmsSendRequest): Promise<TwilioSmsSendResponse> {
    this.logger.info({ to: req.to, from: req.from }, 'Sending SMS');

    const params = new URLSearchParams();
    params.append('To', req.to);
    params.append('Body', req.text);
    // Messaging Service SID takes precedence over a bare From number.
    if (req.messagingServiceSid) {
      params.append('MessagingServiceSid', req.messagingServiceSid);
    } else {
      params.append('From', req.from);
    }
    if (req.statusCallback) {
      params.append('StatusCallback', req.statusCallback);
    }

    const res = await this.http.post<TwilioSmsSendResponse>(
      `/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
      params
    );
    return res.data;
  }
}
