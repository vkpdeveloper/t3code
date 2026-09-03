// @effect-diagnostics globalDate:off -- Intl time-zone arithmetic needs native Date for DST-safe local calendar conversion.
import type { AutomationSchedule, AutomationWeekday } from "@t3tools/contracts";

const WEEKDAYS: ReadonlyArray<AutomationWeekday> = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: AutomationWeekday;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday").toLowerCase() as AutomationWeekday;
  if (!WEEKDAYS.includes(weekday)) {
    throw new RangeError(`Unsupported weekday returned for ${timeZone}.`);
  }
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday,
  };
}

function localTimeToInstant(
  date: Pick<ZonedParts, "year" | "month" | "day">,
  hour: number,
  minute: number,
  timeZone: string,
): Date | null {
  const target = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const actualLocal = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const delta = target - actualLocal;
    candidate += delta;
    if (delta === 0) break;
  }
  const result = new Date(candidate);
  const actual = zonedParts(result, timeZone);
  return actual.year === date.year &&
    actual.month === date.month &&
    actual.day === date.day &&
    actual.hour === hour &&
    actual.minute === minute
    ? result
    : null;
}

function parseTime(value: string): readonly [number, number] {
  const [hour = "0", minute = "0"] = value.split(":");
  return [Number(hour), Number(minute)];
}

export function nextAutomationRunAt(schedule: AutomationSchedule, after: Date): Date {
  // This also validates the IANA time zone before any scheduler state is persisted.
  zonedParts(after, schedule.timeZone);

  if (schedule.kind === "hourly") {
    const firstMinute = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
    for (let offset = 0; offset < 121; offset += 1) {
      const candidate = new Date(firstMinute + offset * 60_000);
      if (zonedParts(candidate, schedule.timeZone).minute === schedule.minute) {
        return candidate;
      }
    }
    throw new RangeError("Could not resolve the next hourly run.");
  }

  const [hour, minute] = parseTime(schedule.time);
  const startingLocalDate = zonedParts(new Date(after.getTime() + 60_000), schedule.timeZone);
  const localDateCursor = new Date(
    Date.UTC(startingLocalDate.year, startingLocalDate.month - 1, startingLocalDate.day),
  );
  for (let offset = 0; offset < 9; offset += 1) {
    const date = new Date(localDateCursor.getTime() + offset * 86_400_000);
    const localDate = {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
    const candidate = localTimeToInstant(localDate, hour, minute, schedule.timeZone);
    if (candidate === null || candidate <= after) continue;
    const weekday = zonedParts(candidate, schedule.timeZone).weekday;
    if (schedule.kind === "weekdays" && (weekday === "saturday" || weekday === "sunday")) {
      continue;
    }
    if (schedule.kind === "weekly" && weekday !== schedule.weekday) continue;
    return candidate;
  }
  throw new RangeError("Could not resolve the next automation run.");
}
