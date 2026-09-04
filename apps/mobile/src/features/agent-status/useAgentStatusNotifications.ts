import { useAtomValue } from "@effect/atom-react";
import { connectionProjectionPhase } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { getMobileThemeRuntimeVariables } from "../../lib/mobileThemeVariables";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations } from "../../state/presentation";
import { environmentProjects } from "../../state/projects";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentThreadShells } from "../../state/threads";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  ALERT_CHANNEL_ID,
  nativeAgentStatus,
  supportsAgentStatusNotification,
} from "./nativeAgentStatus";
import {
  INITIAL_AGENT_STATUS_PRESENTER_STATE,
  presentAgentStatus,
  type AgentStatusEffect,
  type AgentStatusPresenterState,
} from "./presenter";

const RECONCILE_DEBOUNCE_MS = 250;

// Alerts are only raised while the app is not active, but "not active" on
// Android includes the brief inactive window and split-screen. Without a
// handler expo-notifications swallows local notifications in those states.
let notificationHandlerInstalled = false;
function ensureNotificationHandler(): void {
  if (notificationHandlerInstalled) return;
  notificationHandlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
}

/** Labels for every paired environment, user override first, server label as fallback. */
function readEnvironmentLabels() {
  const labels = new Map<Parameters<typeof environmentPresentations.presentationAtom>[0], string>();
  for (const [environmentId, presentation] of appAtomRegistry.get(
    environmentPresentations.presentationsAtom,
  )) {
    const target = presentation.entry.target;
    const profile = presentation.entry.profile;
    const reported = profile._tag === "Some" ? profile.value.reportedLabel : undefined;
    labels.set(environmentId, target.label.trim() || reported?.trim() || "Environment");
  }
  return labels;
}

function launchUrlScheme(): string {
  const scheme = Constants.expoConfig?.scheme;
  return Array.isArray(scheme) ? (scheme[0] ?? "t3code") : (scheme ?? "t3code");
}

function countOnlineEnvironments(environmentIds: Iterable<EnvironmentId>): number {
  let onlineCount = 0;
  for (const environmentId of environmentIds) {
    const result = appAtomRegistry.get(environmentCatalog.stateAtom(environmentId));
    const state = Option.getOrNull(AsyncResult.value(result));
    if (state !== null && connectionProjectionPhase(state) === "ready") {
      onlineCount += 1;
    }
  }
  return onlineCount;
}

const pendingAlertOperations = new Map<string, Promise<void>>();

function runAlertOperation(identifier: string, operation: () => Promise<void>): void {
  const previous = pendingAlertOperations.get(identifier) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(operation)
    .catch(() => undefined)
    .finally(() => {
      if (pendingAlertOperations.get(identifier) === next) {
        pendingAlertOperations.delete(identifier);
      }
    });
  pendingAlertOperations.set(identifier, next);
}

function performEffect(effect: AgentStatusEffect): void {
  const native = nativeAgentStatus();
  switch (effect.type) {
    case "update-summary":
      native?.update(effect.summary);
      return;
    case "stop-summary":
      native?.stop();
      return;
    case "show-alert":
      runAlertOperation(effect.identifier, async () => {
        await Notifications.dismissNotificationAsync(effect.identifier).catch(() => undefined);
        await Notifications.scheduleNotificationAsync({
          identifier: effect.identifier,
          content: {
            title: effect.notification.title,
            body: effect.notification.body,
            data: {
              environmentId: effect.notification.threadRef.environmentId,
              threadId: effect.notification.threadRef.threadId,
            },
          },
          trigger: { channelId: ALERT_CHANNEL_ID },
        });
      });
      return;
    case "dismiss-alert":
      runAlertOperation(effect.identifier, () =>
        Notifications.dismissNotificationAsync(effect.identifier),
      );
      return;
  }
}

/**
 * Android-only driver for the persistent agent status notification and the
 * local transition alerts. Mount once. It subscribes to every environment's
 * shell list, debounces bursts, and hands the pure presenter's effects to the
 * native module and expo-notifications.
 */
