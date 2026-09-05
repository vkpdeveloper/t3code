import {
  WS_METHODS,
  type AutomationRun,
  type EnvironmentId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

// Run status records dispatch. The thread carries the current execution outcome.
export function automationRunStatusLabel(
  run: AutomationRun,
  thread: Pick<
    OrchestrationThreadShell,
    "latestTurn" | "session" | "hasPendingApprovals" | "hasPendingUserInput" | "usageLimitWait"
  > | null,
): string {
  if (run.status === "failed") return "Failed";
  if (thread?.hasPendingApprovals) return "Awaiting approval";
  if (thread?.hasPendingUserInput) return "Awaiting input";
  if (thread?.usageLimitWait) return "Waiting for usage limit";
  if (thread?.session?.status === "error") return "Failed";
  if (thread?.session?.status === "starting") return "Starting";
  if (thread?.session?.status === "running") return "Running";
  switch (thread?.latestTurn?.state) {
    case "completed":
      return "Completed";
    case "error":
      return "Failed";
    case "interrupted":
      return "Interrupted";
    case "running":
      return "Running";
  }
  return run.status === "pending" ? "Queued" : "Started";
}

export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:automations:list",
    tag: WS_METHODS.automationsList,
    staleTimeMs: 5_000,
  });
  const refreshList = (
    { environmentId }: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(list({ environmentId, input: {} })));
  const concurrency = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;
  return {
    list,
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:create",
      tag: WS_METHODS.automationsCreate,
      scheduler,
      concurrency,
      onSuccess: refreshList,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:update",
      tag: WS_METHODS.automationsUpdate,
      scheduler,
      concurrency,
      onSuccess: refreshList,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:delete",
      tag: WS_METHODS.automationsDelete,
      scheduler,
      concurrency,
      onSuccess: refreshList,
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:automations:run-now",
      tag: WS_METHODS.automationsRunNow,
      scheduler,
      concurrency,
      onSuccess: refreshList,
    }),
  };
}
