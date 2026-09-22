import type { VibeProxySettings, VibeProxyUsageResult } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  readMobileVibeProxyUsage,
  refreshMobileVibeProxyUsage,
  updateMobileVibeProxySettings,
  type VibeProxySettingsPatch,
} from "./vibeProxyUsageClient";

type SettingsUpdateOutcome = { readonly _tag: "Success" } | { readonly _tag: "Failure" };

export interface VibeProxyUsageView {
  readonly settings: VibeProxySettings;
  readonly result: VibeProxyUsageResult | null;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly updateSettings: (patch: VibeProxySettingsPatch) => Promise<SettingsUpdateOutcome>;
}

const DEFAULT_SETTINGS: VibeProxySettings = {
  enabled: false,
  baseUrl: "",
  apiKey: "",
  apiKeyRedacted: false,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export function useVibeProxyUsage(): VibeProxyUsageView {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [result, setResult] = useState<VibeProxyUsageResult | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    setIsRefreshing(true);
    setError(null);
    try {
      const next = await refreshMobileVibeProxyUsage();
      if (!mounted.current || generation.current !== currentGeneration) return;
      setSettings(next.settings);
      setResult(next.result);
    } catch (cause) {
      if (!mounted.current || generation.current !== currentGeneration) return;
      setError(errorMessage(cause, "Could not refresh usages."));
    } finally {
      if (mounted.current && generation.current === currentGeneration) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void readMobileVibeProxyUsage()
      .then((next) => {
        if (!active) return;
        setSettings(next.settings);
        setResult(next.result);
        if (next.result.status === "ready") void refresh();
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, "Could not load usage settings."));
      });
    return () => {
      active = false;
      mounted.current = false;
      generation.current += 1;
    };
  }, [refresh]);

  const updateSettings = useCallback(
    async (patch: VibeProxySettingsPatch): Promise<SettingsUpdateOutcome> => {
      try {
        const next = await updateMobileVibeProxySettings(patch);
        if (mounted.current) {
          setSettings(next.settings);
          setResult(next.result);
          setError(null);
        }
        return { _tag: "Success" };
      } catch (cause) {
        if (mounted.current) {
          setError(errorMessage(cause, "Could not save usage settings."));
        }
        return { _tag: "Failure" };
      }
    },
    [],
  );

  return { settings, result, isRefreshing, error, refresh, updateSettings };
}
