import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "./providerInstance.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AmpRoutingConnection = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  type: Schema.String,
  active: Schema.Boolean,
  priority: Schema.Finite,
  config: Schema.Struct({
    accountEmail: Schema.optional(Schema.String),
    modelMapping: Schema.optional(Schema.Unknown),
  }),
  warnings: Schema.optional(Schema.Array(Schema.Unknown)),
});
export type AmpRoutingConnection = typeof AmpRoutingConnection.Type;
export const AmpRoutingSnapshot = Schema.Struct({
  connections: Schema.Array(AmpRoutingConnection),
});
export type AmpRoutingSnapshot = typeof AmpRoutingSnapshot.Type;
export const AmpRoutingInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  workspace: Schema.Boolean,
});
export const AmpRoutingAction = Schema.Union([
  Schema.Struct({
    action: Schema.Literals(["activate", "deactivate", "test", "delete"]),
    id: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    action: Schema.Literal("edit"),
    id: TrimmedNonEmptyString,
    name: TrimmedNonEmptyString,
    modelMapping: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literal("add-router"),
    router: Schema.Literals([
      "openrouter",
      "ollama-cloud",
      "vercel",
      "cloudflare",
      "opencode-go",
      "custom-url",
    ]),
    name: TrimmedNonEmptyString,
    modelMapping: TrimmedNonEmptyString,
    apiKeyEnvironmentVariable: TrimmedNonEmptyString.check(
      Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/),
    ),
    active: Schema.Boolean,
    cloudflareAccountId: Schema.optional(TrimmedNonEmptyString),
    cloudflareGatewayId: Schema.optional(TrimmedNonEmptyString),
    baseUrl: Schema.optional(TrimmedNonEmptyString),
    apiFormat: Schema.optional(
      Schema.Literals(["chat-completions", "responses", "anthropic-messages"]),
    ),
  }),
]);
export type AmpRoutingAction = typeof AmpRoutingAction.Type;
export const AmpRoutingActionInput = Schema.Struct({
  ...AmpRoutingInput.fields,
  operation: AmpRoutingAction,
});
export class AmpRoutingError extends Schema.TaggedError<AmpRoutingError>()("AmpRoutingError", {
  detail: Schema.String,
}) {}
