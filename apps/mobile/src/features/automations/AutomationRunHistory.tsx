import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { automationRunStatusLabel } from "@t3tools/client-runtime/state/automations";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { Automation, AutomationRun, EnvironmentId } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

const PAGE_SIZE = 20;
const runDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function AutomationRunRow({
  environmentId,
  run,
}: {
  environmentId: EnvironmentId;
  run: AutomationRun;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>();
  const thread = useThreadShell(scopeThreadRef(environmentId, run.threadId));
  const restore = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const status = automationRunStatusLabel(run, thread);
  const error =
    restoreError ?? run.error ?? (status === "Failed" ? thread?.session?.lastError : null);
  const canOpen = thread !== null;
  const date = runDateFormatter.format(new Date(run.scheduledFor));

  const restoreThread = async () => {
    setRestoring(true);
    setRestoreError(null);
    const result = await restore({ environmentId, input: { threadId: run.threadId } });
    setRestoring(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setRestoreError(
        cause instanceof Error ? cause.message : "Could not restore this run's thread.",
      );
    }
  };

  return (
    <View className="gap-2 border-t border-separator py-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open run from ${date}, ${status}`}
        accessibilityState={{ disabled: !canOpen }}
        disabled={!canOpen}
        className="flex-row items-center gap-2"
        onPress={() => navigation.navigate("Thread", { environmentId, threadId: run.threadId })}
      >
        <View className="flex-1 gap-1">
          <Text className="text-sm font-t3-medium text-foreground">{date}</Text>
          <Text className="text-sm text-foreground-muted">
            {status} · {run.trigger === "manual" ? "Manual" : "Scheduled"}
          </Text>
          {!canOpen ? (
            <Text className="text-xs text-foreground-muted">
              {run.status === "pending" ? "Waiting to start" : "Thread unavailable"}
            </Text>
          ) : null}
        </View>
        {canOpen ? (
          <SymbolView
            name="chevron.right"
            size={15}
            tintColorClassName="accent-chevron"
            type="monochrome"
          />
        ) : null}
      </Pressable>
      {!canOpen && run.status === "started" ? (
        <Pressable
          accessibilityRole="button"
          disabled={restoring}
          className="self-start rounded-xl bg-surface px-3 py-2.5"
          onPress={() => void restoreThread()}
        >
          <Text className="font-t3-medium text-foreground">
            {restoring ? "Restoring…" : "Restore thread"}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text selectable className="text-sm text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function AutomationRunHistory({
  environmentId,
  automation,
}: {
  environmentId: EnvironmentId;
  automation: Automation;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  return (
    <View>
      {automation.runs.length === 0 ? (
        <Text className="py-3 text-sm text-foreground-muted">No runs yet</Text>
      ) : (
        automation.runs
          .slice(0, visibleCount)
          .map((run) => <AutomationRunRow key={run.id} environmentId={environmentId} run={run} />)
      )}
      {visibleCount < automation.runs.length ? (
        <Pressable
          accessibilityRole="button"
          className="items-center rounded-xl bg-surface px-3 py-2.5"
          onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          <Text className="font-t3-medium text-foreground">Show older runs</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
