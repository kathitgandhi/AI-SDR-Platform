import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Logger } from 'pino';

export interface SendEmailParams {
  to: string;
  from: string;
  fromName: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  cc?: string[];
  replyTo?: string;
  threadId?: string;
  messageId?: string;
}

export interface SentEmailResult {
  gmailMessageId: string;
  gmailThreadId: string;
}

export class GmailClient {
  private readonly oauth2Client: OAuth2Client;
  private readonly gmail: gmail_v1.Gmail;
  private readonly logger: Logger;

  constructor(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    logger: Logger
  ) {
    this.logger = logger.child({ module: 'GmailClient' });
    this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async sendEmail(params: SendEmailParams): Promise<SentEmailResult> {
    const raw = this.buildRawEmail(params);

    try {
      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
          ...(params.threadId ? { threadId: params.threadId } : {}),
        },
      });

      const result = response.data;
      this.logger.info(
        { to: params.to, messageId: result.id, threadId: result.threadId },
        'Email sent successfully'
      );

      return {
        gmailMessageId: result.id ?? '',
        gmailThreadId: result.threadId ?? '',
      };
    } catch (error) {
      this.logger.error({ error, to: params.to, subject: params.subject }, 'Gmail send failed');
      throw error;
    }
  }

  async getThread(threadId: string): Promise<gmail_v1.Schema$Thread> {
    const response = await this.gmail.users.threads.get({
      userId: 'me',
      id: threadId,
    });
    return response.data;
  }

  async checkForReplies(threadId: string): Promise<boolean> {
    const thread = await this.getThread(threadId);
    return (thread.messages?.length ?? 0) > 1;
  }

  private buildRawEmail(params: SendEmailParams): string {
    const boundary = `boundary_${Date.now()}`;
    const fromHeader = `"${params.fromName}" <${params.from}>`;
    const ccHeader = params.cc?.length ? `\r\nCc: ${params.cc.join(', ')}` : '';
    const replyToHeader = params.replyTo ? `\r\nReply-To: ${params.replyTo}` : '';

    const mimeMessage = [
      `From: ${fromHeader}`,
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ccHeader,
      replyToHeader,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      params.bodyText,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      params.bodyHtml,
      ``,
      `--${boundary}--`,
    ].join('\r\n');

    return Buffer.from(mimeMessage).toString('base64url');
  }
}
