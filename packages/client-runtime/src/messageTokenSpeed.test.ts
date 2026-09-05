import { describe, expect, it } from "vite-plus/test";

import { messageTokenSpeed } from "./messageTokenSpeed.ts";

const reply = {
  role: "assistant" as const,
  text: "test".repeat(100),
  streaming: false,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T10:00:02.000Z",
};

describe("messageTokenSpeed", () => {
  it("estimates final reply delivery from persisted timestamps", () => {
    expect(messageTokenSpeed(reply)?.label).toBe("≈50.0 tok/s");
  });

  it.each(["user", "system"] as const)("does not measure %s messages", (role) => {
    expect(messageTokenSpeed({ ...reply, role })).toBeNull();
  });

  it("withholds the rate while streaming or when no text was returned", () => {
    expect(messageTokenSpeed({ ...reply, streaming: true })).toBeNull();
    expect(messageTokenSpeed({ ...reply, text: " \n\t" })).toBeNull();
  });

  it.each([
    "2026-09-05T10:00:00.000Z",
    "2026-09-05T10:00:00.999Z",
    "2026-09-05T09:59:59.000Z",
    "invalid",
  ])("avoids misleading rates for missing or insufficient timing: %s", (updatedAt) => {
    expect(messageTokenSpeed({ ...reply, updatedAt })?.label).toBe("Speed unavailable");
  });

  it("counts Unicode code points without treating surrogate pairs as two characters", () => {
    expect(messageTokenSpeed({ ...reply, text: "😀".repeat(400) })?.label).toBe("≈50.0 tok/s");
  });

  it("does not round a small positive rate to zero", () => {
    expect(
      messageTokenSpeed({ ...reply, text: "a", updatedAt: "2026-09-05T10:01:00.000Z" })?.label,
    ).toBe("≈<0.1 tok/s");
  });
});
