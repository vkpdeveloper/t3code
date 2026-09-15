import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2UsageLimitResume,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerSettingsService } from "../serverSettings.ts";
import { forkParked } from "../serverActivation.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

/**
 * UsageLimitResumeService — watches V2 runs that failed on a provider usage
 * limit (`failure.class === "usage_limit"`) and schedules the thread's
 * automatic continuation at the window reset, replacing the V1
 * usage-limit-wait reactor.
 *
 * The wait is persisted on the app thread (`usageLimitResume`), so a restart
 * re-arms it from the projection; while it is set the orchestrator holds new
 * sends in the queue instead of letting them fail into the same limit.
 * Firing clears the field and either promotes queued runs (the messages a
 * user sent during the wait) or sends a continue prompt when nothing was
 * queued.
 */

const AUTO_CONTINUE_AFTER_USAGE_LIMIT_PROMPT =
  "Continue the task from where you left off. Do not repeat work that is already complete.";

// Unknown reset times guess five minutes out; a reported reset gets a short
// grace period so the provider's window has actually rolled over.
const ESTIMATED_RESUME_DELAY_MS = 5 * 60 * 1_000;
const REPORTED_RESET_GRACE_MS = 30 * 1_000;
const MIN_RESUME_DELAY_MS = 5 * 1_000;

export class UsageLimitResumeService extends Context.Service<
  UsageLimitResumeService,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/UsageLimitResumeService") {}

