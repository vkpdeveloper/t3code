import { type GrokSettings, ProviderDriverKind, type RuntimeMode } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import { normalizeModelSlug } from "@t3tools/shared/model";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { trimmedUnknownString } from "./AcpUnknownPayload.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_API_KEY_ENV = "XAI_API_KEY";
const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const T3_CODE_OAUTH_REFERRER = "t3code";
const GROK_AUTH_METHOD_API_KEY = "xai.api_key";
const GROK_AUTH_METHOD_CACHED_TOKEN = "cached_token";
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
const GROK_STOCK_SESSION_COMPATIBILITY_GROUP = "grok-stock";
const GROK_STRICT_AGENT_TYPES = new Set(["codex", "grok-build-orchestrator"]);

type GrokAcpRuntimeGrokSettings = Pick<GrokSettings, "binaryPath">;

interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeGrokSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
}

export function grokAcpSpawnArgs(runtimeMode?: RuntimeMode): ReadonlyArray<string> {
  switch (runtimeMode) {
    case "approval-required":
      return ["--permission-mode", "default", "agent", "stdio"];
    case "auto-accept-edits":
      return ["--permission-mode", "acceptEdits", "agent", "stdio"];
    case "auto":
      return ["--permission-mode", "auto", "agent", "stdio"];
    case "full-access":
      return ["agent", "--always-approve", "stdio"];
    default:
      return ["agent", "stdio"];
  }
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeGrokSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: grokSettings?.binaryPath || "grok",
    args: [...grokAcpSpawnArgs(runtimeMode)],
    cwd,
    env: {
      ...environment,
      [GROK_OAUTH2_REFERRER_ENV]: T3_CODE_OAUTH_REFERRER,
    },
  };
}

function resolveGrokAuthMethodId(environment: NodeJS.ProcessEnv | undefined): string {
  return environment?.[GROK_API_KEY_ENV]?.trim()
    ? GROK_AUTH_METHOD_API_KEY
    : GROK_AUTH_METHOD_CACHED_TOKEN;
}

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(
          input.grokSettings,
          input.cwd,
          input.environment,
          input.runtimeMode,
        ),
        authMethodId: resolveGrokAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    return yield* makeXAiPromptCompletionRuntime(runtime);
  });

/**
 * T3's built-in Grok slug. It is the CLI's product name, not a model id the ACP accepts,
 * so selecting it means "use whatever model the Grok session currently runs on".
 */
export const GROK_DEFAULT_MODEL_SLUG = "grok-build";

export function resolveGrokAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : GROK_DEFAULT_MODEL_SLUG;
  return normalizeModelSlug(base, GROK_DRIVER_KIND) ?? GROK_DEFAULT_MODEL_SLUG;
}

export function grokAcpSessionCompatibilityGroup(
  agentType: string | undefined,
): string | undefined {
  if (!agentType) {
    return undefined;
  }
  // Grok Build treats every non-strict harness, including custom names, as
  // interchangeable. Strict harnesses can only switch to the same identity.
  return GROK_STRICT_AGENT_TYPES.has(agentType)
    ? `grok-strict:${agentType}`
    : GROK_STOCK_SESSION_COMPATIBILITY_GROUP;
}

export interface GrokAcpReasoningEffortOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault: boolean;
}

const GROK_REASONING_EFFORT_TOKEN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

export function isValidGrokReasoningEffortToken(value: string): boolean {
  return GROK_REASONING_EFFORT_TOKEN.test(value);
}

export function normalizeGrokReasoningEffort(value: string | undefined): string | undefined {
  const effort = value?.trim();
  return effort && isValidGrokReasoningEffortToken(effort) ? effort : undefined;
}

export interface GrokAcpModelMetadata {
  readonly agentType: string | undefined;
  readonly supportsReasoningEffort: boolean | undefined;
  readonly reasoningEffort: string | undefined;
  readonly reasoningEfforts: ReadonlyArray<GrokAcpReasoningEffortOption>;
  readonly totalContextTokens: number | undefined;
}

