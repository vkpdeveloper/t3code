import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsActionRow } from "../settings/components/SettingsActionRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import {
  DOCK_AUTO_ENTRY_SUPPORTED,
  dockAutoEntrySuppressedAtom,
  useDockAutoEntryEnabled,
} from "./dockMode";

export function DockModeSettingsSection() {
  const navigation = useNavigation();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const autoEnterEnabled = useDockAutoEntryEnabled();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const hiddenCount = AsyncResult.isSuccess(preferences)
    ? (preferences.value.dockHiddenAgentKeys?.length ?? 0)
    : 0;

  return (
    <View className="gap-3">
      <SettingsSection title="Dock Mode">
        {DOCK_AUTO_ENTRY_SUPPORTED ? (
          <SettingsSwitchRow
            icon="bolt.circle"
            label="Open when charging sideways"
            value={autoEnterEnabled}
            onValueChange={(value) => {
              if (value) appAtomRegistry.set(dockAutoEntrySuppressedAtom, false);
              savePreferences({ dockModeAutoEnterEnabled: value });
            }}
          />
        ) : null}
        <SettingsActionRow
          icon="clock"
          label="Open Dock Mode"
          onPress={() => navigation.navigate("Dock")}
        />
        {hiddenCount > 0 ? (
          <SettingsActionRow
            icon="eye"
            label={`Show ${hiddenCount} hidden agent${hiddenCount === 1 ? "" : "s"} again`}
            onPress={() => savePreferences({ dockHiddenAgentKeys: [] })}
          />
        ) : null}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Keeps the screen on and shows the time, your next alarm, offline machines, and running
        agents. Swipe an agent off the dock to hide it for good.
      </Text>
    </View>
  );
}
