/**
 * DevinAcpSupport — spawn, mode, and model helpers for the Devin CLI (`devin acp`).
 *
 * Devin is a stock ACP agent: models and modes arrive as standard session
 * `configOptions`, so this module has no extension protocol to speak of. It
 * exists to keep three Devin-specific decisions in one place:
 *
 * - The runtime never sends `authenticate`. Devin's only advertised auth method
 *   (`devin-browser`) starts a browser PKCE flow on every call, even when the CLI
 *   already holds credentials from `devin auth login`.
 * - Devin's permission modes do not line up with the generic ACP alias resolver,
 *   which would map Approval Required onto Devin's read-only Ask mode.
 * - The model catalog is read from the session's `model` config option and
 *   nowhere else, so the picker only ever shows models this account can use.
 *
 * @module provider/acp/DevinAcpSupport
 */
import {
  DEVIN_DEFAULT_MODEL,
  type DevinSettings,
  type ModelCapabilities,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import type { AcpSessionModeState } from "./AcpRuntimeModel.ts";

export const DEVIN_DEFAULT_MODEL_SLUG = DEVIN_DEFAULT_MODEL;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

type DevinAcpRuntimeDevinSettings = Pick<DevinSettings, "binaryPath">;

export interface DevinAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly devinSettings: DevinAcpRuntimeDevinSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function buildDevinAcpSpawnInput(
  devinSettings: DevinAcpRuntimeDevinSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: devinSettings?.binaryPath || "devin",
    args: ["acp"],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export const makeDevinAcpRuntime = (
  input: DevinAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildDevinAcpSpawnInput(input.devinSettings, input.cwd, input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

/**
 * Removes a session from Devin's local session database. Probe and text
 * generation sessions would otherwise pile up in `devin ls`.
 */
export const deleteDevinAcpSession = (
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "request">,
  sessionId: string,
): Effect.Effect<void> =>
  runtime.request("session/delete", { sessionId }).pipe(Effect.ignore, Effect.asVoid);

// Preference order per T3 mode. Devin's ids come first; the generic names cover
// the shared mock agent and future renames. Ask mode is deliberately absent: it
// is read-only and would silently drop code changes.
const DEVIN_MODE_PREFERENCES: Record<RuntimeMode, ReadonlyArray<string>> = {
  "full-access": ["bypass", "bypass permissions", "yolo", "code"],
  auto: ["smart", "code"],
  "auto-accept-edits": ["accept-edits", "code"],
  "approval-required": ["accept-edits", "code"],
};
const DEVIN_PLAN_MODE_PREFERENCES: ReadonlyArray<string> = ["plan", "architect"];

export function resolveDevinAcpModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modes = input.modeState?.availableModes;
  if (!modes || modes.length === 0) {
    return undefined;
  }
  const preferences =
    input.interactionMode === "plan"
      ? DEVIN_PLAN_MODE_PREFERENCES
      : DEVIN_MODE_PREFERENCES[input.runtimeMode];
  for (const preferred of preferences) {
    const match = modes.find(
      (mode) => mode.id.toLowerCase() === preferred || mode.name.trim().toLowerCase() === preferred,
    );
    if (match) {
      return match.id;
    }
  }
  return undefined;
}

/** Devin's Ask mode answers without tools; text generation runs there so it cannot edit files. */
export function resolveDevinAcpReadOnlyModeId(
  modeState: AcpSessionModeState | undefined,
): string | undefined {
  return modeState?.availableModes.find(
    (mode) => mode.id.toLowerCase() === "ask" || mode.name.trim().toLowerCase() === "ask",
  )?.id;
}

export function findDevinModelConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions?.find((option) => option.category === "model" && option.type === "select");
}

/**
 * Models advertised by the session's `model` config option. The current value is
 * marked default. Grouped select entries are flattened so a grouped catalog reads
 * the same as a flat one.
 */
export function buildDevinModelsFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  const modelOption = findDevinModelConfigOption(configOptions);
  if (!modelOption || modelOption.type !== "select") {
    return [];
  }
  const currentValue = modelOption.currentValue.trim();
  const seen = new Set<string>();
  const models: Array<ServerProviderModel> = [];
  const entries = modelOption.options.flatMap((entry) =>
    "value" in entry ? [entry] : entry.options,
  );
  for (const entry of entries) {
    const slug = entry.value.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    models.push({
      slug,
      name: entry.name.trim() || slug,
      isCustom: false,
      ...(slug === currentValue ? { isDefault: true } : {}),
      capabilities: EMPTY_CAPABILITIES,
    });
  }
  return models;
}

export function resolveDevinAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEVIN_DEFAULT_MODEL_SLUG;
}

/**
 * Selects the requested model through the session's model config option. The
 * default slug is T3's placeholder for "whatever the session runs on" and is
 * never sent over the wire.
 */
export function applyDevinAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setModel">;
  readonly model: string | null | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<void, E> {
  const model = resolveDevinAcpBaseModelId(input.model);
  if (model === DEVIN_DEFAULT_MODEL_SLUG) {
    return Effect.void;
  }
  return input.runtime.setModel(model).pipe(Effect.mapError(input.mapError));
}
