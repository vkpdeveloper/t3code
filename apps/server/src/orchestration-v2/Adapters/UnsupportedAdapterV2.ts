/**
 * UnsupportedAdapterV2 — explicit no-op adapter for providers that are not
 * wired into orchestration V2.
 *
 * A driver keeps its non-orchestration features (text generation, routing,
 * status checks) by returning this adapter: capabilities advertise nothing,
 * selection transitions reject, and opening a session fails with a typed
 * error that names the provider instead of crashing on a missing runtime.
 *
 * @module orchestration-v2/Adapters/UnsupportedAdapterV2
 */
import type {
  OrchestrationV2ProviderCapabilities,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  ProviderAdapterOpenSessionError,
  type ProviderAdapterV2Shape,
} from "../ProviderAdapter.ts";

const UNSUPPORTED_CAPABILITIES: OrchestrationV2ProviderCapabilities = {
  sessions: {
    supportsMultipleProviderThreadsPerSession: false,
    supportsModelSwitchInSession: false,
    supportsProviderSwitchingViaHandoff: false,
    supportsRuntimeModeSwitchInSession: false,
    pendingRequestsSurviveRestart: false,
  },
  threads: {
    canCreateEmptyThread: false,
    canReadThreadSnapshot: false,
    canRollbackThread: false,
    canForkThread: false,
    canForkFromTurn: false,
    canForkFromSubagentThread: false,
    exposesNativeThreadId: false,
  },
  turns: {
    exposesNativeTurnId: false,
    emitsTurnStarted: false,
    emitsTurnCompleted: false,
    supportsInterrupt: false,
    supportsActiveSteering: false,
    supportsSteeringByInterruptRestart: false,
    supportsQueuedMessages: false,
    terminalStatusQuality: "none",
  },
  streaming: {
    streamsAssistantText: false,
    streamsReasoning: false,
    streamsToolOutput: false,
    streamsPlanText: false,
    emitsMessageCompleted: false,
  },
  tools: {
    exposesToolItemIds: false,
    emitsToolStarted: false,
    emitsToolCompleted: false,
    emitsToolOutput: false,
    supportsMcpTools: false,
    supportsDynamicToolCallbacks: false,
  },
  approvals: {
    supportsCommandApproval: false,
    supportsFileReadApproval: false,
    supportsFileChangeApproval: false,
    supportsApplyPatchApproval: false,
    approvalsHaveNativeRequestIds: false,
    approvalCallbacksAreLiveOnly: false,
    approvalsCanOriginateFromSubagents: false,
  },
  planning: {
    emitsPlanUpdated: false,
    emitsTodoList: false,
    emitsProposedPlan: false,
    supportsStructuredQuestions: false,
    planDeltasHaveItemIds: false,
  },
  subagents: {
    supportsSubagents: false,
    exposesSubagentThreadIds: false,
    emitsSubagentLifecycle: false,
    canWaitForSubagents: false,
    canCloseSubagents: false,
    canForkSubagentThread: false,
  },
  context: {
    acceptsSystemContext: false,
    acceptsDeveloperContext: false,
    acceptsSyntheticUserContext: false,
    canGenerateSummaries: false,
    canConsumeHandoffSummaries: false,
    supportsDeltaHandoff: false,
    supportsFullThreadHandoff: false,
    maxRecommendedHandoffChars: null,
  },
  checkpointing: {
    appCanCheckpointFilesystem: false,
    supportsNestedCheckpointScopes: false,
    providerCanRollbackConversation: false,
    providerRollbackReturnsSnapshot: false,
    providerCanReadConversationSnapshot: false,
  },
  identity: {
    nativeThreadIds: "none",
    nativeTurnIds: "none",
    nativeItemIds: "none",
    nativeRequestIds: "none",
  },
  runtimePolicy: { enforcement: "client-boundary" },
};

export function makeUnsupportedAdapterV2(input: {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
}): ProviderAdapterV2Shape {
  return {
    instanceId: input.instanceId,
    driver: input.driver,
    getCapabilities: () => Effect.succeed(UNSUPPORTED_CAPABILITIES),
    planSelectionTransition: () =>
      Effect.succeed({
        type: "reject",
        reason: `The ${input.driver} provider is not supported by orchestration V2.`,
      }),
    openSession: (sessionInput) =>
      Effect.fail(
        new ProviderAdapterOpenSessionError({
          driver: input.driver,
          providerSessionId: sessionInput.providerSessionId,
          cause: new Error(`The ${input.driver} provider has no orchestration V2 adapter.`),
        }),
      ),
  };
}
