import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Notifications from "expo-notifications";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback } from "react";
import { Alert, Linking, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { supportsAgentStatusNotification } from "./nativeAgentStatus";

/**
 * Android-only switches for the persistent agent status notification and
 * local transition alerts. Both are device-local preferences; the native
 * module reads nothing from the server.
 */
export function AgentStatusSettingsSection() {
  return supportsAgentStatusNotification() ? <AndroidAgentStatusSettingsSection /> : null;
}

function AndroidAgentStatusSettingsSection() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferences);
  const statusEnabled = loaded && preferences.value.agentStatusNotificationEnabled === true;
  const alertsEnabled = loaded && preferences.value.agentAlertsEnabled === true;

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!existing.canAskAgain) {
      Alert.alert(
        "Notifications are off",
        "Allow notifications for T3 Code in Android settings to show agent status.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ],
      );
      return false;
    }
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }, []);

  const toggle = useCallback(
    (key: "agentStatusNotificationEnabled" | "agentAlertsEnabled", value: boolean) => {
      if (!value) {
        savePreferences({ [key]: false });
        return;
      }
      void ensurePermission().then((granted) => {
        if (granted) savePreferences({ [key]: true });
      });
    },
    [ensurePermission, savePreferences],
  );

  return (
    <View className="gap-3">
      <SettingsSection title="Notifications">
        <SettingsSwitchRow
          icon="bolt.circle"
          label="Agent Status"
          subtitle="Ongoing summary of agents working across your machines"
          disabled={!loaded}
          value={statusEnabled}
          onValueChange={(value) => toggle("agentStatusNotificationEnabled", value)}
        />
        <SettingsSwitchRow
          icon="bell.badge"
          label="Agent Alerts"
          subtitle="Finished, failed, approval or input needed"
          disabled={!loaded}
          value={alertsEnabled}
          onValueChange={(value) => toggle("agentAlertsEnabled", value)}
        />
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Agent Status keeps T3 Code connected in the background while agents run. Everything stays on
        this device: no push service is involved.
      </Text>
    </View>
  );
}
