/**
 * DevinProvider — health check and model discovery for the Devin CLI.
 *
 * The probe runs `devin --version`, then `devin auth status`, then opens one
 * short-lived ACP session to read the account's model catalog from the session's
 * `model` config option. That option is the only source of truth for the picker:
 * `devin models list` prints the whole catalog including models the account
 * cannot use, while the session only advertises what a prompt would accept.
 *
 * @module provider/Layers/DevinProvider
 */
import {
  type CustomModelSetting,
  type DevinSettings,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderAuth,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  AUTH_PROBE_TIMEOUT_MS,
  buildServerProvider,
  COMPACT_SLASH_COMMAND,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  buildDevinModelsFromConfigOptions,
  deleteDevinAcpSession,
  DEVIN_DEFAULT_MODEL_SLUG,
  makeDevinAcpRuntime,
} from "../acp/DevinAcpSupport.ts";

const DEVIN_PRESENTATION = {
  displayName: "Devin",
  badgeLabel: "Early Access",
  supportsConversationRollback: false,
  showInteractionModeToggle: false,
  reportsContextWindow: true,
  requiresNewThreadForModelChange: false,
} as const;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

const VERSION_PROBE_TIMEOUT_MS = 4_000;
// One local `initialize` plus `session/new`. Session setup boots the user's MCP
// servers, so it is slower than a bare initialize.
const DEVIN_ACP_DISCOVERY_TIMEOUT_MS = 20_000;
const DEVIN_ACP_DISCOVERY_FAILED_MESSAGE =
  "Devin CLI is installed but ACP model discovery failed. Model options may be incomplete.";

/** Shown when the session catalog is unavailable; keeps the session's current model. */
const DEVIN_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: DEVIN_DEFAULT_MODEL_SLUG,
    name: "Devin default",
    isCustom: false,
    isDefault: true,
    capabilities: EMPTY_CAPABILITIES,
  },
];

function devinModelsFromSettings(
  customModels: ReadonlyArray<CustomModelSetting> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = DEVIN_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(builtInModels, customModels ?? [], EMPTY_CAPABILITIES);
}

export function buildInitialDevinProviderSnapshot(
  devinSettings: DevinSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = devinModelsFromSettings(devinSettings.customModels);
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: devinSettings.enabled,
      checkedAt,
      models,
      probe: {
        installed: devinSettings.enabled,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: devinSettings.enabled
          ? "Checking Devin CLI availability..."
          : "Devin is disabled in T3 Code settings.",
      },
    });
  });
}

export interface DevinAuthStatusOutput {
  /** True or false when the CLI printed a login verdict, null when it printed neither. */
  readonly authenticated: boolean | null;
  readonly email: string | undefined;
  readonly plan: string | undefined;
}

/**
 * Parses `devin auth status`. Current output starts with `Logged in (via Devin).`
 * followed by indented `Key: value` lines such as `Email:` and `Tier:`.
 */
export function parseDevinAuthStatusOutput(output: string): DevinAuthStatusOutput {
  const authenticated = /^\s*logged in\b/im.test(output)
    ? true
    : /not logged in|not authenticated|no credentials|logged out|devin auth login/i.test(output)
      ? false
      : null;
  const field = (name: string): string | undefined =>
    new RegExp(`^\\s*${name}:\\s*(.+)$`, "im").exec(output)?.[1]?.trim() || undefined;
  return {
    authenticated,
    email: field("Email"),
    plan: field("Tier") ?? field("Plan"),
  };
}

