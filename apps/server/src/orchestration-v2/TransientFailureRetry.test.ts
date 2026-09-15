import { describe, expect, it } from "vite-plus/test";

import { isRetryableRunFailure } from "./TransientFailureRetryService.ts";

describe("isRetryableRunFailure", () => {
  const base = {
    code: null,
    retryable: null,
  };

  it("retries transport and capacity failures", () => {
    for (const failure of [
      { ...base, class: "transport_error" as const, message: "fetch failed" },
      { ...base, class: "provider_error" as const, message: "Claude API overloaded (529)" },
      { ...base, class: "provider_error" as const, message: "Request timed out" },
      { ...base, class: "unknown" as const, message: "ECONNRESET", retryable: true },
    ]) {
      expect(isRetryableRunFailure(failure), failure.message).toBe(true);
    }
  });

  it("never retries usage-limit waits, auth, billing, or validation", () => {
    for (const failure of [
      { ...base, class: "usage_limit" as const, message: "429 too many requests" },
      { ...base, class: "permission_error" as const, message: "forbidden", retryable: true },
      { ...base, class: "validation_error" as const, message: "invalid request" },
      { ...base, class: "provider_error" as const, message: "credit balance too low" },
      { ...base, class: "provider_error" as const, message: "invalid API key" },
      { ...base, class: "provider_error" as const, message: "timeout", retryable: false },
    ]) {
      expect(isRetryableRunFailure(failure), failure.message).toBe(false);
    }
  });

  it("treats unknown messages without a hint as non-retryable", () => {
    expect(
      isRetryableRunFailure({ ...base, class: "provider_error" as const, message: "???" }),
    ).toBe(false);
    expect(isRetryableRunFailure(null)).toBe(false);
  });
});
