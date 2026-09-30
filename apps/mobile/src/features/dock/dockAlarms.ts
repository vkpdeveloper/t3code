export interface DockAlarmTime {
  readonly hour: number;
  readonly minute: number;
}

const TIME_OF_DAY = /^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(?:([ap])\.?\s*m\.?)?$/i;

function parseAlarmTime(value: string): DockAlarmTime | null {
  // Shortcuts' "Format Date" output depends on the user's locale, so accept
  // 24-hour and 12-hour times, plus full ISO dates as a fallback. iOS puts a
  // narrow no-break space before AM/PM.
  const text = value.replace(/[\u00a0\u202f]/g, " ").trim();
  const match = TIME_OF_DAY.exec(text);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridiem = match[3]?.toLowerCase();
    if (meridiem !== undefined) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
    }
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  if (!text.includes("T")) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return { hour: date.getHours(), minute: date.getMinutes() };
}

/**
 * Parses the `alarms` query parameter sent by the Dock mode Shortcuts
 * automation. Unreadable entries are skipped so one odd value cannot hide the
 * rest.
 */
export function parseDockAlarmTimes(raw: string | undefined): ReadonlyArray<DockAlarmTime> {
  if (!raw) return [];
  const times: DockAlarmTime[] = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const time = parseAlarmTime(part);
    if (time && !times.some((t) => t.hour === time.hour && t.minute === time.minute)) {
      times.push(time);
    }
  }
  return times;
}

/**
 * The next time any alarm will ring after `now`. Clock alarms carry no repeat
 * days through Shortcuts, so each one is treated as ringing daily.
 */
export function nextDockAlarm(times: ReadonlyArray<DockAlarmTime>, now: Date): Date | null {
  let next: Date | null = null;
  for (const time of times) {
    const candidate = new Date(now);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    if (next === null || candidate.getTime() < next.getTime()) {
      next = candidate;
    }
  }
  return next;
}

/** "in 7h 5m", "in 45m", or "now" once under a minute remains. */
export function formatDockAlarmCountdown(alarm: Date, now: Date): string {
  const totalMinutes = Math.ceil((alarm.getTime() - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return "now";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `in ${minutes}m`;
  return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
}

/** Dock mode always shows 24-hour time ("07:05", "23:40"), whatever the locale. */
export function formatDockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
