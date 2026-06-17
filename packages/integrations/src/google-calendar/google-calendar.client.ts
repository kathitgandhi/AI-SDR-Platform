import { google, calendar_v3 } from 'googleapis';
import { Logger } from 'pino';

export interface CreateMeetingParams {
  summary: string;
  description: string;
  /** ISO 8601 start datetime. */
  startIso: string;
  durationMinutes: number;
  /** IANA timezone, e.g. America/New_York. */
  timezone: string;
  /** Attendee emails (prospect + reps). Empty entries are filtered out. */
  attendees: string[];
  /** Unique id for the Meet create-request (use the call/appointment id). */
  requestId: string;
}

export interface CreatedMeeting {
  eventId: string;
  /** Google Meet join URL (null if Meet couldn't be provisioned). */
  meetLink: string | null;
  /** Calendar event web link. */
  htmlLink: string | null;
}

/**
 * Creates Google Calendar events with an auto-generated Google Meet link and
 * emails the invite to attendees (sendUpdates: 'all').
 *
 * Uses the same Google OAuth client as Gmail, but the refresh token MUST be
 * minted with the calendar scope (https://www.googleapis.com/auth/calendar.events)
 * in addition to gmail.send — otherwise events.insert returns 403.
 */
export class GoogleCalendarClient {
  private readonly calendar: calendar_v3.Calendar;
  private readonly logger: Logger;

  constructor(clientId: string, clientSecret: string, refreshToken: string, logger: Logger) {
    const oauth = new google.auth.OAuth2(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });
    this.calendar = google.calendar({ version: 'v3', auth: oauth });
    this.logger = logger.child({ module: 'GoogleCalendarClient' });
  }

  async createMeeting(p: CreateMeetingParams): Promise<CreatedMeeting> {
    const endIso = new Date(new Date(p.startIso).getTime() + p.durationMinutes * 60_000).toISOString();
    const attendees = p.attendees.filter(Boolean).map((email) => ({ email }));

    const res = await this.calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      sendUpdates: 'all',
      requestBody: {
        summary: p.summary,
        description: p.description,
        start: { dateTime: p.startIso, timeZone: p.timezone },
        end: { dateTime: endIso, timeZone: p.timezone },
        attendees,
        conferenceData: {
          createRequest: {
            requestId: p.requestId,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
        reminders: { useDefault: true },
      },
    });

    const data = res.data;
    const meetLink =
      data.hangoutLink ??
      data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ??
      null;

    this.logger.info({ eventId: data.id, meetLink }, 'Calendar event created');
    return { eventId: data.id ?? '', meetLink, htmlLink: data.htmlLink ?? null };
  }
}
