import { createFileRoute } from "@tanstack/react-router";
import { AutomationId, EnvironmentId } from "@t3tools/contracts";

import { AutomationsPage } from "../components/automations/AutomationsPage";

export const Route = createFileRoute("/automations")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.automationId === "string" && raw.automationId.trim()
      ? { automationId: AutomationId.make(raw.automationId) }
      : {}),
  }),
  component: AutomationsPage,
});
