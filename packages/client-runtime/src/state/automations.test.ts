import { describe, expect, it } from "@effect/vitest";
import {
  AutomationId,
  AutomationRunId,
  ThreadId,
  TurnId,
  type AutomationRun,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import { automationRunStatusLabel } from "./automations.ts";

const run: AutomationRun = {
  id: AutomationRunId.make("run-1"),
  automationId: AutomationId.make("automation-1"),
  threadId: ThreadId.make("thread-1"),
  trigger: "scheduled",
  scheduledFor: "2026-09-05T09:00:00Z",
  status: "started",
  error: null,
  createdAt: "2026-09-05T09:00:00Z",
  startedAt: "2026-09-05T09:00:01Z",
};

const completedThread = {
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "completed",
    requestedAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: "2026-09-05T09:01:00Z",
    assistantMessageId: null,
  },
  session: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
} satisfies Pick<
  OrchestrationThreadShell,
  "latestTurn" | "session" | "hasPendingApprovals" | "hasPendingUserInput"
>;

describe("automationRunStatusLabel", () => {
  it("uses the thread outcome after the scheduler marks a run as started", () => {
    expect(automationRunStatusLabel(run, completedThread)).toBe("Completed");
    expect(
      automationRunStatusLabel(run, {
        ...completedThread,
        latestTurn: { ...completedThread.latestTurn, state: "interrupted" },
      }),
    ).toBe("Interrupted");
    expect(
      automationRunStatusLabel(run, {
        ...completedThread,
        latestTurn: { ...completedThread.latestTurn, state: "error" },
      }),
    ).toBe("Failed");
  });

  it("keeps dispatch failures visible even when a thread was created", () => {
    expect(
      automationRunStatusLabel(
        { ...run, status: "failed", error: "Provider unavailable" },
        completedThread,
      ),
    ).toBe("Failed");
  });

  it("uses dispatch state when a thread is not in the active shell", () => {
    expect(automationRunStatusLabel(run, null)).toBe("Started");
    expect(automationRunStatusLabel({ ...run, status: "pending" }, null)).toBe("Queued");
    expect(automationRunStatusLabel({ ...run, status: "failed" }, null)).toBe("Failed");
  });

  it("shows required approval and input while a run is working", () => {
    const workingThread = {
      ...completedThread,
      latestTurn: { ...completedThread.latestTurn, state: "running" as const, completedAt: null },
    };
    expect(automationRunStatusLabel(run, workingThread)).toBe("Running");
    expect(automationRunStatusLabel(run, { ...workingThread, hasPendingApprovals: true })).toBe(
      "Awaiting approval",
    );
    expect(automationRunStatusLabel(run, { ...workingThread, hasPendingUserInput: true })).toBe(
      "Awaiting input",
    );
  });

  it("shows a follow-up starting instead of the previous completed turn", () => {
    const thread = {
      ...completedThread,
      session: {
        threadId: run.threadId,
        status: "starting" as const,
        providerName: "codex",
        runtimeMode: "full-access" as const,
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-09-05T09:05:00Z",
      },
    };
    expect(automationRunStatusLabel(run, thread)).toBe("Starting");
    expect(
      automationRunStatusLabel(run, {
        ...thread,
        session: { ...thread.session, status: "error", lastError: "Provider unavailable" },
      }),
    ).toBe("Failed");
  });
});
