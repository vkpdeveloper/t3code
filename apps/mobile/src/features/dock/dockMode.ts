import { useAtomValue } from "@effect/atom-react";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import * as Battery from "expo-battery";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import type { DockAlarmTime } from "./dockAlarms";

/**
 * Charging-and-sideways auto entry is an iPhone nightstand feature. iPads sit
 * in landscape on a charger all day, and Android phones stay portrait-locked,
 * so both only get Dock mode on request.
 */
export const DOCK_AUTO_ENTRY_SUPPORTED = Platform.OS === "ios" && !Platform.isPad;

type ScreenOrientation = NonNullable<NativeStackNavigationOptions["orientation"]>;

/**
 * Dock mode is landscape-only. iPads cannot be forced (multitasking apps
 * rotate freely), so they keep whatever the user holds. An automatic iPhone
 * dock may still rotate upright, because turning the phone upright is how it
 * closes.
 */
export function dockScreenOrientation(source: unknown): ScreenOrientation | undefined {
  if (Platform.OS === "ios" && Platform.isPad) return undefined;
  if (DOCK_AUTO_ENTRY_SUPPORTED && source === "auto") return "default";
  return "landscape";
}

/**
 * Orientation for every other root screen. Once any screen sets an
 * orientation, react-native-screens reapplies the top screen's value on each
 * navigation and treats "unset" as free rotation, so phones must say portrait
 * explicitly or leaving Dock mode would unlock the whole app. An armed iPhone
 * may follow the phone sideways, which is what opens Dock mode.
 */
export function rootScreenOrientation(input: {
  readonly dockArmed: boolean;
  readonly smallestWindowSide: number;
}): ScreenOrientation | undefined {
  if (Platform.OS === "ios") {
    if (Platform.isPad) return undefined;
    return input.dockArmed ? "default" : "portrait_up";
  }
  // Mirrors withAndroidTabletOrientation: tablets rotate freely.
  return input.smallestWindowSide >= 600 ? undefined : "portrait_up";
}

/**
 * Set when the user leaves Dock mode themselves, so it does not reopen while
 * the phone is still charging sideways. Cleared on unplug.
 */
export const dockAutoEntrySuppressedAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:dock:auto-entry-suppressed"),
);

/** Latest alarm times handed over by the Shortcuts automation. */
export const dockAlarmTimesAtom = Atom.make<ReadonlyArray<DockAlarmTime>>([]).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:dock:alarm-times"),
);

export function suppressDockAutoEntry(): void {
  appAtomRegistry.set(dockAutoEntrySuppressedAtom, true);
}

function isChargingState(state: Battery.BatteryState): boolean {
  return state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
}

/**
 * Whether the device is plugged in, or null until the first reading. Only
 * listens while `active`.
 */
export function useIsCharging(active: boolean): boolean | null {
  const [charging, setCharging] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const subscription = Battery.addBatteryStateListener(({ batteryState }) => {
      setCharging(isChargingState(batteryState));
    });
    void Battery.getBatteryStateAsync()
      .then((state) => {
        if (!disposed) setCharging(isChargingState(state));
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      subscription.remove();
    };
  }, [active]);

  return active ? charging : null;
}

export function useDockAutoEntryEnabled(): boolean {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return (
    DOCK_AUTO_ENTRY_SUPPORTED &&
    AsyncResult.isSuccess(preferences) &&
    preferences.value.dockModeAutoEnterEnabled === true
  );
}

/**
 * True while turning the phone sideways should open Dock mode. The root stack
 * only lets iPhone screens rotate while this holds, which is also how the
 * rotation becomes visible to the app.
 */
export function useDockAutoEntryArmed(): boolean {
  const enabled = useDockAutoEntryEnabled();
  const charging = useIsCharging(enabled);
  const suppressed = useAtomValue(dockAutoEntrySuppressedAtom);

  useEffect(() => {
    if (charging === false && suppressed) {
      appAtomRegistry.set(dockAutoEntrySuppressedAtom, false);
    }
  }, [charging, suppressed]);

  return enabled && charging === true && !suppressed;
}
