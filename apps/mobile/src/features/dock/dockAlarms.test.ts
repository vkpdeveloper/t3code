import { describe, expect, it } from "@effect/vitest";

import { formatDockAlarmCountdown, nextDockAlarm, parseDockAlarmTimes } from "./dockAlarms";

describe("parseDockAlarmTimes", () => {
  it("reads 24-hour, 12-hour, and ISO times from Shortcuts", () => {
    expect(parseDockAlarmTimes("07:00, 6:45 AM,9:30 PM\n2026-09-30T05:15:00, 12:05 am")).toEqual([
      { hour: 7, minute: 0 },
      { hour: 6, minute: 45 },
      { hour: 21, minute: 30 },
      { hour: 5, minute: 15 },
      { hour: 0, minute: 5 },
    ]);
  });

  it("skips unreadable entries and duplicates", () => {
    expect(parseDockAlarmTimes("7:00,,banana,25:00,13:00 PM,7:00")).toEqual([
      { hour: 7, minute: 0 },
    ]);
    expect(parseDockAlarmTimes(undefined)).toEqual([]);
  });
});

describe("nextDockAlarm", () => {
  const now = new Date(2026, 8, 29, 23, 10);

  it("picks the soonest alarm, rolling past times to tomorrow", () => {
    const next = nextDockAlarm(
      [
        { hour: 7, minute: 0 },
        { hour: 23, minute: 5 },
        { hour: 6, minute: 30 },
      ],
      now,
    );
    expect(next).toEqual(new Date(2026, 8, 30, 6, 30));
  });

  it("keeps an alarm later tonight on today", () => {
    expect(nextDockAlarm([{ hour: 23, minute: 45 }], now)).toEqual(new Date(2026, 8, 29, 23, 45));
    expect(nextDockAlarm([], now)).toBeNull();
  });
});

describe("formatDockAlarmCountdown", () => {
  const now = new Date(2026, 8, 29, 23, 10);

  it("rounds up to whole minutes", () => {
    expect(formatDockAlarmCountdown(new Date(2026, 8, 30, 6, 30), now)).toBe("in 7h 20m");
    expect(formatDockAlarmCountdown(new Date(2026, 8, 30, 1, 10), now)).toBe("in 2h");
    expect(formatDockAlarmCountdown(new Date(2026, 8, 29, 23, 10, 30), now)).toBe("in 1m");
    expect(formatDockAlarmCountdown(now, now)).toBe("now");
  });
});