export function useAgentStatusNotifications(): void {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const { themeAppearance, themeId } = useAppearancePreferences();
  const notificationTheme = useMemo(() => {
    const colors = getMobileThemeRuntimeVariables(themeId, themeAppearance);
    return {
      accentColor: colors["--color-primary"],
      backgroundColor: colors["--color-screen"],
      foregroundColor: colors["--color-foreground"],
    };
  }, [themeAppearance, themeId]);
  const statusEnabled =
    AsyncResult.isSuccess(preferences) && preferences.value.agentStatusNotificationEnabled === true;
  const alertsEnabled =
    AsyncResult.isSuccess(preferences) && preferences.value.agentAlertsEnabled === true;
  const preferencesLoaded = AsyncResult.isSuccess(preferences);
  const stateRef = useRef<AgentStatusPresenterState>(INITIAL_AGENT_STATUS_PRESENTER_STATE);

  useEffect(() => {
    if (!supportsAgentStatusNotification() || !preferencesLoaded) {
      return;
    }
    nativeAgentStatus()?.ensureChannels();
    ensureNotificationHandler();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const reconcile = () => {
      timer = null;
      if (disposed) return;
      const environmentLabels = readEnvironmentLabels();
      const { state, effects } = presentAgentStatus(stateRef.current, {
        threads: appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
        projects: appAtomRegistry.get(environmentProjects.projectsAtom),
        environmentLabels,
        onlineCount: countOnlineEnvironments(environmentLabels.keys()),
        totalCount: environmentLabels.size,
        theme: notificationTheme,
        settings: {
          enabled: alertsEnabled,
          taskCompleted: true,
          taskFailed: true,
          approvalNeeded: true,
          inputNeeded: true,
        },
        statusNotificationEnabled: statusEnabled,
        appActive: AppState.currentState === "active",
        launchUrlScheme: launchUrlScheme(),
      });
      stateRef.current = state;
      for (const effect of effects) {
        performEffect(effect);
      }
    };

    // Shell updates arrive per streamed token during a turn. One trailing
    // pass per burst is plenty for a notification, and keeps the native
    // bridge quiet while the agent is typing.
    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(reconcile, RECONCILE_DEBOUNCE_MS);
    };

    const connectionUnsubscribes = new Map<EnvironmentId, () => void>();
    const syncConnectionSubscriptions = () => {
      const environmentIds = new Set(readEnvironmentLabels().keys());
      for (const [environmentId, unsubscribe] of connectionUnsubscribes) {
        if (!environmentIds.has(environmentId)) {
          unsubscribe();
          connectionUnsubscribes.delete(environmentId);
        }
      }
      for (const environmentId of environmentIds) {
        if (connectionUnsubscribes.has(environmentId)) continue;
        connectionUnsubscribes.set(
          environmentId,
          appAtomRegistry.subscribe(environmentCatalog.stateAtom(environmentId), schedule),
        );
      }
    };

    // Seed synchronously: everything already loaded is recorded without
    // firing, so a cold start never replays a backlog of alerts.
    reconcile();
    syncConnectionSubscriptions();

    const unsubscribeThreads = appAtomRegistry.subscribe(
      environmentThreadShells.threadShellsAtom,
      schedule,
    );
    const unsubscribeProjects = appAtomRegistry.subscribe(
      environmentProjects.projectsAtom,
      schedule,
    );
    const unsubscribeEnvironments = appAtomRegistry.subscribe(
      environmentPresentations.presentationsAtom,
      () => {
        syncConnectionSubscriptions();
        schedule();
      },
    );
    // Android may refuse a foreground service start from the background; the
    // next foreground pass re-sends the summary because its identity moves on.
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        stateRef.current = { ...stateRef.current, presentedIdentity: null };
      }
      schedule();
    });

    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unsubscribeThreads();
      unsubscribeProjects();
      unsubscribeEnvironments();
      for (const unsubscribe of connectionUnsubscribes.values()) unsubscribe();
      appStateSubscription.remove();
    };
  }, [alertsEnabled, notificationTheme, preferencesLoaded, statusEnabled]);

  // Turning the switch off must clear the notification even though the effect
  // above re-runs with a fresh presenter state that knows nothing was posted.
  useEffect(() => {
    if (!supportsAgentStatusNotification() || !preferencesLoaded || statusEnabled) {
      return;
    }
    nativeAgentStatus()?.stop();
    stateRef.current = { ...stateRef.current, presentedIdentity: null };
  }, [preferencesLoaded, statusEnabled]);
}
