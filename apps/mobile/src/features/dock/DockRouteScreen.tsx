import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { StackActions, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useEffectEvent, useState } from "react";
import {
  AppState,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  LinearTransition,
  SlideOutRight,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentPresentations } from "../../state/presentation";
import { dockAgentPhaseLabel, type DockAgentPhase, type DockAgentRow } from "./dockAgents";
import {
  formatDockAlarmCountdown,
  formatDockTime,
  nextDockAlarm,
  parseDockAlarmTimes,
} from "./dockAlarms";
import { dockMachines, type DockMachine, type DockMachineStatus } from "./dockMachines";
import { dockAlarmTimesAtom, suppressDockAutoEntry, useIsCharging } from "./dockMode";
import { useDockAgents } from "./useDockAgents";

type DockRouteParams = {
  /** Comma-separated alarm times from the Shortcuts automation. */
  readonly alarms?: string;
  /** "auto" when opened by charging sideways; it then closes when turned upright. */
  readonly source?: string;
};

const MAX_VISIBLE_AGENTS = 4;
/** How far a row must be dragged, or how fast flung, to hide it. */
const SWIPE_DISMISS_DISTANCE = 96;
const SWIPE_DISMISS_VELOCITY = 800;
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

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

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

  const { rows: agents, hide: hideAgent } = useDockAgents(() => {
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

  const machines = dockMachines(useAtomValue(environmentPresentations.presentationsAtom));
  const machineStatus = new Map(machines.map((machine) => [machine.environmentId, machine.status]));
  // Only trouble earns space on the dock: connected machines are not listed.
  const offlineMachines = machines.filter((machine) => machine.status === "offline");

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
      {/* React Native's StatusBar restores the app's own settings on unmount.
          The native-stack statusBarHidden option would instead take over the
          status bar for every screen, leaving light icons on light screens. */}
      <StatusBar hidden />
      <View style={styles.clockPane}>
        <View style={styles.timeRow}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.time, { fontSize: timeSize, lineHeight: timeSize * 1.05 }]}
          >
            {formatDockTime(now)}
          </Text>
        </View>
        <Text style={styles.date}>{DATE_FORMAT.format(now)}</Text>
        {nextAlarm ? (
          <View style={styles.alarmRow}>
            <SymbolView name="alarm" size={18} tintColor={COLORS.secondary} type="monochrome" />
            <Text style={styles.alarmText}>
              {formatDockTime(nextAlarm)}
              <Text style={styles.alarmCountdown}>
                {"  "}
                {formatDockAlarmCountdown(nextAlarm, now)}
              </Text>
            </Text>
          </View>
        ) : null}
        {offlineMachines.length > 0 ? <DockMachineList machines={offlineMachines} /> : null}
      </View>

      <View style={styles.agentsPane}>
        <Text style={styles.agentsHeader}>
          {activeCount > 0 ? `${activeCount} agent${activeCount === 1 ? "" : "s"}` : "Agents"}
        </Text>
        {visibleAgents.length === 0 ? (
          <Text style={styles.emptyText}>No agents running</Text>
        ) : (
          visibleAgents.map((row) => (
            <DockAgentRowView
              key={row.key}
              row={row}
              machineStatus={machineStatus.get(row.environmentId) ?? "offline"}
              nowMs={now.getTime()}
              onHide={hideAgent}
            />
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

function phaseAppearance(
  phase: DockAgentPhase,
  machine: DockMachineStatus,
  finished: boolean,
): { readonly color: string; readonly icon: AppSymbolName | null; readonly label: string } {
  // A "Working" row from a machine the dock cannot reach would be a lie.
  if (!finished && machine !== "online") {
    return machine === "connecting"
      ? { color: COLORS.secondary, icon: null, label: "Connecting" }
      : { color: COLORS.failed, icon: "wifi.slash", label: "Machine offline" };
  }
  const label = dockAgentPhaseLabel(phase);
  switch (phase) {
    case "starting":
    case "running":
      return { color: COLORS.working, icon: null, label };
    case "waiting_for_approval":
    case "waiting_for_input":
      return { color: COLORS.attention, icon: "exclamationmark.circle", label };
    case "completed":
      return { color: COLORS.done, icon: "checkmark.circle", label };
    case "failed":
      return { color: COLORS.failed, icon: "xmark.circle.fill", label };
  }
}

/** Machines the dock cannot reach, each with a red dot and "Offline". */
function DockMachineList(props: { readonly machines: ReadonlyArray<DockMachine> }) {
  return (
    <View style={styles.machineList}>
      {props.machines.map((machine) => (
        <View
          key={machine.environmentId}
          accessibilityLabel={`${machine.label}, offline`}
          style={styles.machine}
        >
          <View style={[styles.machineDot, { backgroundColor: COLORS.failed }]} />
          <Text numberOfLines={1} style={styles.machineLabel}>
            {machine.label}
          </Text>
          <Text style={[styles.machineStatus, { color: COLORS.failed }]}>Offline</Text>
        </View>
      ))}
    </View>
  );
}

function DockAgentRowView(props: {
  readonly row: DockAgentRow;
  readonly machineStatus: DockMachineStatus;
  readonly nowMs: number;
  readonly onHide: (key: string) => void;
}) {
  const { row, onHide } = props;
  const finished = row.finishedAtMs !== null;
  const appearance = phaseAppearance(row.phase, props.machineStatus, finished);

  // Any row can be swiped away in either direction; that agent stays hidden.
  const offsetX = useSharedValue(0);
  const swipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      offsetX.set(event.translationX);
    })
    .onEnd((event) => {
      const hidden =
        Math.abs(event.translationX) > SWIPE_DISMISS_DISTANCE ||
        Math.abs(event.velocityX) > SWIPE_DISMISS_VELOCITY;
      if (!hidden) {
        offsetX.set(withTiming(0, { duration: 150 }));
        return;
      }
      const direction = event.translationX + event.velocityX * 0.1 < 0 ? -1 : 1;
      offsetX.set(
        withTiming(direction * 1_000, { duration: 180 }, (done) => {
          if (done) runOnJS(onHide)(row.key);
        }),
      );
    });
  const swipeStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(Math.abs(offsetX.get()) / 400, 0.7),
    transform: [{ translateX: offsetX.get() }],
  }));
  const details = [
    !finished && props.machineStatus === "online" && row.startedAtMs !== null
      ? formatElapsed(props.nowMs - row.startedAtMs)
      : null,
    row.runningSubagents > 0
      ? `${row.runningSubagents} subagent${row.runningSubagents === 1 ? "" : "s"}`
      : null,
    row.projectTitle || null,
  ].filter((detail) => detail !== null);

  // Rows are glanceable only: no tap target, so nothing opens a thread.
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={SlideOutRight.duration(350)}
      layout={LinearTransition.duration(250)}
    >
      <GestureDetector gesture={swipe}>
        <Animated.View
          accessible
          accessibilityLabel={`${row.threadTitle}, ${appearance.label}`}
          accessibilityActions={[{ name: "hide", label: "Hide from Dock" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "hide") onHide(row.key);
          }}
          style={[styles.agentRow, swipeStyle]}
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
              <Text style={{ color: appearance.color }}>{appearance.label}</Text>
              {details.length > 0 ? ` · ${details.join(" · ")}` : ""}
            </Text>
          </View>
        </Animated.View>
      </GestureDetector>
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
  machineList: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 16,
    rowGap: 6,
    marginTop: 14,
  },
  machine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 240,
  },
  machineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  machineLabel: {
    color: COLORS.secondary,
    fontSize: 14,
    flexShrink: 1,
  },
  machineStatus: {
    fontSize: 14,
    fontWeight: "600",
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
