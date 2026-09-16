import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderFailure,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import { OrchestratorV2 } from "./Orchestrator.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";

/**
 * TransientFailureRetryService — the V2 port of the V1
 * ProviderTurnRetryPolicy. When a run fails on a retryable provider failure
 * (transport errors, 5xx/capacity, timeouts — never auth, billing, usage
 * limits, validation, or user cancels), the service resends the turn's
 * continue prompt after a short backoff. V1 hid retries inside one logical
 * turn; V2 runs each retry as a new run, so retries are visible and capped
 * per thread.
 */

export const RUN_RETRY_DELAYS_MS = [5_000, 10_000, 20_000] as const;

export const RUN_RETRY_PROMPT =
  "Continue the task from where you left off. Do not repeat work that is already complete.";

const NON_RETRYABLE_FAILURE_PATTERNS = [
  /\b(?:400|401|402|403|404|405|409|410|413|415|422)\b/,
  /\b(?:auth(?:entication|orization)?|unauthori[sz]ed|forbidden|sign[ -]?in|log[ -]?in)\b/,
  /\b(?:invalid|expired|missing|revoked)\b.{0,40}\b(?:api[ -]?key|credential|token)\b/,
  /\b(?:billing|payment|insufficient (?:balance|credit)|credit balance|usage limit|quota exceeded)\b/,
  /\b(?:bad request|invalid request|invalid parameter|validation failed|malformed request)\b/,
  /\b(?:context window|context length|prompt too long|request too large|payload too large)\b/,
  /\b(?:content policy|safety policy|permission denied|not permitted|unsupported|model not found)\b/,
  /\b(?:cancelled|canceled|interrupted|aborted) by (?:the )?user\b/,
] as const;

const RETRYABLE_FAILURE_PATTERNS = [
  /\b(?:408|425|429|500|502|503|504|520|522|523|524|529)\b/,
  /\b(?:capacity|overloaded?|overload|high demand|too many requests|rate[ _-]?limit)\b/,
  /\b(?:resource exhausted|temporar(?:y|ily) unavailable|service unavailable)\b/,
  /\b(?:try again|retry(?:ing)?|backoff)\b/,
  /\b(?:timed? out|timeout|deadline exceeded)\b/,
  /\b(?:network error|fetch failed|socket hang up|websocket)\b/,
  /\b(?:connection|stream) (?:closed|failed|lost|reset|refused)\b/,
  /\b(?:econnreset|econnrefused|ehostunreach|enetunreach|enotfound)\b/,
  /\b(?:upstream|bad gateway|gateway timeout|internal server error|server error)\b/,
  /\b(?:runtime stream failed|api error|overloaded_error|unable to respond)\b/,
] as const;

