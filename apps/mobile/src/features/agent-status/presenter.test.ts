import { describe, expect, it } from "@effect/vitest";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  INITIAL_AGENT_STATUS_PRESENTER_STATE,
  presentAgentStatus,
  type AgentStatusPresenterInput,
  type AgentStatusPresenterState,
} from "./presenter";

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

const THEME = {
  accentColor: "#ff4f00",
  backgroundColor: "#101010",
  foregroundColor: "#f5f5f5",
};

function makeThread(
  environmentId: EnvironmentId,
  threadId: string,
  fixture: "running" | "completed" | "failed" | "approval" | "input",
  startedAt = "2026-09-04T09:50:00.000Z",
): EnvironmentThreadShell {
  const base = {
    id: threadId as ThreadId,
    environmentId,
    projectId: PROJECT_ID,
    title: `Task ${threadId}`,
    modelSelection: { provider: "codex", model: "gpt-5" },
    updatedAt: "2026-09-04T10:00:00.000Z",
    archivedAt: null,
    backgroundLiveness: null,
    hasPendingApprovals: fixture === "approval",
    hasPendingUserInput: fixture === "input",
  };
  switch (fixture) {
    case "running":
    case "approval":
    case "input":
      return {
        ...base,
        session: { status: "running", providerName: "Codex", lastError: null },
        latestTurn: {
          state: "running",
          requestedAt: startedAt,
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
          requestedAt: startedAt,
          startedAt,
          completedAt: "2026-09-04T10:00:00.000Z",
        },
      } as unknown as EnvironmentThreadShell;
    case "failed":
      return {
        ...base,
        session: { status: "error", providerName: "Codex", lastError: "Provider crashed" },
        latestTurn: null,
      } as unknown as EnvironmentThreadShell;
  }
}

function input(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  overrides: Partial<AgentStatusPresenterInput> = {},
): AgentStatusPresenterInput {
  return {
    threads,
    projects: PROJECTS,
    environmentLabels: LABELS,
    onlineCount: 1,
    totalCount: 2,
    theme: THEME,
    settings: {
      enabled: true,
      taskCompleted: true,
      taskFailed: true,
      approvalNeeded: true,
      inputNeeded: true,
    },
    statusNotificationEnabled: true,
    appActive: false,
    launchUrlScheme: "t3code-dev",
    ...overrides,
  };
}