export const make = Effect.gen(function* () {
  const orchestrator = yield* OrchestratorV2;
  const threadManagement = yield* ThreadManagementService;
  const serverSettings = yield* ServerSettingsService;
  const scheduledFibers = new Map<string, Fiber.Fiber<void, never>>();

  const cancelScheduledFiber = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const fiber = scheduledFibers.get(threadId);
      if (fiber === undefined) return;
      scheduledFibers.delete(threadId);
      yield* Fiber.interrupt(fiber);
    });

  const dispatchClear = Effect.fn("UsageLimitResumeService.dispatchClear")(function* (
    threadId: ThreadId,
    reason: "user" | "resumed" | "stale" | "disabled" | "superseded",
  ) {
    yield* orchestrator
      .dispatch({
        type: "thread.usage-limit-resume.cancel",
        commandId: CommandId.make(`server:usage-limit-resume-clear:${threadId}:${reason}`),
        threadId,
        reason,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("usage-limit resume clear dispatch failed", { threadId, cause }),
        ),
      );
  });

  const runScheduledResume = (
    threadId: ThreadId,
    resume: OrchestrationV2UsageLimitResume,
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const resumeAtMs = DateTime.toEpochMillis(resume.resumeAt);
      if (resumeAtMs > nowMs) {
        yield* Effect.sleep(Duration.millis(resumeAtMs - nowMs));
      }
      scheduledFibers.delete(threadId);
      const settings = yield* serverSettings.getSettings;
      if (!settings.autoContinueAfterUsageLimitReset) {
        yield* dispatchClear(threadId, "disabled");
        return;
      }
      const projection = yield* orchestrator
        .getThreadProjection(threadId)
        .pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (projection === undefined) return;
      const thread = projection.thread;
      const wait = thread.usageLimitResume;
      if (
        wait == null ||
        wait.blockedRunId !== resume.blockedRunId ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null
      ) {
        return;
      }
      // Clearing the field unblocks the queue; queued sends from the wait then
      // flush through the normal promotion path.
      yield* dispatchClear(threadId, "resumed");
      const queuedRuns = projection.runs.filter((run) => run.status === "queued");
      if (queuedRuns.length > 0) {
        yield* orchestrator.resumeQueuedRuns.pipe(
          Effect.catch((cause) =>
            Effect.logWarning("usage-limit resume queue flush failed", { threadId, cause }),
          ),
        );
        return;
      }
      const messageId = MessageId.make(`usage-limit-resume:${threadId}:${resume.blockedRunId}`);
      yield* threadManagement
        .sendToThread({
          projectId: thread.projectId,
          commandId: CommandId.make(`server:usage-limit-resume:${threadId}:${resume.blockedRunId}`),
          threadId,
          messageId,
          text: AUTO_CONTINUE_AFTER_USAGE_LIMIT_PROMPT,
          attachments: [],
          modelSelection: thread.modelSelection,
          mode: "auto",
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("usage-limit resume send failed", { threadId, cause }),
          ),
        );
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("usage-limit auto-resume failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const scheduleWait = Effect.fn("UsageLimitResumeService.scheduleWait")(function* (
    threadId: ThreadId,
    resume: OrchestrationV2UsageLimitResume,
  ) {
    yield* cancelScheduledFiber(threadId);
    const fiber = yield* Effect.forkScoped(runScheduledResume(threadId, resume));
    scheduledFibers.set(threadId, fiber);
  });

  const scheduleFromFailure = Effect.fn("UsageLimitResumeService.scheduleFromFailure")(function* (
    threadId: ThreadId,
    runId: OrchestrationV2UsageLimitResume["blockedRunId"],
    failure: {
      readonly resetsAt?: string | null | undefined;
      readonly message: string;
      readonly code: string | null;
    },
  ) {
    const settings = yield* serverSettings.getSettings;
    if (!settings.autoContinueAfterUsageLimitReset) return;
    const projection = yield* orchestrator.getThreadProjection(threadId);
    const latestRun = projection.runs[projection.runs.length - 1];
    if (
      projection.thread.archivedAt !== null ||
      projection.thread.deletedAt !== null ||
      projection.thread.usageLimitResume != null ||
      // Only the newest run's limit should park the thread; a stale or
      // superseded run's failure must not hold back active work. Runs newer
      // than the failed one that are still queued are exactly the sends this
      // wait is holding, so they do not count as superseding.
      (latestRun?.id !== runId && latestRun?.status !== "queued") ||
      projection.runs.some(
        (run) =>
          run.status === "preparing" ||
          run.status === "starting" ||
          run.status === "running" ||
          run.status === "waiting",
      )
    ) {
      return;
    }
    const nowMs = yield* Clock.currentTimeMillis;
    const resetsAtMs = failure.resetsAt == null ? Number.NaN : Date.parse(failure.resetsAt);
    const isEstimated = !Number.isFinite(resetsAtMs);
    const resumeAtMs =
      Math.max(
        isEstimated ? nowMs + ESTIMATED_RESUME_DELAY_MS : resetsAtMs,
        nowMs + MIN_RESUME_DELAY_MS,
      ) + (isEstimated ? 0 : REPORTED_RESET_GRACE_MS);
    const commandId = CommandId.make(`server:usage-limit-resume:${threadId}:${runId}`);
    yield* orchestrator.dispatch({
      type: "thread.usage-limit-resume.schedule",
      commandId,
      threadId,
      blockedRunId: runId,
      resumeAt: DateTime.makeUnsafe(resumeAtMs),
      isEstimated,
      ...(failure.code === null ? {} : { limitType: failure.code }),
    });
  });

  const handleDomainEvent = (event: OrchestrationV2DomainEvent) =>
    Effect.gen(function* () {
      if (
        event.type === "turn-item.updated" &&
        event.payload.type === "error" &&
        event.payload.failure.class === "usage_limit" &&
        event.payload.runId !== null
      ) {
        yield* scheduleFromFailure(event.payload.threadId, event.payload.runId, {
          resetsAt: event.payload.failure.resetsAt ?? null,
          message: event.payload.failure.message,
          code: event.payload.failure.code,
        });
        return;
      }
      // Any thread update that drops the field clears the pending timer; one
      // that sets it (replay on boot, or a fresh schedule) arms it.
      if ("payload" in event && typeof event.payload === "object" && event.payload !== null) {
        const payload = event.payload as { id?: unknown; usageLimitResume?: unknown };
        if (typeof payload.id === "string" && "usageLimitResume" in payload) {
          const resume = payload.usageLimitResume as OrchestrationV2UsageLimitResume | null;
          if (resume == null) {
            yield* cancelScheduledFiber(payload.id as ThreadId);
          } else {
            yield* scheduleWait(payload.id as ThreadId, resume);
          }
        }
      }
    });

  const start = Effect.fn("UsageLimitResumeService.start")(function* () {
    // The wait lives on the thread, so a restart re-arms timers from the
    // projection rather than losing them with the process.
    const snapshot = yield* orchestrator
      .getShellSnapshot()
      .pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (snapshot !== undefined) {
      yield* Effect.forEach(
        [...snapshot.threads, ...snapshot.archivedThreads],
        (thread) =>
          thread.usageLimitResume == null
            ? Effect.void
            : scheduleWait(thread.id, thread.usageLimitResume),
        { concurrency: 1 },
      );
    }
    const settingsChanges = yield* serverSettings.subscribeChanges;
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        handleDomainEvent(event).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("usage-limit resume event handling failed", {
              eventType: event.type,
              cause,
            }),
          ),
        ),
      ),
    );
    yield* forkParked(
      Stream.runForEach(settingsChanges, (settings) =>
        settings.autoContinueAfterUsageLimitReset
          ? Effect.void
          : orchestrator.getShellSnapshot().pipe(
              Effect.flatMap((snapshot) =>
                Effect.forEach(
                  snapshot.threads.filter((thread) => thread.usageLimitResume != null),
                  (thread) => dispatchClear(thread.id, "disabled"),
                  { concurrency: 1 },
                ),
              ),
              Effect.catch((cause) =>
                Effect.logWarning("failed to cancel usage-limit resumes after settings change", {
                  cause,
                }),
              ),
            ),
      ),
    );
  });

  return { start } satisfies UsageLimitResumeService["Service"];
});

export const layer = Layer.effect(UsageLimitResumeService, make);
