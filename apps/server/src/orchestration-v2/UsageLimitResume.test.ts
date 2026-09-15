import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProviderThreadId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { ProjectionStoreV2, layer as projectionLayer } from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for resume controls"),
} as ProviderAdapterV2Shape;
const database = SqlitePersistenceMemory;
const testLayer = Layer.mergeAll(
  database,
  projectionLayer.pipe(Layer.provide(database)),
  makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "usage-limit-resume" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);

const threadId = ThreadId.make("thread:usage-limit-resume");

const attachProviderThread = (projections: ProjectionStoreV2["Service"]) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const sessionId = ProviderSessionId.make("session:usage-limit-resume");
    const providerThreadId = ProviderThreadId.make("provider-thread:usage-limit-resume");
    yield* projections.apply({
      id: EventId.make("attach-usage-limit"),
      type: "provider-session.attached",
      threadId,
      occurredAt: now,
      payload: {
        id: sessionId,
        driver: adapter.driver,
        providerInstanceId: instanceId,
        status: "ready",
        cwd: "/repo",
        model: modelSelection.model,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
    });
    yield* projections.apply({
      id: EventId.make("provider-thread-usage-limit"),
      type: "provider-thread.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: providerThreadId,
        driver: adapter.driver,
        providerInstanceId: instanceId,
        providerSessionId: sessionId,
        appThreadId: threadId,
        ownerNodeId: null,
        nativeThreadRef: {
          driver: adapter.driver,
          nativeId: "native:usage-limit-resume",
          strength: "strong",
        },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    const projection = yield* projections.getThreadProjection(threadId);
    yield* projections.apply({
      id: EventId.make("thread-provider-link"),
      type: "thread.metadata-updated",
      threadId,
      occurredAt: now,
      payload: { ...projection.thread, activeProviderThreadId: providerThreadId },
    });
  });

it.effect(
  "schedules and clears a usage-limit resume, and holds sends in the queue while waiting",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* OrchestratorV2;
      const projections = yield* ProjectionStoreV2;
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("create-usage-limit"),
        threadId,
        projectId: ProjectId.make("project:usage-limit-resume"),
        title: "Usage limit thread",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      yield* attachProviderThread(projections);

      const nowMs = yield* Clock.currentTimeMillis;
      const resumeAt = DateTime.makeUnsafe(nowMs + 60 * 60 * 1_000);
      yield* orchestrator.dispatch({
        type: "thread.usage-limit-resume.schedule",
        commandId: CommandId.make("schedule-usage-limit"),
        threadId,
        blockedRunId: "run:blocked" as never,
        resumeAt,
        isEstimated: false,
        limitType: "session",
      });
      const scheduled = yield* projections.getThreadProjection(threadId);
      assert.isNotNull(scheduled.thread.usageLimitResume);
      assert.strictEqual(scheduled.thread.usageLimitResume?.blockedRunId, "run:blocked");
      assert.isFalse(scheduled.thread.usageLimitResume?.isEstimated);

      // Sends during the wait queue instead of starting a doomed run.
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("queued-while-waiting"),
        threadId,
        messageId: MessageId.make("message:queued-while-waiting"),
        text: "keep going",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      const queued = yield* projections.getThreadProjection(threadId);
      const queuedRun = queued.runs.findLast((run) => run.status === "queued");
      assert.isDefined(queuedRun);

      yield* orchestrator.dispatch({
        type: "thread.usage-limit-resume.cancel",
        commandId: CommandId.make("cancel-usage-limit"),
        threadId,
        reason: "user",
      });
      const cleared = yield* projections.getThreadProjection(threadId);
      assert.isNull(cleared.thread.usageLimitResume);
    }).pipe(Effect.provide(testLayer)),
);
