/**
 * DevinAcpSupport — spawn, mode, and model helpers for the Devin CLI (`devin acp`).
 *
 * Devin uses ACP for sessions and standard `configOptions` for modes. Its model
 * catalog is probed through the CLI. This module keeps three Devin-specific
 * decisions in one place:
 *
 * - The runtime never sends `authenticate`. Devin's only advertised auth method
 *   (`devin-browser`) starts a browser PKCE flow on every call, even when the CLI
 *   already holds credentials from `devin auth login`.
 * - Devin's permission modes do not line up with the generic ACP alias resolver,
 *   which would map Approval Required onto Devin's read-only Ask mode.
 * - Devin 3000.11.3 can leave the ACP model option empty. Model selection for
 *   new sessions is passed to `devin acp --model` before `session/new`.
 *
 * @module provider/acp/DevinAcpSupport
 */
import {
  DEVIN_DEFAULT_MODEL,
  type DevinSettings,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import type { AcpSessionModeState } from "./AcpRuntimeModel.ts";

export const DEVIN_DEFAULT_MODEL_SLUG = DEVIN_DEFAULT_MODEL;

type DevinAcpRuntimeDevinSettings = Pick<DevinSettings, "binaryPath">;

export interface DevinAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly devinSettings: DevinAcpRuntimeDevinSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly model?: string | undefined;
}

export function buildDevinAcpSpawnInput(
  devinSettings: DevinAcpRuntimeDevinSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  model?: string,
): AcpSessionRuntime.AcpSpawnInput {
  const selectedModel = resolveDevinAcpBaseModelId(model);
  return {
    command: devinSettings?.binaryPath || "devin",
    args: selectedModel === DEVIN_DEFAULT_MODEL_SLUG ? ["acp"] : ["acp", "--model", selectedModel],
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
        spawn: buildDevinAcpSpawnInput(
          input.devinSettings,
          input.cwd,
          input.environment,
          input.model,
        ),
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

export function resolveDevinAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEVIN_DEFAULT_MODEL_SLUG;
}
