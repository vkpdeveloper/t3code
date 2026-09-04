import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  buildProjectTitleMap,
  projectTitleKey,
  resolveNotifiablePhase,
} from "@t3tools/client-runtime/state/threadNotifications";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  buildAgentAwarenessDeepLink,
  projectThreadAwareness,
  type AgentAwarenessPhase,
} from "@t3tools/shared/agentAwareness";

export type AgentStatusPhase = Extract<
  AgentAwarenessPhase,
  "starting" | "running" | "waiting_for_approval" | "waiting_for_input"
>;

/**
 * Phases that keep a thread on the persistent status notification. Anything
 * else (completed, failed, stale, unresolved) is announced once as a
 * transition by the reconciler and then dropped from the summary.
 */
const ACTIVE_PHASES: ReadonlySet<AgentAwarenessPhase> = new Set<AgentStatusPhase>([
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
]);

function isActivePhase(phase: AgentAwarenessPhase): phase is AgentStatusPhase {
  return ACTIVE_PHASES.has(phase);
}

export interface AgentStatusRow {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly environmentLabel: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: AgentStatusPhase;
  /** Epoch ms the current turn began, when the shell has one. */
  readonly startedAtMs: number | null;
  readonly deepLink: string;
}

export interface AgentStatusAggregate {
  readonly rows: ReadonlyArray<AgentStatusRow>;
  /**
   * Stable identity of the summary with ticking values removed. Two
   * aggregates with equal identity render the same notification, so the
   * native side is only touched when this changes, not on every streamed
   * shell update.
   */
  readonly identity: string;
}

export const EMPTY_AGENT_STATUS_AGGREGATE: AgentStatusAggregate = { rows: [], identity: "" };

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Folds every environment's thread shells into the rows the status
 * notification lists. Rows sort by start time so the oldest running task is
 * first and its start drives the notification chronometer.
 */
export function aggregateAgentStatus(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
}): AgentStatusAggregate {
  const projectTitles = buildProjectTitleMap(input.projects);
  const rows: AgentStatusRow[] = [];

  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    const projectTitle =
      projectTitles.get(
        projectTitleKey({ environmentId: thread.environmentId, projectId: thread.projectId }),
      ) ?? "";
    const awareness = projectThreadAwareness({
      environmentId: thread.environmentId,
      project: { title: projectTitle },
      thread,
    });
    const phase = resolveNotifiablePhase(thread, awareness?.phase ?? null);
    if (phase === null || !isActivePhase(phase)) continue;

    rows.push({
      environmentId: thread.environmentId,
      threadId: thread.id,
      environmentLabel: input.environmentLabels.get(thread.environmentId) ?? "",
      projectTitle,
      threadTitle: thread.title,
      phase,
      startedAtMs: parseIsoMs(thread.latestTurn?.startedAt ?? thread.latestTurn?.requestedAt),
      deepLink: buildAgentAwarenessDeepLink({
        environmentId: thread.environmentId,
        threadId: thread.id,
      }),
    });
  }

  rows.sort((left, right) => {
    const leftStart = left.startedAtMs ?? Number.MAX_SAFE_INTEGER;
    const rightStart = right.startedAtMs ?? Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) return leftStart - rightStart;
    return `${left.environmentId}:${left.threadId}`.localeCompare(
      `${right.environmentId}:${right.threadId}`,
    );
  });

  if (rows.length === 0) return EMPTY_AGENT_STATUS_AGGREGATE;

  const identity = rows
    .map((row) =>
      JSON.stringify([
        row.environmentId,
        row.threadId,
        row.phase,
        row.environmentLabel,
        row.projectTitle,
        row.threadTitle,
        // The chronometer origin only matters to the minute; the exact value
        // would make every re-projected snapshot look like a change.
        row.startedAtMs === null ? null : Math.floor(row.startedAtMs / 60_000),
      ]),
    )
    .join("\n");

  return { rows, identity };
}

export function agentStatusPhaseLabel(phase: AgentStatusPhase): string {
  switch (phase) {
    case "starting":
      return "Starting";
    case "running":
      return "Working";
    case "waiting_for_approval":
      return "Needs approval";
    case "waiting_for_input":
      return "Needs input";
  }
}
