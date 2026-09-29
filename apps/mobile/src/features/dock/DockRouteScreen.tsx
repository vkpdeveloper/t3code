import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  StackActions,
  useLinkTo,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useEffectEvent, useState } from "react";
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, LinearTransition, SlideOutRight } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { dockAgentPhaseLabel, type DockAgentPhase, type DockAgentRow } from "./dockAgents";
import { formatDockAlarmCountdown, nextDockAlarm, parseDockAlarmTimes } from "./dockAlarms";
import { dockAlarmTimesAtom, suppressDockAutoEntry, useIsCharging } from "./dockMode";
import { useDockAgents } from "./useDockAgents";

type DockRouteParams = {
  /** Comma-separated alarm times from the Shortcuts automation. */
  readonly alarms?: string;
  /** "auto" when opened by charging sideways; it then closes when turned upright. */
  readonly source?: string;
};

const MAX_VISIBLE_AGENTS = 4;
const FINISHED_SOUND = require("../../../assets/sounds/dock-agent-finished.wav");

// Dock mode is a nightstand surface, so it keeps its own dim dark look
// regardless of the app theme.
const COLORS = {
  background: "#000000",
  primary: "#E6E6E6",
  secondary: "#8C8C8C",
  panel: "#141414",
  control: "#1F1F1F",
  working: "#5B9BFF",
  attention: "#F5B544",
  done: "#4CC38A",
  failed: "#F0605D",
};

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function formatClock(date: Date): { readonly time: string; readonly period: string | null } {
  const parts = TIME_FORMAT.formatToParts(date);
  return {
    time: parts
      .filter((part) => part.type !== "dayPeriod")
      .map((part) => part.value)
      .join("")
      .trim(),
    period: parts.find((part) => part.type === "dayPeriod")?.value ?? null,
  };
}

