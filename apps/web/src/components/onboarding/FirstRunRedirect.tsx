import { useLocation, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useClientSettings, useClientSettingsHydrated } from "../../hooks/useSettings";
import { SETUP_COMPLETED_KEY } from "../../onboarding/firstRun";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";

/**
 * Only the empty home opens the Welcome page automatically; direct links always remain usable.
 * The page sets up this computer, so the hosted app without one never opens it.
 */
export function FirstRunRedirect() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const projects = useProjects();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const { isReady } = useEnvironments();
  const [completed] = useLocalStorage(SETUP_COMPLETED_KEY, false, Schema.Boolean);
  const settingsHydrated = useClientSettingsHydrated();
  const onboardingCompletedAt = useClientSettings((settings) => settings.onboardingCompletedAt);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const shouldOpen =
    pathname === "/" &&
    primaryEnvironmentId !== null &&
    !completed &&
    onboardingCompletedAt === null &&
    settingsHydrated &&
    isReady &&
    bootstrapped &&
    projects.length === 0;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- navigates from the empty home to /welcome once first-run evidence settles
  useEffect(() => {
    if (shouldOpen) void navigate({ to: "/welcome", replace: true });
  }, [navigate, shouldOpen]);

  return null;
}
