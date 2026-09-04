import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  EMPTY_THREAD_PHASE_SNAPSHOT,
  reconcileThreadNotifications,
  threadNotificationKey,
  type PendingThreadNotification,
  type ThreadNotificationSettings,
  type ThreadPhaseSnapshot,
} from "@t3tools/client-runtime/state/threadNotifications";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  aggregateAgentStatus,
  agentStatusPhaseLabel,
  EMPTY_AGENT_STATUS_AGGREGATE,
  type AgentStatusAggregate,
} from "./aggregate";
import type { NativeAgentStatusSummary, NativeAgentStatusTheme } from "./nativeAgentStatus";

export interface AgentStatusPresenterInput {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
  readonly onlineCount: number;
  readonly totalCount: number;
  readonly theme: NativeAgentStatusTheme;
  readonly settings: ThreadNotificationSettings;
  /** Whether the persistent status notification is wanted at all. */
  readonly statusNotificationEnabled: boolean;
  readonly liveUpdatesEnabled: boolean;
  /** Whether the app is on screen; alerts stay quiet while it is. */
  readonly appActive: boolean;
  readonly launchUrlScheme: string;
}

export interface AgentStatusPresenterState {
  readonly phases: ThreadPhaseSnapshot;
  readonly aggregate: AgentStatusAggregate;
  /** Identity of the summary last handed to the native side. */
  readonly presentedIdentity: string | null;
}

export const INITIAL_AGENT_STATUS_PRESENTER_STATE: AgentStatusPresenterState = {
  phases: EMPTY_THREAD_PHASE_SNAPSHOT,
  aggregate: EMPTY_AGENT_STATUS_AGGREGATE,
  presentedIdentity: null,
};

export type AgentStatusEffect =
  | { readonly type: "update-summary"; readonly summary: NativeAgentStatusSummary }
  | { readonly type: "stop-summary" }
  | {
      readonly type: "show-alert";
      readonly identifier: string;
      readonly notification: PendingThreadNotification;
    }
  | { readonly type: "dismiss-alert"; readonly identifier: string };

/**
 * One reconciliation pass. Pure: it takes the previous state and the current
 * shells, and returns the next state plus the OS-facing effects to perform.
 *
 * The persistent summary is only re-sent when its identity changes, so a
 * streaming turn that updates the shell many times a second does not touch
 * the notification. Transition alerts reuse the shared reconciler, which
 * already handles first-observation silence and the backgroundLiveness
 * guard.
 */
export function presentAgentStatus(
  previous: AgentStatusPresenterState,
  input: AgentStatusPresenterInput,
): {
  readonly state: AgentStatusPresenterState;
  readonly effects: ReadonlyArray<AgentStatusEffect>;
} {
  const effects: AgentStatusEffect[] = [];

  const reconciled = reconcileThreadNotifications({
    previous: previous.phases,
    threads: input.threads,
    projectTitles: projectTitleMap(input.projects),
    settings: input.settings,
    windowFocused: input.appActive,
  });
  for (const notification of reconciled.notifications) {
    effects.push({
      type: "show-alert",
      identifier: threadNotificationKey(notification.threadRef),
      notification,
    });
  }

  for (const [identifier, phase] of reconciled.next) {
    const previousPhase = previous.phases.get(identifier);
    const hadAlertPhase =
      previousPhase === "completed" ||
      previousPhase === "failed" ||
      previousPhase === "waiting_for_approval" ||
      previousPhase === "waiting_for_input";
    if (hadAlertPhase && (phase === "starting" || phase === "running")) {
      effects.push({ type: "dismiss-alert", identifier });
    }
  }

  const aggregate = input.statusNotificationEnabled
    ? aggregateAgentStatus({
        threads: input.threads,
        projects: input.projects,
        environmentLabels: input.environmentLabels,
      })
    : EMPTY_AGENT_STATUS_AGGREGATE;

  // Counts and colors belong in the identity so connection and appearance
  // changes refresh the native notification even when the rows stay fixed.
  const summaryIdentity = input.statusNotificationEnabled
    ? `${input.onlineCount}/${input.totalCount}\u0000${input.liveUpdatesEnabled}\u0000${JSON.stringify(input.theme)}\u0000${aggregate.identity}`
    : null;

  let presentedIdentity = previous.presentedIdentity;
  if (summaryIdentity === null) {
    if (previous.presentedIdentity !== null) {
      effects.push({ type: "stop-summary" });
      presentedIdentity = null;
    }
  } else if (summaryIdentity !== previous.presentedIdentity) {
    effects.push({
      type: "update-summary",
      summary: {
        launchUrlScheme: input.launchUrlScheme,
        onlineCount: input.onlineCount,
        totalCount: input.totalCount,
        theme: input.theme,
        liveUpdatesEnabled: input.liveUpdatesEnabled,
        rows: aggregate.rows.map((row) => ({
          threadKey: `${row.environmentId}:${row.threadId}`,
          environmentLabel: row.environmentLabel,
          projectTitle: row.projectTitle,
          threadTitle: row.threadTitle,
          phase: row.phase,
          phaseLabel: agentStatusPhaseLabel(row.phase),
          deepLink: row.deepLink,
          ...(row.startedAtMs === null ? {} : { startedAtMs: row.startedAtMs }),
        })),
      },
    });
    presentedIdentity = summaryIdentity;
  }

  return {
    state: { phases: reconciled.next, aggregate, presentedIdentity },
    effects,
  };
}

function projectTitleMap(projects: ReadonlyArray<EnvironmentProject>): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  for (const project of projects) {
    titles.set(`${project.environmentId}:${project.id}`, project.title);
  }
  return titles;
}