/** Exported for tests and for the usage-limit classifier's precedence. */
export function isRetryableRunFailure(
  failure: OrchestrationV2ProviderFailure | null | undefined,
): boolean {
  if (failure == null) return false;
  // usage_limit has its own durable resume path; permission/validation and
  // non-retryable adapter hints never retry.
  if (
    failure.class === "usage_limit" ||
    failure.class === "permission_error" ||
    failure.class === "validation_error" ||
    failure.retryable === false
  ) {
    return false;
  }
  const normalized = failure.message.toLowerCase();
  if (NON_RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  if (failure.retryable === true || failure.class === "transport_error") {
    return true;
  }
  return RETRYABLE_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export class TransientFailureRetryService extends Context.Service<
  TransientFailureRetryService,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/orchestration-v2/TransientFailureRetryService") {}

export const make = Effect.gen(function* () {
  const orchestrator = yield* OrchestratorV2;
  const threadManagement = yield* ThreadManagementService;
  // threadId -> pending retry fiber; attemptsByThread bounds the chain when a
  // retried run fails transiently again.
  const retryFibers = new Map<string, Fiber.Fiber<void, never>>();
  const attemptsByThread = new Map<string, number>();

  const cancelRetry = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const fiber = retryFibers.get(threadId);
      if (fiber === undefined) return;
      retryFibers.delete(threadId);
      yield* Fiber.interrupt(fiber);
    });

  const scheduleRetry = Effect.fn("TransientFailureRetryService.scheduleRetry")(function* (
    threadId: ThreadId,
    failedRunId: string,
  ) {
    const attempt = (attemptsByThread.get(threadId) ?? 0) + 1;
    const delayMs = RUN_RETRY_DELAYS_MS[attempt - 1];
    if (delayMs === undefined) {
      attemptsByThread.delete(threadId);
      return;
    }
    attemptsByThread.set(threadId, attempt);
    yield* cancelRetry(threadId);
    yield* Effect.logWarning("orchestration-v2.run-retry-scheduled", {
      threadId,
      failedRunId,
      retryAttempt: attempt,
      delayMs,
    });
    const fiber = yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(delayMs));
        retryFibers.delete(threadId);
        const projection = yield* orchestrator
          .getThreadProjection(threadId)
          .pipe(Effect.catch(() => Effect.succeed(undefined)));
        if (projection === undefined) return;
        const thread = projection.thread;
        if (
          thread.archivedAt !== null ||
          thread.deletedAt !== null ||
          thread.usageLimitResume != null ||
          // The latest run moved on (user sent a message, a queued run
          // promoted, or an earlier retry already fired).
          projection.runs[projection.runs.length - 1]?.id !== failedRunId
        ) {
          return;
        }
        const messageId = MessageId.make(`run-retry:${threadId}:${failedRunId}:${attempt}`);
        yield* threadManagement
          .sendToThread({
            projectId: thread.projectId,
            commandId: CommandId.make(`server:run-retry:${threadId}:${failedRunId}:${attempt}`),
            threadId,
            messageId,
            text: RUN_RETRY_PROMPT,
            attachments: [],
            modelSelection: thread.modelSelection,
            mode: "auto",
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("orchestration-v2.run-retry-send-failed", { threadId, cause }),
            ),
          );
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("orchestration-v2.run-retry-failed", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
    );
    retryFibers.set(threadId, fiber);
  });

  const failureForRun = (
    projection: OrchestrationV2ThreadProjection,
    runId: string,
  ): OrchestrationV2ProviderFailure | null => {
    const turnItem = projection.turnItems.findLast(
      (candidate) =>
        candidate.runId === runId && candidate.type === "error" && candidate.status === "failed",
    );
    return turnItem?.type === "error" ? turnItem.failure : null;
  };

  const handleDomainEvent = (event: OrchestrationV2DomainEvent) =>
    Effect.gen(function* () {
      if (event.type === "run.updated") {
        const run = event.payload;
        if (run.status === "failed") {
          const projection = yield* orchestrator
            .getThreadProjection(run.threadId)
            .pipe(Effect.catch(() => Effect.succeed(undefined)));
          if (projection === undefined) return;
          const failure = failureForRun(projection, run.id);
          if (isRetryableRunFailure(failure)) {
            yield* scheduleRetry(run.threadId, run.id);
          } else {
            // A non-retryable or usage-limit failure ends the retry chain.
            yield* cancelRetry(run.threadId);
            attemptsByThread.delete(run.threadId);
          }
          return;
        }
        if (
          run.status === "completed" ||
          run.status === "cancelled" ||
          run.status === "interrupted"
        ) {
          yield* cancelRetry(run.threadId);
          attemptsByThread.delete(run.threadId);
        }
        return;
      }
      if (
        event.type === "thread.archived" ||
        event.type === "thread.deleted" ||
        event.type === "thread.provider-switched" ||
        event.type === "thread.model-selection-updated" ||
        event.type === "thread.usage-limit-resume-scheduled"
      ) {
        yield* cancelRetry(event.threadId);
        attemptsByThread.delete(event.threadId);
      }
    });

  const start = Effect.fn("TransientFailureRetryService.start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        handleDomainEvent(event).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("transient run retry event handling failed", {
              eventType: event.type,
              cause,
            }),
          ),
        ),
      ),
    );
  });

  return { start } satisfies TransientFailureRetryService["Service"];
});

export const layer = Layer.effect(TransientFailureRetryService, make);
