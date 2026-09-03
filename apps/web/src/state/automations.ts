import { createAutomationEnvironmentAtoms } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime);

export function useAutomations(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null ? null : automationEnvironment.list({ environmentId, input: {} }),
  );
}
