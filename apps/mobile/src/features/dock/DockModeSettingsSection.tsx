import { useAtomSet } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { appAtomRegistry } from "../../state/atom-registry";
import { updateMobilePreferencesAtom } from "../../state/preferences";
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
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Keeps the screen on and shows the time, your next alarm, and running agents.
      </Text>
    </View>
  );
}
