import { describe, expect, it } from "@effect/vitest";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  DOCK_FINISHED_ROW_LINGER_MS,
  dismissDockAgent,
  nextDockAgentExpiryMs,
  pruneFinishedDockAgents,
  reconcileDockAgents,
  type DockAgentRow,
} from "./dockAgents";

const ENV = "env-a" as EnvironmentId;
const PROJECT_ID = "project-1" as ProjectId;
const PROJECTS = [
  { environmentId: ENV, id: PROJECT_ID, title: "t3code" },
] as unknown as ReadonlyArray<EnvironmentProject>;

type Fixture = "running" | "input" | "completed" | "failed" | "interrupted";

function makeThread(
  threadId: string,
  fixture: Fixture,
  options: { readonly subagentOf?: string } = {},
): EnvironmentThreadShell {
  const active = fixture === "running" || fixture === "input";
  const lineage = options.subagentOf
    ? {
        parentThreadId: options.subagentOf,
        relationshipToParent: "subagent",
        rootThreadId: options.subagentOf,
      }
    : { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId };
  return {
    id: threadId as ThreadId,
    environmentId: ENV,
    projectId: PROJECT_ID,
    title: `Task ${threadId}`,
    archivedAt: null,
    lineage,
    runtime: active ? { status: "running", activeRunId: `run:${threadId}` } : null,
    pendingBackgroundTasks: [],
    latestRun: {
      runId: `run:${threadId}`,
      status: active ? "running" : fixture,
      requestedAt: "2026-09-29T21:00:00.000Z",
      startedAt: "2026-09-29T21:00:00.000Z",
      completedAt: null,
    },
    source: {
      id: threadId as ThreadId,
      lineage,
      title: `Task ${threadId}`,
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      status: active ? "running" : fixture,
      activityRunStatus: active ? "running" : null,
      pendingRuntimeRequest:
        fixture === "input"
          ? { id: "request:input", kind: "user_input", createdAt: "2026-09-29T21:01:00.000Z" }
          : null,
      updatedAt: DateTime.makeUnsafe("2026-09-29T21:05:00.000Z"),
    },
  } as unknown as EnvironmentThreadShell;
}

function reconcile(
  previous: ReadonlyArray<DockAgentRow>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
  nowMs = 1_000,
) {
  return reconcileDockAgents(previous, { threads, projects: PROJECTS, nowMs });
}

function summary(rows: ReadonlyArray<DockAgentRow>) {
  return rows.map((row) => [row.threadId, row.phase, row.finishedAtMs]);
}

describe("reconcileDockAgents", () => {
  it("shows active agents, including ones waiting for input", () => {
    const { rows, finished } = reconcile(
      [],
      [makeThread("a", "running"), makeThread("b", "input"), makeThread("c", "completed")],
    );

    // Already-finished threads are history, not dock news.
    expect(summary(rows)).toEqual([
      ["b", "waiting_for_input", null],
      ["a", "running", null],
    ]);
    expect(rows[1]?.projectTitle).toBe("t3code");
    expect(rows[1]?.deepLink).toBe("/threads/env-a/a");
    expect(finished).toEqual([]);
  });

  it("marks agents done or failed exactly once and keeps their position", () => {
    const first = reconcile([], [makeThread("a", "running"), makeThread("b", "running")]);
    const second = reconcile(
      first.rows,
      [makeThread("a", "completed"), makeThread("b", "failed")],
      5_000,
    );

    expect(summary(second.rows)).toEqual([
      ["a", "completed", 5_000],
      ["b", "failed", 5_000],
    ]);
    expect(second.finished.map((row) => row.threadId)).toEqual(["a", "b"]);

    const third = reconcile(
      second.rows,
      [makeThread("a", "completed"), makeThread("b", "failed")],
      6_000,
    );
    expect(summary(third.rows)).toEqual(summary(second.rows));
    expect(third.finished).toEqual([]);
  });

  it("treats a stopped or vanished agent as done", () => {
    const first = reconcile([], [makeThread("a", "running"), makeThread("b", "running")]);
    const second = reconcile(first.rows, [makeThread("a", "interrupted")], 2_000);

    expect(summary(second.rows)).toEqual([
      ["a", "completed", 2_000],
      ["b", "completed", 2_000],
    ]);
  });

  it("brings a finished agent back when it starts working again", () => {
    const first = reconcile([], [makeThread("a", "running")]);
    const done = reconcile(first.rows, [makeThread("a", "completed")], 2_000);
    const again = reconcile(done.rows, [makeThread("a", "running")], 3_000);

    expect(summary(again.rows)).toEqual([["a", "running", null]]);
  });

  it("counts running subagents on their root thread", () => {
    const { rows } = reconcile(
      [],
      [
        makeThread("a", "running"),
        makeThread("sub-1", "running", { subagentOf: "a" }),
        makeThread("sub-2", "running", { subagentOf: "a" }),
        makeThread("sub-3", "completed", { subagentOf: "a" }),
      ],
    );

    // Subagents are counted on the parent, never listed as their own rows.
    expect(rows.map((row) => [row.threadId, row.runningSubagents])).toEqual([["a", 2]]);
  });
});

describe("finished row lifetime", () => {
  it("lets a finished row be swiped away but never an active one", () => {
    const first = reconcile([], [makeThread("a", "running"), makeThread("b", "running")]);
    const done = reconcile(first.rows, [makeThread("b", "running")], 10_000).rows;

    expect(summary(dismissDockAgent(done, "env-a:a"))).toEqual([["b", "running", null]]);
    expect(dismissDockAgent(done, "env-a:b")).toBe(done);

    // A dismissed agent that is still finished does not come back.
    const after = reconcile(
      dismissDockAgent(done, "env-a:a"),
      [makeThread("b", "running")],
      11_000,
    );
    expect(summary(after.rows)).toEqual([["b", "running", null]]);
    expect(after.finished).toEqual([]);
  });

  it("drops finished rows once they have lingered", () => {
    const first = reconcile([], [makeThread("a", "running"), makeThread("b", "running")]);
    const done = reconcile(first.rows, [makeThread("b", "running")], 10_000).rows;

    expect(nextDockAgentExpiryMs(done)).toBe(10_000 + DOCK_FINISHED_ROW_LINGER_MS);
    expect(pruneFinishedDockAgents(done, 10_000 + DOCK_FINISHED_ROW_LINGER_MS - 1)).toBe(done);
    expect(summary(pruneFinishedDockAgents(done, 10_000 + DOCK_FINISHED_ROW_LINGER_MS))).toEqual([
      ["b", "running", null],
    ]);
  });
});
