/**
 * DevinAdapterV2 — ACP-flavored adapter for the Devin CLI (`devin acp`).
 *
 * Devin is a stock ACP agent with three quirks this flavor carries:
 *
 * - It never receives `authenticate`: its only advertised method opens a
 *   browser PKCE flow even when the CLI already holds credentials, so both
 *   eager and on-required authentication stay off.
 * - Its ask-user-question tool arrives as `elicitation/create` (with
 *   `_session/elicitation` as the older alias) instead of the spec's
 *   `session/elicitation`, so both are registered as extension requests.
 * - Its model catalog lands in the session `model` config option after
 *   `session/new` returns, so model selection waits for the real catalog
 *   before calling `setModel`.
 *
 * @module orchestration-v2/Adapters/DevinAdapterV2
 */
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import {
  defaultInstanceIdForDriver,
  DevinSettings,
  ProviderDriverKind,
  type OrchestrationV2ProviderCapabilities,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import { ServerConfig } from "../../config.ts";
import { makeAcpNativeLoggerFactory } from "../../provider/acp/AcpNativeLogging.ts";
import type { AcpSessionModeState } from "../../provider/acp/AcpRuntimeModel.ts";
import {
  applyDevinAcpModelSelection,
  makeDevinAcpRuntime,
  resolveDevinAcpBaseModelId,
  resolveDevinAcpModeId,
} from "../../provider/acp/DevinAcpSupport.ts";
import {
  buildDevinElicitationAcceptResponse,
  DEVIN_ELICITATION_CANCELLED_RESPONSE,
  DEVIN_ELICITATION_METHODS,
  DevinElicitationRequest,
  extractDevinElicitationQuestions,
} from "../../provider/acp/DevinAcpExtension.ts";
import type * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import { ProviderEventLoggers } from "../../provider/Layers/ProviderEventLoggers.ts";
import { IdAllocatorV2 } from "../IdAllocator.ts";
import { ProviderContinuationRequests } from "../ProviderContinuationRequests.ts";
import { ProviderAdapterV2 } from "../ProviderAdapter.ts";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "../ProviderAdapterDriver.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2ExtensionContext,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "./AcpAdapterV2.ts";
import {
  extractDevinSubagentUpdate,
  normalizeDevinSessionUpdate,
  normalizeDevinToolCall,
} from "./DevinAcp.ts";

export const DEVIN_PROVIDER = ProviderDriverKind.make("devin");
const DEVIN_DRIVER_KIND = DEVIN_PROVIDER;
export const DEVIN_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(DEVIN_DRIVER_KIND);
const DEFAULT_DEVIN_SETTINGS = Schema.decodeSync(DevinSettings)({});

export const DevinProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  threads: {
    ...AcpProviderCapabilitiesV2.threads,
    canReadThreadSnapshot: true,
  },
  subagents: {
    ...AcpProviderCapabilitiesV2.subagents,
    supportsSubagents: true,
    exposesSubagentThreadIds: true,
    emitsSubagentLifecycle: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

export interface DevinAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: DevinSettings;
  readonly environment?: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly crypto: Crypto.Crypto;
  readonly fileSystem: FileSystem.FileSystem;
  readonly idAllocator: IdAllocatorV2["Service"];
  readonly serverConfig: ServerConfig["Service"];
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
}

/**
 * Devin's ask-user-question tool is an ACP form elicitation under non-spec
 * method names. Each request becomes a T3 user-input card whose answers map
 * back onto the elicitation `content` object.
 */
const registerDevinElicitationExtensions = ({
  runtime,
  requestUserInput,
}: Pick<AcpAdapterV2ExtensionContext, "runtime" | "requestUserInput">) =>
  Effect.forEach(
    DEVIN_ELICITATION_METHODS,
    (method) =>
      runtime.handleExtRequest(method, DevinElicitationRequest, (params, requestContext) => {
        const questions = extractDevinElicitationQuestions(params);
        const nativeRequestId =
          "sessionId" in params && typeof params.sessionId === "string"
            ? `${params.sessionId}:elicitation`
            : "elicitation";
        return requestUserInput(
          {
            nativeItemId: nativeRequestId,
            nativeRequestId,
            questions,
          },
          requestContext,
        ).pipe(
          Effect.flatMap(({ acknowledgeNativeResponse, answers }) =>
            Effect.succeed(
              answers === null
                ? DEVIN_ELICITATION_CANCELLED_RESPONSE
                : buildDevinElicitationAcceptResponse(questions, answers),
            ).pipe(Effect.tap(() => acknowledgeNativeResponse)),
          ),
        );
      }),
    { discard: true },
  );

export function makeDevinAcpAdapterFlavor(options: DevinAdapterV2Options): AcpAdapterV2Flavor {
  // `sessionModeForPolicy` cannot read the session's live mode state, so the
  // last advertised set is captured from config updates and consulted here.
  // Devin's mode ids are stable ("smart", "bypass", "plan") but unavailable
  // modes must be skipped rather than hard-failed.
  let lastModeState: AcpSessionModeState | undefined;
  return {
    driver: DEVIN_PROVIDER,
    runtimeHarness: "Devin",
    capabilities: DevinProviderCapabilitiesV2,
    clientCapabilitiesMeta: {
      "cognition.ai/subagentSupport": true,
      "cognition.ai/messageGrouping": true,
    },
    normalizeSessionUpdate: normalizeDevinSessionUpdate,
    normalizeToolCall: normalizeDevinToolCall,
    extractSubagentUpdate: extractDevinSubagentUpdate,
    onSessionConfigurationUpdate: (_configOptions, modeState) => {
      lastModeState = modeState;
      return Effect.void;
    },
    sessionModeForPolicy: (policy) =>
      resolveDevinAcpModeId({
        interactionMode: policy.interactionMode,
        runtimeMode: policy.runtimeMode,
        modeState: lastModeState,
      }),
    resolveModelId: (selection) => resolveDevinAcpBaseModelId(selection.model),
    applyModelSelection: ({ runtime, modelSelection }) =>
      applyDevinAcpModelSelection({
        runtime,
        model: modelSelection.model,
        mapError: (cause) => cause,
      }).pipe(Effect.as(undefined)),
    makeRuntime:
      options.makeRuntime ??
      ((input) =>
        makeDevinAcpRuntime({
          ...input,
          authenticateOnAuthRequired: false,
          devinSettings: options.settings,
          ...(options.environment === undefined ? {} : { environment: options.environment }),
          childProcessSpawner: options.childProcessSpawner,
        })),
    registerExtensions: registerDevinElicitationExtensions,
  };
}

export function makeDevinAdapterV2(options: DevinAdapterV2Options) {
  return makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeDevinAcpAdapterFlavor(options),
    crypto: options.crypto,
    fileSystem: options.fileSystem,
    idAllocator: options.idAllocator,
    serverConfig: options.serverConfig,
    // Devin's shell tool runs commands through T3 client terminals so users can
    // watch and take over agent-spawned shells.
    clientTerminals: {
      childProcessSpawner: options.childProcessSpawner,
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      shellCommands: true,
    },
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });
}

