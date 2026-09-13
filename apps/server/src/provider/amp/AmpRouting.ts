import {
  AmpRoutingConnection,
  AmpRoutingError,
  type AmpRoutingAction,
  type AmpSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { runAmpCommand } from "../Layers/AmpProvider.ts";
import { AMP_ROUTING_LIST_ARGS } from "./AmpProtocol.ts";

const decodeConnections = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Array(AmpRoutingConnection)),
);
const isRoutingError = Schema.is(AmpRoutingError);

export function ampRoutingArgs(workspace: boolean, operation: AmpRoutingAction): string[] {
  if (operation.action === "add-router")
    return [
      "config",
      "model-providers",
      "add-router",
      operation.router,
      workspace ? "--workspace" : "--personal",
      "--name",
      operation.name,
      "--model-mapping",
      operation.modelMapping,
      "--api-key-env",
      operation.apiKeyEnvironmentVariable,
      operation.active ? "--active" : "--no-active",
      ...(operation.cloudflareAccountId
        ? ["--cloudflare-account-id", operation.cloudflareAccountId]
        : []),
      ...(operation.cloudflareGatewayId
        ? ["--cloudflare-gateway-id", operation.cloudflareGatewayId]
        : []),
      ...(operation.baseUrl ? ["--base-url", operation.baseUrl] : []),
      ...(operation.apiFormat ? ["--api-format", operation.apiFormat] : []),
    ];
  if (operation.action === "edit")
    return [
      "config",
      "model-providers",
      "edit-key",
      operation.id,
      "--name",
      operation.name,
      ...(operation.modelMapping === undefined
        ? []
        : operation.modelMapping
          ? ["--model-mapping", operation.modelMapping]
          : ["--clear-model-mapping"]),
    ];
  return ["config", "model-providers", operation.action, operation.id];
}
export const makeAmpRouting = (settings: AmpSettings, environment: NodeJS.ProcessEnv) => {
  const read = (workspace: boolean) =>
    Effect.gen(function* () {
      const result = yield* runAmpCommand(settings, environment, [
        ...AMP_ROUTING_LIST_ARGS,
        ...(workspace ? ["--workspace"] : []),
      ]);
      if (result.code !== 0)
        return yield* new AmpRoutingError({
          detail: "Amp could not list model connections. Check sign-in on this environment.",
        });
      const connections = yield* decodeConnections(result.stdout);
      return { connections };
    }).pipe(
      Effect.mapError(
        () => new AmpRoutingError({ detail: "Could not read Amp model connections." }),
      ),
    );
  const act = (workspace: boolean, operation: AmpRoutingAction) =>
    Effect.gen(function* () {
      // Resolve the connection in the selected scope before running a mutation.
      const current = yield* read(workspace);
      if (
        operation.action !== "add-router" &&
        !current.connections.some((connection) => connection.id === operation.id)
      )
        return yield* new AmpRoutingError({
          detail: "This connection is no longer available in the selected scope.",
        });
      if (operation.action === "add-router" && !environment[operation.apiKeyEnvironmentVariable])
        return yield* new AmpRoutingError({
          detail: "The API key environment variable is not set for this provider instance.",
        });
      const result = yield* runAmpCommand(
        settings,
        environment,
        ampRoutingArgs(workspace, operation),
      );
      if (result.code !== 0)
        return yield* new AmpRoutingError({ detail: "Amp rejected the model connection change." });
      return yield* read(workspace);
    }).pipe(
      Effect.mapError((error) =>
        isRoutingError(error)
          ? error
          : new AmpRoutingError({ detail: "Amp model connection operation failed." }),
      ),
    );
  return { read, act };
};