const runDevinCliCommand = (
  devinSettings: DevinSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
) =>
  Effect.gen(function* () {
    const command = devinSettings.binaryPath || "devin";
    const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

/**
 * Opens a throwaway ACP session, reads the model catalog from its config options,
 * then deletes the session so it does not linger in `devin ls`.
 */
export const discoverDevinModelsViaAcp = (
  devinSettings: DevinSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acp = yield* makeDevinAcpRuntime({
      devinSettings,
      environment,
      childProcessSpawner,
      cwd,
      clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* acp.start();
    const models = buildDevinModelsFromConfigOptions(yield* acp.getConfigOptions);
    yield* deleteDevinAcpSession(acp, started.sessionId);
    return models;
  }).pipe(Effect.scoped);

export const checkDevinProviderStatus = Effect.fn("checkDevinProviderStatus")(function* (
  devinSettings: DevinSettings,
  environment: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = devinModelsFromSettings(devinSettings.customModels);

  if (!devinSettings.enabled) {
    return yield* buildInitialDevinProviderSnapshot(devinSettings);
  }

  const versionResult = yield* runDevinCliCommand(devinSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    yield* Effect.logWarning("Devin CLI health check failed.", { errorTag: error._tag });
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Devin CLI (`devin`) is not installed or not on PATH."
          : "Failed to execute Devin CLI health check.",
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Devin CLI is installed but timed out while running `devin --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    yield* Effect.logWarning("Devin CLI version probe exited with a non-zero status.", {
      exitCode: versionOutput.code,
    });
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Devin CLI is installed but failed to run.",
      },
    });
  }

  const authResult = yield* runDevinCliCommand(devinSettings, ["auth", "status"], environment).pipe(
    Effect.timeoutOption(AUTH_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  const authOutput =
    Result.isSuccess(authResult) && Option.isSome(authResult.success)
      ? authResult.success.value
      : undefined;
  // `devin auth status` exits non-zero when logged out but still prints the verdict.
  const parsedAuth = authOutput
    ? parseDevinAuthStatusOutput(`${authOutput.stdout}\n${authOutput.stderr}`)
    : { authenticated: null, email: undefined, plan: undefined };
  if (!authOutput) {
    yield* Effect.logWarning("Devin CLI auth status probe failed or timed out.");
  }

  const auth: ServerProviderAuth =
    parsedAuth.authenticated === true
      ? {
          status: "authenticated",
          type: "cached_token",
          label: parsedAuth.plan ?? "Devin account",
          ...(parsedAuth.email ? { email: parsedAuth.email } : {}),
        }
      : parsedAuth.authenticated === false
        ? { status: "unauthenticated" }
        : { status: "unknown" };

  if (auth.status === "unauthenticated") {
    return buildServerProvider({
      presentation: DEVIN_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth,
        message: "Devin CLI is installed but not logged in. Run `devin auth login`.",
      },
    });
  }

  const discoveryExit = yield* discoverDevinModelsViaAcp(devinSettings, environment, cwd).pipe(
    Effect.timeoutOption(DEVIN_ACP_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );
  const discoveredModels = Exit.isSuccess(discoveryExit)
    ? Option.getOrElse(discoveryExit.value, () => [])
    : [];
  const discoveryFailed =
    Exit.isFailure(discoveryExit) ||
    Option.isNone(discoveryExit.value) ||
    discoveredModels.length === 0;
  if (discoveryFailed) {
    yield* Effect.logWarning("Devin ACP model discovery failed, timed out, or was empty.", {
      errorTag: Exit.isFailure(discoveryExit) ? causeErrorTag(discoveryExit.cause) : "Timeout",
    });
  }

  return buildServerProvider({
    presentation: DEVIN_PRESENTATION,
    enabled: true,
    checkedAt,
    models: discoveryFailed
      ? fallbackModels
      : devinModelsFromSettings(devinSettings.customModels, discoveredModels),
    slashCommands: [COMPACT_SLASH_COMMAND],
    probe: {
      installed: true,
      version,
      // A failed catalog probe degrades the model picker; chats still work on the session default.
      status: discoveryFailed ? "warning" : "ready",
      auth,
      ...(discoveryFailed ? { message: DEVIN_ACP_DISCOVERY_FAILED_MESSAGE } : {}),
    },
  });
});

export const enrichDevinSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => input.publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Devin version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
