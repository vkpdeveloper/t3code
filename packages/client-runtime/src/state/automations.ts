import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

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
