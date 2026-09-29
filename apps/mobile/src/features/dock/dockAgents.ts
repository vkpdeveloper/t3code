import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/shell";
import {
  buildProjectTitleMap,
  projectTitleKey,
} from "@t3tools/client-runtime/state/threadNotifications";
import type { EnvironmentId } from "@t3tools/contracts";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";

import {
  aggregateAgentStatus,
  agentStatusPhaseLabel,
  type AgentStatusPhase,
} from "../agent-status/aggregate";

export type DockAgentPhase = AgentStatusPhase | "completed" | "failed";

export interface DockAgentRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly projectTitle: string;
  readonly phase: DockAgentPhase;
  readonly startedAtMs: number | null;
  /** Subagents of this thread that are still running. */
  readonly runningSubagents: number;
  /** When the row turned done or failed; null while the agent is active. */
  readonly finishedAtMs: number | null;
}

/**
 * How long a finished row stays on the dock if nobody swipes it away, long
 * enough to notice on a glance across the room.
 */
export const DOCK_FINISHED_ROW_LINGER_MS = 60_000;

export interface DockAgentsReconcileInput {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly nowMs: number;
  /** Agents the user swiped off the dock. They never appear or chime again. */
  readonly hiddenKeys: ReadonlySet<string>;
}

export function dockAgentKey(environmentId: EnvironmentId, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

function countRunningSubagents(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    if (thread.lineage.relationshipToParent !== "subagent") continue;
    if (thread.archivedAt !== null || !threadRuntimeIsActive(thread.runtime)) continue;
    const key = dockAgentKey(thread.environmentId, thread.lineage.rootThreadId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function terminalPhase(
  row: DockAgentRow,
  threads: ReadonlyArray<EnvironmentThreadShell>,
  projectTitles: ReadonlyMap<string, string>,
): "completed" | "failed" {
  const thread = threads.find(
    (candidate) => candidate.environmentId === row.environmentId && candidate.id === row.threadId,
  );
  if (!thread) return "completed";
  const awareness = projectThreadAwarenessV2({
    environmentId: thread.environmentId,
    project: {
      title:
        projectTitles.get(
          projectTitleKey({ environmentId: thread.environmentId, projectId: thread.projectId }),
        ) ?? "",
    },
    thread: thread.source,
  });
  return awareness?.phase === "failed" ? "failed" : "completed";
}

/**
 * Advances the dock's agent list. Active agents come from the same aggregate
 * as the Android status notification. An agent that leaves the active set is
 * kept as done or failed until the dock removes it, and reported in
 * `finished` exactly once so the dock can chime.
 *
 * Existing rows keep their position so the list never reshuffles under a
 * glance; new agents are appended in aggregate order.
 */
export function reconcileDockAgents(
  previous: ReadonlyArray<DockAgentRow>,
  input: DockAgentsReconcileInput,
): { readonly rows: ReadonlyArray<DockAgentRow>; readonly finished: ReadonlyArray<DockAgentRow> } {
  const active = aggregateAgentStatus({
    threads: input.threads,
    projects: input.projects,
    environmentLabels: new Map(),
  }).rows;
  const subagents = countRunningSubagents(input.threads);
  const activeByKey = new Map(
    active.flatMap((row) => {
      const key = dockAgentKey(row.environmentId, row.threadId);
      if (input.hiddenKeys.has(key)) return [];
      const next: DockAgentRow = {
        key,
        environmentId: row.environmentId,
        threadId: row.threadId,
        threadTitle: row.threadTitle,
        projectTitle: row.projectTitle,
        phase: row.phase,
        startedAtMs: row.startedAtMs,
        runningSubagents: subagents.get(key) ?? 0,
        finishedAtMs: null,
      };
      return [[key, next] as const];
    }),
  );

  let projectTitles: ReadonlyMap<string, string> | null = null;
  const rows: DockAgentRow[] = [];
  const finished: DockAgentRow[] = [];
  for (const row of previous) {
    if (input.hiddenKeys.has(row.key)) continue;
    const current = activeByKey.get(row.key);
    if (current) {
      rows.push(current);
      activeByKey.delete(row.key);
    } else if (row.finishedAtMs !== null) {
      rows.push(row);
    } else {
      projectTitles ??= buildProjectTitleMap(input.projects);
      const done: DockAgentRow = {
        ...row,
        phase: terminalPhase(row, input.threads, projectTitles),
        runningSubagents: 0,
        finishedAtMs: input.nowMs,
      };
      rows.push(done);
      finished.push(done);
    }
  }
  rows.push(...activeByKey.values());
  return { rows, finished };
}

/** Removes a row the user swiped away, running or finished. */
export function dismissDockAgent(
  rows: ReadonlyArray<DockAgentRow>,
  key: string,
): ReadonlyArray<DockAgentRow> {
  const kept = rows.filter((row) => row.key !== key);
  return kept.length === rows.length ? rows : kept;
}

/** Hidden agents kept per device; the oldest are forgotten first. */
export const DOCK_HIDDEN_AGENT_LIMIT = 500;

/** Adds an agent to the persisted hidden list, newest last. */
export function hideDockAgentKey(
  hiddenKeys: ReadonlyArray<string>,
  key: string,
): ReadonlyArray<string> {
  const next = [...hiddenKeys.filter((hidden) => hidden !== key), key];
  return next.length > DOCK_HIDDEN_AGENT_LIMIT ? next.slice(-DOCK_HIDDEN_AGENT_LIMIT) : next;
}

/** Drops finished rows whose linger time has passed. */
export function pruneFinishedDockAgents(
  rows: ReadonlyArray<DockAgentRow>,
  nowMs: number,
): ReadonlyArray<DockAgentRow> {
  const kept = rows.filter(
    (row) => row.finishedAtMs === null || nowMs - row.finishedAtMs < DOCK_FINISHED_ROW_LINGER_MS,
  );
  return kept.length === rows.length ? rows : kept;
}

/** When the next finished row is due to leave, if any. */
export function nextDockAgentExpiryMs(rows: ReadonlyArray<DockAgentRow>): number | null {
  let next: number | null = null;
  for (const row of rows) {
    if (row.finishedAtMs === null) continue;
    const expiry = row.finishedAtMs + DOCK_FINISHED_ROW_LINGER_MS;
    if (next === null || expiry < next) next = expiry;
  }
  return next;
}

export function dockAgentPhaseLabel(phase: DockAgentPhase): string {
  if (phase === "completed") return "Done";
  if (phase === "failed") return "Failed";
  return agentStatusPhaseLabel(phase);
}

/** Whether two row lists render identically, so streamed updates can be skipped. */
export function sameDockAgentRows(
  left: ReadonlyArray<DockAgentRow>,
  right: ReadonlyArray<DockAgentRow>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((row, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      row.key === other.key &&
      row.phase === other.phase &&
      row.threadTitle === other.threadTitle &&
      row.projectTitle === other.projectTitle &&
      row.startedAtMs === other.startedAtMs &&
      row.runningSubagents === other.runningSubagents &&
      row.finishedAtMs === other.finishedAtMs
    );
  });
}
