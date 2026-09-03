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
