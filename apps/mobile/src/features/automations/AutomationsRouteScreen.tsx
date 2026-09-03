import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { Automation, EnvironmentId } from "@t3tools/contracts";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useState } from "react";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { automationEnvironment, useAutomations } from "../../state/automations";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironments } from "../../state/environments";

function formatSchedule(automation: Automation): string {
  switch (automation.schedule.kind) {
    case "hourly":
      return `Every hour at :${String(automation.schedule.minute).padStart(2, "0")}`;
    case "daily":
      return `Daily at ${automation.schedule.time}`;
    case "weekdays":
      return `Weekdays at ${automation.schedule.time}`;
    case "weekly":
      return `${automation.schedule.weekday[0]?.toUpperCase()}${automation.schedule.weekday.slice(1)} at ${automation.schedule.time}`;
  }
}

function failureMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag === "Success") return null;
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error && cause.message.trim() !== ""
    ? cause.message
    : "The automation request failed.";
}

function AutomationEnvironmentSection(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  const query = useAutomations(props.environmentId);
  const refresh = query.refresh;
  const runNow = useAtomCommand(automationEnvironment.runNow);
  const update = useAtomCommand(automationEnvironment.update);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const mutate = async (
    automation: Automation,
    action: () => Promise<AtomCommandResult<unknown, unknown>>,
  ) => {
    setWorkingId(automation.id);
    setError(null);
    const result = await action();
    setWorkingId(null);
    setError(failureMessage(result));
  };

  return (
    <View className="gap-2">
      <Text className="px-2 text-sm font-t3-medium text-foreground-muted">{props.label}</Text>
      <View className="overflow-hidden rounded-[24px] border-continuous bg-card">
        {query.isPending && query.data === null ? (
          <Text className="p-4 text-base text-foreground-muted">Loading…</Text>
        ) : query.error ? (
          <Text className="p-4 text-base text-destructive">{query.error}</Text>
        ) : query.data?.automations.length ? (
          query.data.automations.map((automation, index) => {
            const latestRun = automation.runs[0];
            return (
              <View
                className={`gap-3 p-4 ${index > 0 ? "border-t border-separator" : ""}`}
                key={automation.id}
              >
                <View className="flex-row items-start gap-3">
                  <SymbolView
                    name="clock"
                    size={20}
                    tintColorClassName="accent-icon"
                    type="monochrome"
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-t3-medium text-foreground" numberOfLines={1}>
                      {automation.name}
                    </Text>
                    <Text className="mt-0.5 text-sm text-foreground-muted">
                      {formatSchedule(automation)} · {automation.modelSelection.model}
                    </Text>
                  </View>
                  {!automation.enabled ? (
                    <Text className="text-sm text-foreground-muted">Paused</Text>
                  ) : null}
                </View>
                {latestRun ? (
                  <Pressable
                    accessibilityRole="button"
                    className="flex-row items-center gap-2 rounded-xl bg-surface px-3 py-2"
                    onPress={() =>
                      navigation.navigate("Thread", {
                        environmentId: props.environmentId,
                        threadId: latestRun.threadId,
                      })
                    }
                  >
                    <SymbolView
                      name="text.bubble"
                      size={17}
                      tintColorClassName="accent-icon"
                      type="monochrome"
                    />
                    <Text className="flex-1 text-base text-foreground">Open latest run</Text>
                    <SymbolView
                      name="chevron.right"
                      size={15}
                      tintColorClassName="accent-chevron"
                      type="monochrome"
                    />
                  </Pressable>
                ) : null}
                <View className="flex-row gap-2">
                  <Pressable
                    accessibilityRole="button"
                    className="flex-1 items-center rounded-xl bg-surface px-3 py-2.5"
                    disabled={workingId === automation.id}
                    onPress={() =>
                      void mutate(automation, () =>
                        runNow({
                          environmentId: props.environmentId,
                          input: { id: automation.id },
                        }),
                      )
                    }
                  >
                    <Text className="font-t3-medium text-foreground">Run now</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    className="flex-1 items-center rounded-xl bg-surface px-3 py-2.5"
                    disabled={workingId === automation.id}
                    onPress={() =>
                      void mutate(automation, () =>
                        update({
                          environmentId: props.environmentId,
                          input: {
                            id: automation.id,
                            name: automation.name,
                            prompt: automation.prompt,
                            projectId: automation.projectId,
                            schedule: automation.schedule,
                            modelSelection: automation.modelSelection,
                            runtimeMode: automation.runtimeMode,
                            enabled: !automation.enabled,
                          },
                        }),
                      )
                    }
                  >
                    <Text className="font-t3-medium text-foreground">
                      {automation.enabled ? "Pause" : "Resume"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        ) : (
          <Text className="p-4 text-base text-foreground-muted">No automations</Text>
        )}
      </View>
      {error ? <Text className="px-2 text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

export function AutomationsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Automations" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {environments.map((environment) => (
          <AutomationEnvironmentSection
            environmentId={environment.environmentId}
            key={environment.environmentId}
            label={environment.label}
          />
        ))}
        {environments.length === 0 ? (
          <Text className="px-2 text-base text-foreground-muted">
            Connect a machine to view its automations.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
