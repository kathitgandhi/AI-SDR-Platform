import { DateTime } from 'luxon';

const STATE_TIMEZONES: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix',
  AR: 'America/Chicago', CA: 'America/Los_Angeles', CO: 'America/Denver',
  CT: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago',
  ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York',
  MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York',
  NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York',
  ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', UT: 'America/Denver', VT: 'America/New_York',
  VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
};

export interface CallWindowCheck {
  allowed: boolean;
  localTime: string;
  timezone: string;
  reason?: string;
  nextAllowedAt?: Date;
}

export class TimezoneGuard {
  constructor(
    private readonly windowStartHour: number = 8,
    private readonly windowEndHour: number = 21
  ) {}

  isCallAllowed(state: string, checkTime: Date = new Date()): CallWindowCheck {
    const timezone = STATE_TIMEZONES[state.toUpperCase()] ?? 'America/New_York';
    const localDt = DateTime.fromJSDate(checkTime, { zone: timezone });
    const localHour = localDt.hour;
    const dayOfWeek = localDt.weekday; // 1=Mon, 7=Sun

    const localTime = localDt.toFormat('h:mm a ZZZZ');

    if (dayOfWeek === 7) {
      const nextMonday = localDt.plus({ days: 8 - dayOfWeek }).set({ hour: this.windowStartHour, minute: 0, second: 0 });
      return {
        allowed: false,
        localTime,
        timezone,
        reason: 'Sunday calling prohibited',
        nextAllowedAt: nextMonday.toJSDate(),
      };
    }

    if (localHour < this.windowStartHour) {
      const nextWindow = localDt.set({ hour: this.windowStartHour, minute: 0, second: 0 });
      return {
        allowed: false,
        localTime,
        timezone,
        reason: `Before calling window — local time is ${localTime}`,
        nextAllowedAt: nextWindow.toJSDate(),
      };
    }

    if (localHour >= this.windowEndHour) {
      let nextDay = localDt.plus({ days: 1 });
      while (nextDay.weekday === 7) nextDay = nextDay.plus({ days: 1 });
      const nextWindow = nextDay.set({ hour: this.windowStartHour, minute: 0, second: 0 });
      return {
        allowed: false,
        localTime,
        timezone,
        reason: `After calling window — local time is ${localTime}`,
        nextAllowedAt: nextWindow.toJSDate(),
      };
    }

    return { allowed: true, localTime, timezone };
  }

  getTimezoneForState(state: string): string {
    return STATE_TIMEZONES[state.toUpperCase()] ?? 'America/New_York';
  }

  getNextCallWindow(state: string, fromTime: Date = new Date()): Date {
    const timezone = this.getTimezoneForState(state);
    let dt = DateTime.fromJSDate(fromTime, { zone: timezone });

    // Advance until we find a valid window
    for (let i = 0; i < 14; i++) {
      const hour = dt.hour;
      const dow = dt.weekday;

      if (dow !== 7 && hour >= this.windowStartHour && hour < this.windowEndHour) {
        return dt.toJSDate();
      }

      if (hour >= this.windowEndHour || dow === 7) {
        let nextDay = dt.plus({ days: 1 });
        while (nextDay.weekday === 7) nextDay = nextDay.plus({ days: 1 });
        dt = nextDay.set({ hour: this.windowStartHour, minute: 0, second: 0 });
      } else {
        dt = dt.set({ hour: this.windowStartHour, minute: 0, second: 0 });
      }
    }

    return dt.toJSDate();
  }
}
