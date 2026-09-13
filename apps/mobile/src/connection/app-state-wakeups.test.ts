import { describe, expect, it } from "@effect/vitest";

import {
  MOBILE_BACKGROUND_RESUME_AFTER_MS,
  mobileApplicationActiveWakeup,
} from "./app-state-wakeups";

describe("mobileApplicationActiveWakeup", () => {
  it("uses a fast probe after a short interruption", () => {
    expect(mobileApplicationActiveWakeup(null, 20_000, "android")).toBe("application-active-probe");
    expect(
      mobileApplicationActiveWakeup(
        20_000,
        20_000 + MOBILE_BACKGROUND_RESUME_AFTER_MS - 1,
        "android",
      ),
    ).toBe("application-active-probe");
  });

  it("signals a long resume so stalled connection setup can be restarted", () => {
    expect(
      mobileApplicationActiveWakeup(20_000, 20_000 + MOBILE_BACKGROUND_RESUME_AFTER_MS, "android"),
    ).toBe("android-application-resume");
  });
  it("preserves the existing iOS long-resume reconnect", () => {
    expect(mobileApplicationActiveWakeup(0, MOBILE_BACKGROUND_RESUME_AFTER_MS, "ios")).toBe(
      "application-active-reconnect",
    );
    expect(mobileApplicationActiveWakeup(0, 1, "ios")).toBe("application-active-probe");
  });
});
