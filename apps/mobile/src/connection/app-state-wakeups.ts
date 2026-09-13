import type { Wakeups } from "@t3tools/client-runtime/connection";

// Long resumes also restart connection setup that may have stalled while suspended.
export const MOBILE_BACKGROUND_RESUME_AFTER_MS = 10_000;

export type MobileApplicationActiveWakeup = Extract<
  Wakeups.ConnectionWakeup,
  "application-active-probe" | "application-active-reconnect" | "android-application-resume"
>;

export function mobileApplicationActiveWakeup(
  backgroundedAtMs: number | null,
  activeAtMs: number,
  platform: string,
): MobileApplicationActiveWakeup {
  if (
    backgroundedAtMs === null ||
    activeAtMs - backgroundedAtMs < MOBILE_BACKGROUND_RESUME_AFTER_MS
  ) {
    return "application-active-probe";
  }
  return platform === "android" ? "android-application-resume" : "application-active-reconnect";
}
