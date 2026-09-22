import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  readMobileVibeProxyUsage,
  refreshMobileVibeProxyUsage,
  updateMobileVibeProxySettings,
} from "./vibeProxyUsageClient";

function memoryStorage() {
  let value: string | null = null;
  return {
    getItemAsync: vi.fn(async () => value),
    setItemAsync: vi.fn(async (_key: string, next: string) => {
      value = next;
    }),
    read: () => value,
  };
}

function memoryCache() {
  let value: string | null = null;
  return {
    read: vi.fn(async () => value),
    write: vi.fn(async (next: string) => {
      value = next;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
  };
}

describe("mobile Vibe-Proxy usage client", () => {
  it("keeps its API key on-device and returns only a redacted setting", async () => {
    const storage = memoryStorage();
    const cache = memoryCache();
    const configured = await updateMobileVibeProxySettings(
      {
        enabled: true,
        baseUrl: " https://proxy.example.com ",
        apiKey: " mobile-key ",
      },
      { storage, cache },
    );

    expect(configured.settings).toEqual({
      enabled: true,
      baseUrl: "https://proxy.example.com",
      apiKey: "",
      apiKeyRedacted: true,
    });
    expect((await readMobileVibeProxyUsage({ storage, cache })).settings).toEqual(
      configured.settings,
    );
    expect(storage.read()).toContain("mobile-key");
  });

  it("fetches and caches usage directly with the stored mobile credential", async () => {
    const storage = memoryStorage();
    const cache = memoryCache();
    await updateMobileVibeProxySettings(
      { enabled: true, baseUrl: "https://proxy.example.com", apiKey: "mobile-key" },
      { storage, cache },
    );
    const fetchDirect = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            files: [
              {
                id: "cursor.json",
                provider: "cursor",
                status: "active",
                success: 4,
                failed: 0,
                quota_capacity: {
                  provider: "cursor",
                  supported: true,
                  windows: [
                    {
                      id: "weekly",
                      label: "Weekly",
                      used_percent: 10,
                      remaining_percent: 90,
                      known: true,
                      routing: true,
                    },
                    {
                      id: "monthly",
                      label: "Monthly",
                      used_percent: 25,
                      remaining_percent: 75,
                      known: true,
                      routing: false,
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const refreshed = await refreshMobileVibeProxyUsage({
      storage,
      cache,
      fetch: fetchDirect as typeof fetch,
      now: () => new Date("2026-09-22T10:00:00.000Z"),
    });

    expect(fetchDirect).toHaveBeenCalledWith(
      "https://proxy.example.com/api/v0/management/auth-files",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer mobile-key" }),
      }),
    );
    expect(refreshed.result).toMatchObject({
      status: "ready",
      refreshed: true,
      snapshot: { fetchedAt: "2026-09-22T10:00:00.000Z" },
    });
    expect(
      (await readMobileVibeProxyUsage({ storage, cache })).result.snapshot?.accounts[0]?.provider,
    ).toBe("cursor");
    expect(
      refreshed.result.snapshot?.accounts[0]?.quotaCapacity?.windows.map((window) => window.label),
    ).toEqual(["Weekly", "Monthly"]);
  });

  it("keeps the last snapshot visible when a direct refresh fails", async () => {
    const storage = memoryStorage();
    const cache = memoryCache();
    await updateMobileVibeProxySettings(
      { enabled: true, baseUrl: "https://proxy.example.com", apiKey: "mobile-key" },
      { storage, cache },
    );
    await refreshMobileVibeProxyUsage({
      storage,
      cache,
      fetch: (async () =>
        new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
      now: () => new Date("2026-09-22T10:00:00.000Z"),
    });

    const failed = await refreshMobileVibeProxyUsage({
      storage,
      cache,
      fetch: (async () => new Response(null, { status: 401 })) as typeof fetch,
    });

    expect(failed.result.snapshot?.fetchedAt).toBe("2026-09-22T10:00:00.000Z");
    expect(failed.result.refreshProblem?.reason).toBe("unauthorized");
  });
});
