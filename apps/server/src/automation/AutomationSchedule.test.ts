// @effect-diagnostics globalDate:off -- public schedule helper accepts Date and returns exact instants.
import { describe, expect, it } from "@effect/vitest";

import { nextAutomationRunAt } from "./AutomationSchedule.ts";

describe("nextAutomationRunAt", () => {
  it("finds the next hourly minute in a non-UTC zone", () => {
    const next = nextAutomationRunAt(
      { kind: "hourly", minute: 15, timeZone: "Asia/Kolkata" },
      new Date("2026-09-03T10:44:30.000Z"),
    );
    expect(next.toISOString()).toBe("2026-09-03T10:45:00.000Z");
  });

  it("schedules weekday runs after a Friday", () => {
    const next = nextAutomationRunAt(
      { kind: "weekdays", time: "09:00", timeZone: "Asia/Kolkata" },
      new Date("2026-09-04T10:00:00.000Z"),
    );
    expect(next.toISOString()).toBe("2026-09-07T03:30:00.000Z");
  });

  it("skips a local time removed by daylight saving", () => {
    const next = nextAutomationRunAt(
      { kind: "daily", time: "02:30", timeZone: "America/New_York" },
      new Date("2026-03-08T00:00:00.000Z"),
    );
    expect(next.toISOString()).toBe("2026-03-09T06:30:00.000Z");
  });
});

describe("advanced cron schedules", () => {
  it.each([
    ["*/15 * * * *", "Asia/Kolkata", "2026-09-03T10:44:30Z", "2026-09-03T10:45:00.000Z"],
    ["0 9 * * 1-5", "Asia/Kolkata", "2026-09-04T10:00:00Z", "2026-09-07T03:30:00.000Z"],
    ["0 9 1 * *", "UTC", "2026-09-03T10:00:00Z", "2026-10-01T09:00:00.000Z"],
    ["0 9 * * *", "America/New_York", "2026-03-07T14:00:00Z", "2026-03-08T13:00:00.000Z"],
    ["0 9 * * *", "America/New_York", "2026-10-31T13:00:00Z", "2026-11-01T14:00:00.000Z"],
  ])(
    "resolves %s in %s strictly after the supplied instant",
    (expression, timeZone, after, expected) => {
      expect(
        nextAutomationRunAt({ kind: "cron", expression, timeZone }, new Date(after)).toISOString(),
      ).toBe(expected);
    },
  );

  it.each(["nonsense", "61 * * * *", "0 0 31 2 *"])(
    "rejects invalid or impossible cron %s",
    (expression) => {
      expect(() =>
        nextAutomationRunAt(
          { kind: "cron", expression, timeZone: "UTC" },
          new Date("2026-09-01T00:00:00Z"),
        ),
      ).toThrow();
    },
  );
});