function formatElapsed(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

/** Current time, re-rendering once at the start of each minute. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = new Date();
      const untilNextMinute = 60_000 - (current.getSeconds() * 1_000 + current.getMilliseconds());
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, untilNextMinute + 20);
    };
    schedule();
    // Timers stall while the app is in the background.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      clearTimeout(timer);
      setNow(new Date());
      schedule();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return now;
}

export function DockRouteScreen({ route }: StaticScreenProps<DockRouteParams | undefined>) {
  useKeepAwake("dock-mode");
  const navigation = useNavigation();
  const linkTo = useLinkTo();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const now = useMinuteClock();
  const autoEntered = route.params?.source === "auto";

  const alarmsParam = route.params?.alarms;
  useEffect(() => {
    if (alarmsParam !== undefined) {
      appAtomRegistry.set(dockAlarmTimesAtom, parseDockAlarmTimes(alarmsParam));
    }
  }, [alarmsParam]);
  const alarmTimes = useAtomValue(dockAlarmTimesAtom);
  const nextAlarm = nextDockAlarm(alarmTimes, now);

  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const soundEnabled =
    !AsyncResult.isSuccess(preferences) || preferences.value.dockModeSoundEnabled !== false;
  const player = useAudioPlayer(FINISHED_SOUND);

  useEffect(() => {
    // A chime should sit on top of whatever is playing, and respect the
    // silent switch.
    void setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "mixWithOthers",
      playsInSilentMode: false,
      shouldPlayInBackground: false,
    }).catch(() => undefined);
  }, []);

  const agents = useDockAgents(() => {
    if (!soundEnabled) return;
    player.seekTo(0).catch(() => undefined);
    player.play();
  });

  const charging = useIsCharging(true);
  const close = (byUser: boolean) => {
    // Leaving on purpose while plugged in must not bounce straight back.
    if (byUser && charging === true) suppressDockAutoEntry();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  };
  const closeAutomatically = useEffectEvent(() => close(false));

  // Unplugging ends a docked session. A dock opened while not charging only
  // closes when the user closes it.
  const [chargingAtEntry, setChargingAtEntry] = useState<boolean | null>(null);
  if (chargingAtEntry === null && charging !== null) setChargingAtEntry(charging);
  useEffect(() => {
    if (charging === false && chargingAtEntry === true) closeAutomatically();
  }, [charging, chargingAtEntry]);

  // Turning the phone upright ends an automatic dock.
  const [wasLandscape, setWasLandscape] = useState(landscape);
  if (landscape && !wasLandscape) setWasLandscape(true);
  useEffect(() => {
    if (autoEntered && wasLandscape && !landscape) closeAutomatically();
  }, [autoEntered, landscape, wasLandscape]);

  const openThread = (row: DockAgentRow) => {
    close(true);
    if (row.deepLink) linkTo(row.deepLink);
  };

  const clock = formatClock(now);
  const timeSize = Math.min(height * 0.34, width * 0.16, 160);
  const visibleAgents = agents.slice(0, MAX_VISIBLE_AGENTS);
  const hiddenCount = agents.length - visibleAgents.length;
  const activeCount = agents.filter((row) => row.finishedAtMs === null).length;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: Math.max(insets.top, 20),
          paddingBottom: Math.max(insets.bottom, 20),
          paddingLeft: Math.max(insets.left, 24),
          paddingRight: Math.max(insets.right, 24),
        },
      ]}
    >
      <View style={styles.clockPane}>
        <View style={styles.timeRow}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.time, { fontSize: timeSize, lineHeight: timeSize * 1.05 }]}
          >
            {clock.time}
          </Text>
          {clock.period ? (
            <Text style={[styles.period, { fontSize: timeSize * 0.22 }]}>{clock.period}</Text>
          ) : null}
        </View>
        <Text style={styles.date}>{DATE_FORMAT.format(now)}</Text>
        {nextAlarm ? (
          <View style={styles.alarmRow}>
            <SymbolView name="alarm" size={18} tintColor={COLORS.secondary} type="monochrome" />
            <Text style={styles.alarmText}>
              {TIME_FORMAT.format(nextAlarm)}
              <Text style={styles.alarmCountdown}>
                {"  "}
                {formatDockAlarmCountdown(nextAlarm, now)}
              </Text>
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.agentsPane}>
        <Text style={styles.agentsHeader}>
          {activeCount > 0 ? `${activeCount} agent${activeCount === 1 ? "" : "s"}` : "Agents"}
        </Text>
        {visibleAgents.length === 0 ? (
          <Text style={styles.emptyText}>No agents running</Text>
        ) : (
          visibleAgents.map((row) => (
            <DockAgentRowView key={row.key} row={row} nowMs={now.getTime()} onPress={openThread} />
          ))
        )}
        {hiddenCount > 0 ? <Text style={styles.moreText}>+{hiddenCount} more</Text> : null}
      </View>

      <View
        style={[
          styles.controls,
          { top: Math.max(insets.top, 12), right: Math.max(insets.right, 12) },
        ]}
      >
        <DockControlButton
          accessibilityLabel={soundEnabled ? "Mute finish sound" : "Unmute finish sound"}
          icon={soundEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill"}
          onPress={() => savePreferences({ dockModeSoundEnabled: !soundEnabled })}
        />
        <DockControlButton
          accessibilityLabel="Close Dock mode"
          icon="xmark"
          onPress={() => close(true)}
        />
      </View>
    </View>
  );
}

function DockControlButton(props: {
  readonly accessibilityLabel: string;
  readonly icon: AppSymbolName;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={props.onPress}
      style={({ pressed }) => [styles.controlButton, pressed ? styles.pressed : null]}
    >
      <SymbolView name={props.icon} size={18} tintColor={COLORS.secondary} type="monochrome" />
    </Pressable>
  );
}

function phaseAppearance(phase: DockAgentPhase): {
  readonly color: string;
  readonly icon: AppSymbolName | null;
} {
  switch (phase) {
    case "starting":
    case "running":
      return { color: COLORS.working, icon: null };
    case "waiting_for_approval":
    case "waiting_for_input":
      return { color: COLORS.attention, icon: "exclamationmark.circle" };
    case "completed":
      return { color: COLORS.done, icon: "checkmark.circle" };
    case "failed":
      return { color: COLORS.failed, icon: "xmark.circle.fill" };
  }
}

function DockAgentRowView(props: {
  readonly row: DockAgentRow;
  readonly nowMs: number;
  readonly onPress: (row: DockAgentRow) => void;
}) {
  const { row } = props;
  const appearance = phaseAppearance(row.phase);
  const details = [
    row.finishedAtMs === null && row.startedAtMs !== null
      ? formatElapsed(props.nowMs - row.startedAtMs)
      : null,
    row.runningSubagents > 0
      ? `${row.runningSubagents} subagent${row.runningSubagents === 1 ? "" : "s"}`
      : null,
    row.projectTitle || null,
  ].filter((detail) => detail !== null);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={SlideOutRight.duration(350)}
      layout={LinearTransition.duration(250)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.threadTitle}, ${dockAgentPhaseLabel(row.phase)}`}
        onPress={() => props.onPress(row)}
        style={({ pressed }) => [styles.agentRow, pressed ? styles.pressed : null]}
      >
        <View style={styles.agentStatusIcon}>
          {appearance.icon ? (
            <SymbolView
              name={appearance.icon}
              size={20}
              tintColor={appearance.color}
              type="monochrome"
            />
          ) : (
            <View style={[styles.workingDot, { backgroundColor: appearance.color }]} />
          )}
        </View>
        <View style={styles.agentText}>
          <Text numberOfLines={1} style={styles.agentTitle}>
            {row.threadTitle || "Untitled thread"}
          </Text>
          <Text numberOfLines={1} style={styles.agentDetail}>
            <Text style={{ color: appearance.color }}>{dockAgentPhaseLabel(row.phase)}</Text>
            {details.length > 0 ? ` · ${details.join(" · ")}` : ""}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Landscape only: clock on the left, agents stacked on the right.
  root: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.background,
    gap: 32,
  },
  clockPane: {
    flex: 1.2,
    justifyContent: "center",
    gap: 6,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  time: {
    color: COLORS.primary,
    fontWeight: "200",
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
  period: {
    color: COLORS.secondary,
    fontWeight: "400",
  },
  date: {
    color: COLORS.secondary,
    fontSize: 20,
  },
  alarmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  alarmText: {
    color: COLORS.primary,
    fontSize: 17,
    fontVariant: ["tabular-nums"],
  },
  alarmCountdown: {
    color: COLORS.secondary,
  },
  agentsPane: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
    gap: 8,
    // Clears the sound and close buttons in the top corner.
    paddingTop: 44,
  },
  agentsHeader: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  emptyText: {
    color: COLORS.secondary,
    fontSize: 16,
  },
  moreText: {
    color: COLORS.secondary,
    fontSize: 14,
    paddingLeft: 4,
  },
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    backgroundColor: COLORS.panel,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  agentStatusIcon: {
    width: 20,
    alignItems: "center",
  },
  workingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  agentText: {
    flex: 1,
    gap: 2,
  },
  agentTitle: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  agentDetail: {
    color: COLORS.secondary,
    fontSize: 13,
  },
  controls: {
    position: "absolute",
    flexDirection: "row",
    gap: 10,
  },
  controlButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.control,
  },
  pressed: {
    opacity: 0.6,
  },
});
