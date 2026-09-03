import { createAutomationEnvironmentAtoms } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime);

export function useAutomations(environmentId: EnvironmentId) {
  return useEnvironmentQuery(automationEnvironment.list({ environmentId, input: {} }));
}
