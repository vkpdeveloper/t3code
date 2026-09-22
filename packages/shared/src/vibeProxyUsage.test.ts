import type { VibeProxySettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  normalizeVibeProxyAuthFiles,
  resolveVibeProxyAuthFilesUrl,
  vibeProxyConfigurationKey,
} from "./vibeProxyUsage.ts";

function settings(overrides: Partial<VibeProxySettings> = {}): VibeProxySettings {
  return {
    enabled: true,
    baseUrl: "https://vibe-proxy.example.com",
    apiKey: "",
    apiKeyRedacted: true,
    ...overrides,
  };
}

describe("shared vibeProxyConfigurationKey", () => {
  it("requires an enabled integration, base URL, and stored or entered key", () => {
    expect(vibeProxyConfigurationKey(settings())).toBe("https://vibe-proxy.example.com:stored");
    expect(vibeProxyConfigurationKey(settings({ enabled: false }))).toBeNull();
    expect(vibeProxyConfigurationKey(settings({ baseUrl: "" }))).toBeNull();
    expect(vibeProxyConfigurationKey(settings({ apiKeyRedacted: false }))).toBeNull();
  });

  it("changes when a newly entered key changes length", () => {
    expect(vibeProxyConfigurationKey(settings({ apiKey: "secret", apiKeyRedacted: false }))).toBe(
      "https://vibe-proxy.example.com:6",
    );
  });
});

describe("shared Vibe-Proxy client helpers", () => {
  it("resolves the management endpoint and rejects unsafe base URLs", () => {
    expect(resolveVibeProxyAuthFilesUrl("https://proxy.example.com/base/?token=private#part")).toBe(
      "https://proxy.example.com/base/api/v0/management/auth-files",
    );
    expect(resolveVibeProxyAuthFilesUrl("ftp://proxy.example.com")).toBeNull();
    expect(resolveVibeProxyAuthFilesUrl("https://user:pass@proxy.example.com")).toBeNull();
  });

  it("normalizes display data without retaining upstream credential metadata", () => {
    const snapshot = normalizeVibeProxyAuthFiles(
      {
        files: [
          {
            id: "cursor-person.json",
            provider: "cursor",
            account: "person@example.com",
            path: "/private/credential.json",
            auth_index: "private-index",
            status: "active",
            success: 3,
            failed: 1,
            quota_capacity: {
              provider: "cursor",
              supported: true,
              windows: [
                {
                  id: "weekly",
                  label: "Weekly",
                  used_percent: 25,
                  remaining_percent: 75,
                  known: true,
                  routing: true,
                },
              ],
            },
          },
        ],
      },
      "2026-09-22T10:00:00.000Z",
    );

    expect(snapshot?.accounts[0]).toMatchObject({
      id: "cursor-person.json",
      provider: "cursor",
      success: 3,
      failed: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain("/private/credential.json");
    expect(JSON.stringify(snapshot)).not.toContain("private-index");
  });
});