export type DevinAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocatorV2
  | ProviderEventLoggers
  | ServerConfig;

export const DevinAdapterV2Driver: ProviderAdapterDriver<DevinSettings, DevinAdapterV2DriverEnv> = {
  driverKind: DEVIN_DRIVER_KIND,
  configSchema: DevinSettings,
  defaultConfig: (): DevinSettings => DEFAULT_DEVIN_SETTINGS,
  create: Effect.fn("DevinAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<DevinSettings>) {
      const hostEnvironment = yield* HostProcessEnvironment;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const providerEventLoggers = yield* ProviderEventLoggers;
      const serverConfig = yield* ServerConfig;
      const continuationRequests = yield* ProviderContinuationRequests;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return makeDevinAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        childProcessSpawner,
        crypto,
        fileSystem,
        idAllocator,
        serverConfig,
        continuationRequests,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: DEVIN_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: DEVIN_DRIVER_KIND,
              instanceId: input.instanceId,
              detail: "Failed to create Devin ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
};

const layer: Layer.Layer<
  ProviderAdapterV2,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocatorV2
  | ProviderEventLoggers
  | ServerConfig
> = Layer.effect(
  ProviderAdapterV2,
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const crypto = yield* Crypto.Crypto;
    const fileSystem = yield* FileSystem.FileSystem;
    const idAllocator = yield* IdAllocatorV2;
    const providerEventLoggers = yield* ProviderEventLoggers;
    const serverConfig = yield* ServerConfig;
    const continuationRequests = yield* ProviderContinuationRequests;
    const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
    return makeDevinAdapterV2({
      instanceId: DEVIN_DEFAULT_INSTANCE_ID,
      settings: DEFAULT_DEVIN_SETTINGS,
      childProcessSpawner,
      crypto,
      fileSystem,
      idAllocator,
      serverConfig,
      continuationRequests,
      nativeLogging: (threadId) =>
        makeNativeLogger({
          nativeEventLogger: providerEventLoggers.native,
          provider: DEVIN_PROVIDER,
          threadId,
        }),
    });
  }),
);