describe("presentAgentStatus", () => {
  it("posts the summary on first observation without any alert", () => {
    const { state, effects } = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running"), makeThread(ENV_B, "b1", "running")]),
    );

    expect(effects.map((effect) => effect.type)).toEqual(["update-summary"]);
    const summary = effects[0]?.type === "update-summary" ? effects[0].summary : null;
    expect(summary?.onlineCount).toBe(1);
    expect(summary?.totalCount).toBe(2);
    expect(summary?.theme).toEqual(THEME);
    expect(summary?.launchUrlScheme).toBe("t3code-dev");
    expect(summary?.rows.map((row) => [row.environmentLabel, row.phaseLabel])).toEqual([
      ["macair", "Working"],
      ["dell", "Working"],
    ]);
    expect(summary?.rows[0]?.startedAtMs).toBe(Date.parse("2026-09-04T09:50:00.000Z"));
    expect(state.presentedIdentity).not.toBeNull();
  });

  it("does not re-send an unchanged summary", () => {
    const first = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running")]),
    );
    const second = presentAgentStatus(
      first.state,
      input([makeThread(ENV_A, "a1", "running", "2026-09-04T09:50:30.000Z")]),
    );

    expect(second.effects).toEqual([]);
    expect(second.state.presentedIdentity).toBe(first.state.presentedIdentity);
  });

  it("alerts on completion and shrinks the summary in the same pass", () => {
    const seeded = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running"), makeThread(ENV_B, "b1", "running")]),
    ).state;
    const { effects } = presentAgentStatus(
      seeded,
      input([makeThread(ENV_A, "a1", "completed"), makeThread(ENV_B, "b1", "running")]),
    );

    expect(effects.map((effect) => effect.type)).toEqual(["show-alert", "update-summary"]);
    const alert = effects[0]?.type === "show-alert" ? effects[0].notification : null;
    expect(effects[0]).toMatchObject({ type: "show-alert", identifier: "env-a:a1" });
    expect(alert?.kind).toBe("task-completed");
    expect(alert?.title).toBe("Completed - t3code");
    expect(alert?.threadRef).toEqual({ environmentId: ENV_A, threadId: "a1" });
    const summary = effects[1]?.type === "update-summary" ? effects[1].summary : null;
    expect(summary?.rows.map((row) => row.threadKey)).toEqual(["env-b:b1"]);
  });

  it("keeps the summary posted with no rows when every agent finishes", () => {
    const seeded = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running")]),
    ).state;
    const { effects, state } = presentAgentStatus(
      seeded,
      input([makeThread(ENV_A, "a1", "failed")]),
    );

    expect(effects.map((effect) => effect.type)).toEqual(["show-alert", "update-summary"]);
    const summary = effects[1]?.type === "update-summary" ? effects[1].summary : null;
    expect(summary?.rows).toEqual([]);
    expect(summary?.onlineCount).toBe(1);
    expect(summary?.totalCount).toBe(2);
    expect(state.presentedIdentity).not.toBeNull();
  });

  it("suppresses alerts while the app is active but still advances phases", () => {
    const seeded = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running")]),
    ).state;
    const active = presentAgentStatus(
      seeded,
      input([makeThread(ENV_A, "a1", "completed")], { appActive: true }),
    );
    expect(active.effects.map((effect) => effect.type)).toEqual(["update-summary"]);

    const backgrounded = presentAgentStatus(
      active.state,
      input([makeThread(ENV_A, "a1", "completed")]),
    );
    expect(backgrounded.effects).toEqual([]);
  });

  it("stops the summary once when the status notification is switched off", () => {
    const seeded = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running")]),
    ).state;
    const off = presentAgentStatus(
      seeded,
      input([makeThread(ENV_A, "a1", "running")], { statusNotificationEnabled: false }),
    );
    expect(off.effects).toEqual([{ type: "stop-summary" }]);
    expect(off.state.presentedIdentity).toBeNull();

    const stillOff = presentAgentStatus(
      off.state,
      input([makeThread(ENV_A, "a1", "running")], { statusNotificationEnabled: false }),
    );
    expect(stillOff.effects).toEqual([]);
  });

  it("re-sends the summary when the online machine count changes", () => {
    const seeded: AgentStatusPresenterState = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running")]),
    ).state;
    const { effects } = presentAgentStatus(
      seeded,
      input([makeThread(ENV_A, "a1", "running")], {
        onlineCount: 2,
      }),
    );

    expect(effects.map((effect) => effect.type)).toEqual(["update-summary"]);
    const summary = effects[0]?.type === "update-summary" ? effects[0].summary : null;
    expect(summary?.onlineCount).toBe(2);
    expect(summary?.totalCount).toBe(2);
  });

  it("replaces alerts by thread identifier and dismisses them when work restarts", () => {
    const running = presentAgentStatus(
      INITIAL_AGENT_STATUS_PRESENTER_STATE,
      input([makeThread(ENV_A, "a1", "running")]),
    ).state;
    const approval = presentAgentStatus(running, input([makeThread(ENV_A, "a1", "approval")]));

    expect(approval.effects[0]).toMatchObject({
      type: "show-alert",
      identifier: "env-a:a1",
    });

    const inputNeeded = presentAgentStatus(
      approval.state,
      input([makeThread(ENV_A, "a1", "input")]),
    );
    expect(inputNeeded.effects[0]).toMatchObject({
      type: "show-alert",
      identifier: "env-a:a1",
    });

    const restarted = presentAgentStatus(
      inputNeeded.state,
      input([makeThread(ENV_A, "a1", "running", "2026-09-04T10:05:00.000Z")]),
    );
    expect(restarted.effects[0]).toEqual({
      type: "dismiss-alert",
      identifier: "env-a:a1",
    });
  });
});
