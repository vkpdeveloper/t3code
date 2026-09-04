import { describe, expect, it } from "@effect/vitest";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { aggregateAgentStatus } from "./aggregate";

const ENV_A = "env-a" as EnvironmentId;
const ENV_B = "env-b" as EnvironmentId;
const PROJECT_ID = "project-1" as ProjectId;

const LABELS = new Map<EnvironmentId, string>([
  [ENV_A, "macair"],
  [ENV_B, "dell"],
]);

const PROJECTS = [
  { environmentId: ENV_A, id: PROJECT_ID, title: "t3code" },
  { environmentId: ENV_B, id: PROJECT_ID, title: "atom" },
] as unknown as ReadonlyArray<EnvironmentProject>;

type Fixture = "running" | "completed" | "approval" | "input" | "unknown";

function makeThread(
  environmentId: EnvironmentId,
  threadId: string,
  fixture: Fixture,
  overrides: {
    readonly startedAt?: string | null;
    readonly archivedAt?: string | null;
    readonly backgroundLiveness?: "working" | "monitoring" | null;
  } = {},
): EnvironmentThreadShell {
  const base = {
    id: threadId as ThreadId,
    environmentId,
    projectId: PROJECT_ID,
    title: `Task ${threadId}`,
    modelSelection: { provider: "codex", model: "gpt-5" },
    updatedAt: "2026-09-04T10:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    backgroundLiveness: overrides.backgroundLiveness ?? null,
    hasPendingApprovals: fixture === "approval",
    hasPendingUserInput: fixture === "input",
  };
  const startedAt =
    overrides.startedAt === undefined ? "2026-09-04T09:50:00.000Z" : overrides.startedAt;
  switch (fixture) {
    case "running":
    case "approval":
    case "input":
      return {
        ...base,
        session: { status: "running", providerName: "Codex", lastError: null },
        latestTurn: {
          state: "running",
          requestedAt: "2026-09-04T09:49:00.000Z",
          startedAt,
          completedAt: null,
        },
      } as unknown as EnvironmentThreadShell;
    case "completed":
      return {
        ...base,
        session: { status: "ready", providerName: "Codex", lastError: null },
        latestTurn: {
          state: "completed",
          requestedAt: "2026-09-04T09:49:00.000Z",
          startedAt,
          completedAt: "2026-09-04T10:00:00.000Z",
        },
      } as unknown as EnvironmentThreadShell;
    case "unknown":
      return { ...base, session: null, latestTurn: null } as unknown as EnvironmentThreadShell;
  }
}

function aggregate(threads: ReadonlyArray<EnvironmentThreadShell>) {
  return aggregateAgentStatus({ threads, projects: PROJECTS, environmentLabels: LABELS });
}

describe("aggregateAgentStatus", () => {
  it("lists attention states first, then running agents oldest first", () => {
    const result = aggregate([
      makeThread(ENV_B, "b1", "running", { startedAt: "2026-09-04T09:55:00.000Z" }),
      makeThread(ENV_A, "a1", "running", { startedAt: "2026-09-04T09:40:00.000Z" }),
      makeThread(ENV_A, "a2", "approval", { startedAt: "2026-09-04T09:50:00.000Z" }),
      makeThread(ENV_B, "b2", "input", { startedAt: "2026-09-04T09:45:00.000Z" }),
    ]);

    expect(result.rows.map((row) => [row.threadId, row.environmentLabel, row.phase])).toEqual([
      ["a2", "macair", "waiting_for_approval"],
      ["b2", "dell", "waiting_for_input"],
      ["a1", "macair", "running"],
      ["b1", "dell", "running"],
    ]);
    expect(result.rows[2]?.projectTitle).toBe("t3code");
    expect(result.rows[3]?.projectTitle).toBe("atom");
    expect(result.rows[2]?.startedAtMs).toBe(Date.parse("2026-09-04T09:40:00.000Z"));
    expect(result.rows[2]?.deepLink).toBe("/threads/env-a/a1");
  });

  it("drops completed, archived, and unresolved threads", () => {
    const result = aggregate([
      makeThread(ENV_A, "done", "completed"),
      makeThread(ENV_A, "archived", "running", { archivedAt: "2026-09-04T09:00:00.000Z" }),
      makeThread(ENV_A, "unknown", "unknown"),
    ]);

    expect(result.rows).toEqual([]);
    expect(result.identity).toBe("");
  });

  it("keeps a thread listed while background work is still alive", () => {
    const result = aggregate([
      makeThread(ENV_A, "bg", "completed", { backgroundLiveness: "working" }),
    ]);

    expect(result.rows.map((row) => row.phase)).toEqual(["running"]);
  });

  it("changes identity on phase changes but not on second-level start jitter", () => {
    const running = aggregate([makeThread(ENV_A, "a1", "running")]);
    const jittered = aggregate([
      makeThread(ENV_A, "a1", "running", { startedAt: "2026-09-04T09:50:20.000Z" }),
    ]);
    const approval = aggregate([makeThread(ENV_A, "a1", "approval")]);

    expect(jittered.identity).toBe(running.identity);
    expect(approval.identity).not.toBe(running.identity);
  });

  it("falls back to the request time when a turn has not started yet", () => {
    const result = aggregate([makeThread(ENV_A, "queued", "running", { startedAt: null })]);

    expect(result.rows[0]?.startedAtMs).toBe(Date.parse("2026-09-04T09:49:00.000Z"));
  });
});