export function parseGrokAcpModelMetadata(meta: unknown): GrokAcpModelMetadata {
  if (!Predicate.isObject(meta)) {
    return {
      agentType: undefined,
      supportsReasoningEffort: undefined,
      reasoningEffort: undefined,
      reasoningEfforts: [],
      totalContextTokens: undefined,
    };
  }

  const seen = new Set<string>();
  const reasoningEfforts = Array.isArray(meta.reasoningEfforts)
    ? meta.reasoningEfforts.flatMap((raw) => {
        if (!Predicate.isObject(raw)) {
          return [];
        }
        const value = normalizeGrokReasoningEffort(trimmedUnknownString(raw.value));
        if (!value || seen.has(value)) {
          return [];
        }
        seen.add(value);
        const description = trimmedUnknownString(raw.description);
        return [
          {
            value,
            label: trimmedUnknownString(raw.label) ?? value,
            ...(description ? { description } : {}),
            isDefault: raw.default === true,
          } satisfies GrokAcpReasoningEffortOption,
        ];
      })
    : [];
  const totalContextTokens = meta.totalContextTokens;

  return {
    agentType: trimmedUnknownString(meta.agentType),
    supportsReasoningEffort:
      typeof meta.supportsReasoningEffort === "boolean" ? meta.supportsReasoningEffort : undefined,
    reasoningEffort: trimmedUnknownString(meta.reasoningEffort),
    reasoningEfforts,
    totalContextTokens:
      typeof totalContextTokens === "number" &&
      Number.isSafeInteger(totalContextTokens) &&
      totalContextTokens > 0
        ? totalContextTokens
        : undefined,
  };
}

export interface GrokAcpModelSelectionState {
  readonly modelId: string | undefined;
  readonly reasoningEffort: string | undefined;
}

export interface GrokAcpSessionModelState extends GrokAcpModelSelectionState {
  readonly totalContextTokens: number | undefined;
}

export function currentGrokModelSelectionFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): GrokAcpSessionModelState {
  const modelId = sessionSetupResult.models?.currentModelId?.trim() || undefined;
  const currentModel = sessionSetupResult.models?.availableModels.find(
    (model) => model.modelId.trim() === modelId,
  );
  const metadata = parseGrokAcpModelMetadata(currentModel?._meta);
  return {
    modelId,
    reasoningEffort: metadata.reasoningEffort,
    totalContextTokens: metadata.totalContextTokens,
  };
}

export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return currentGrokModelSelectionFromSessionSetup(sessionSetupResult).modelId;
}

export function currentGrokReasoningEffortFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  const modelState = sessionSetupResult.models;
  if (!modelState) {
    return undefined;
  }
  const currentModelId = modelState.currentModelId.trim();
  if (currentModelId.length === 0) {
    return undefined;
  }
  const currentModel = modelState.availableModels.find(
    (model) => model.modelId.trim() === currentModelId,
  );
  const reasoningEffort = currentModel?._meta?.reasoningEffort;
  return typeof reasoningEffort === "string"
    ? normalizeGrokReasoningEffort(reasoningEffort)
    : undefined;
}

export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly currentReasoningEffort?: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly requestedReasoningEffort?: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<GrokAcpModelSelectionState, E> {
  // The product slug is never sent over the wire; it keeps the session's current model.
  const requestedInput = input.requestedModelId?.trim() || undefined;
  const requestedModelId = requestedInput === GROK_DEFAULT_MODEL_SLUG ? undefined : requestedInput;
  const reasoningProvided = input.requestedReasoningEffort !== undefined;
  const requestedReasoningEffort = reasoningProvided
    ? normalizeGrokReasoningEffort(input.requestedReasoningEffort)
    : undefined;
  const targetModelId = requestedModelId ?? input.currentModelId;
  const modelChanged = requestedModelId !== undefined && requestedModelId !== input.currentModelId;
  const effortChanged =
    reasoningProvided && requestedReasoningEffort !== input.currentReasoningEffort;

  if ((!modelChanged && !effortChanged) || targetModelId === undefined) {
    return Effect.succeed({
      modelId: input.currentModelId,
      reasoningEffort: input.currentReasoningEffort,
    });
  }
  const reasoningMeta =
    reasoningProvided && requestedReasoningEffort !== undefined
      ? { reasoningEffort: requestedReasoningEffort }
      : undefined;
  // When reasoning was explicitly provided but invalid (normalize => undefined), we deliberately
  // send no meta so the invalid value is dropped rather than forwarded. When reasoning was not
  // provided at all, we also send no meta, but we only reach this call when the model itself
  // changed - an omitted reasoning preference must not be treated as an explicit clear of the
  // CLI-advertised default (e.g. Extra High) on same-model reselections.
  return input.runtime.setSessionModel(targetModelId, reasoningMeta).pipe(
    Effect.mapError(input.mapError),
    Effect.as({
      modelId: targetModelId,
      reasoningEffort: reasoningProvided
        ? requestedReasoningEffort
        : modelChanged
          ? undefined
          : input.currentReasoningEffort,
    }),
  );
}
