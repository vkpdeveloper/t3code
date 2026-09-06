import type {
  EnvironmentId,
  ServerSettingsPatch,
  VibeProxySettings,
  VibeProxyUsageAccount,
} from "@t3tools/contracts";
import {
  collectVibeProxyPools,
  describeMissingConfiguration,
  formatQuotaPercent,
  formatQuotaReset,
  formatQuotaResetShort,
  formatSnapshotAge,
  formatSuccessRate,
  resolveVibeProxyUsageStage,
  vibeProxyAccountName,
  vibeProxyAccountStatus,
  vibeProxyAccountSubtitle,
  vibeProxyProviderInitials,
  vibeProxyProviderKind,
  vibeProxyQuotaSummary,
  vibeProxyRecentActivity,
  vibeProxyRequestHealth,
  type VibeProxyAccountPool,
  type VibeProxyAccountTone,
  type VibeProxyPoolWindow,
  type VibeProxyProviderKind,
} from "@t3tools/shared/vibeProxyUsage";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { VibeProxyUsageView } from "../../state/vibeProxyUsage";
import { SettingsSection } from "../settings/components/SettingsSection";
import { useProviderColors } from "./usageProviders";

const TONE_TEXT_CLASS: Readonly<Record<VibeProxyAccountTone, string>> = {
  ok: "text-success",
  warning: "text-warning",
  error: "text-danger-foreground",
  muted: "text-foreground-muted",
};

function poolBarColor(
  kind: VibeProxyProviderKind,
  colors: ReturnType<typeof useProviderColors>,
): string {
  if (kind === "codex" || kind === "claude" || kind === "grok") return colors[kind];
  return colors.codex;
}

function remainingLabel(remainingPercent: number | null): string {
  return remainingPercent === null ? "Unknown" : formatQuotaPercent(remainingPercent);
}

function refillRemaining(resetAt: string | null, nowMs: number): string {
  const label = formatQuotaReset(resetAt, nowMs);
  if (label === null || label === "Reset due") return "now";
  return `in ${label.replace(/^Resets in /u, "")}`;
}

type SettingsUpdateOutcome = { readonly _tag: "Success" } | { readonly _tag: "Failure" };

export function VibeProxyUsageSection(props: { readonly usage: VibeProxyUsageView }) {
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "Vibe-Proxy settings update",
    reportFailure: false,
  });
  const { usage } = props;
  const environmentId = usage.environmentId;
  const settings = usage.settings;

  if (environmentId === null || settings === null) {
    return (
      <SettingsSection title="Vibe-Proxy" card>
        <StateNotice>Connect an environment to configure Vibe-Proxy.</StateNotice>
      </SettingsSection>
    );
  }

  const saveSettings = async (
    environmentId: EnvironmentId,
    patch: ServerSettingsPatch,
  ): Promise<SettingsUpdateOutcome> => {
    const outcome = await updateSettings({ environmentId, input: { patch } });
    if (outcome._tag === "Success") usage.refresh();
    return outcome;
  };

  return (
    <>
      <SettingsSection title="Vibe-Proxy" card>
        <VibeProxyConfigurationForm
          settings={settings}
          onSave={(patch) => saveSettings(environmentId, patch)}
        />
      </SettingsSection>
      <AccountsSection settings={settings} usage={usage} />
    </>
  );
}

function VibeProxyConfigurationForm(props: {
  readonly settings: VibeProxySettings;
  readonly onSave: (patch: ServerSettingsPatch) => Promise<SettingsUpdateOutcome>;
}) {
  const [enabled, setEnabled] = useState(props.settings.enabled);
  const [baseUrl, setBaseUrl] = useState(props.settings.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isSaving) return;
    setEnabled(props.settings.enabled);
    setBaseUrl(props.settings.baseUrl);
  }, [isSaving, props.settings.baseUrl, props.settings.enabled]);

  const save = async () => {
    setIsSaving(true);
    setMessage(null);
    const trimmedKey = apiKey.trim();
    const outcome = await props.onSave({
      vibeProxy: {
        enabled,
        baseUrl: baseUrl.trim(),
        ...(trimmedKey.length > 0 ? { apiKey: trimmedKey } : {}),
      },
    });
    setIsSaving(false);
    if (outcome._tag === "Failure") {
      setMessage("Could not save Vibe-Proxy settings.");
      return;
    }
    setApiKey("");
    setMessage("Saved");
  };

  const removeKey = async () => {
    setIsSaving(true);
    setMessage(null);
    const outcome = await props.onSave({ vibeProxy: { apiKey: "" } });
    setIsSaving(false);
    if (outcome._tag === "Failure") {
      setMessage("Could not remove the API key.");
      return;
    }
    setApiKey("");
    setMessage("Key removed");
  };

  return (
    <View className="gap-4 p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-base text-foreground">Enabled</Text>
          <Text className="text-xs text-foreground-muted">
            Read subscription limits from Vibe-Proxy.
          </Text>
        </View>
        <ThemedSwitch
          accessibilityLabel="Enable Vibe-Proxy usage"
          disabled={isSaving}
          onValueChange={setEnabled}
          value={enabled}
        />
      </View>
      <View className="gap-1.5">
        <Text className="text-xs font-t3-medium text-foreground-muted">Base URL</Text>
        <TextInput
          accessibilityLabel="Vibe-Proxy API base URL"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          keyboardType="url"
          onChangeText={setBaseUrl}
          placeholder="https://vibe-proxy.example.com"
          value={baseUrl}
        />
      </View>
      <View className="gap-1.5">
        <Text className="text-xs font-t3-medium text-foreground-muted">Management API key</Text>
        <TextInput
          accessibilityLabel="Vibe-Proxy API key"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isSaving}
          onChangeText={setApiKey}
          placeholder={props.settings.apiKeyRedacted ? "Stored, enter to replace" : "API key"}
          secureTextEntry
          value={apiKey}
        />
      </View>
      <View className="flex-row items-center justify-end gap-2">
        {message ? <Text className="mr-auto text-xs text-foreground-muted">{message}</Text> : null}
        {props.settings.apiKeyRedacted ? (
          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={() => void removeKey()}
            className="min-h-[42px] justify-center rounded-[14px] border border-input-border px-3 active:opacity-60"
          >
            <Text className="text-xs font-t3-medium text-danger-foreground">Remove key</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={isSaving}
          onPress={() => void save()}
          className={
            isSaving
              ? "min-h-[42px] justify-center rounded-[14px] bg-primary px-4 opacity-50"
              : "min-h-[42px] justify-center rounded-[14px] bg-primary px-4 active:opacity-70"
          }
        >
          <Text className="text-xs font-t3-medium text-primary-foreground">
            {isSaving ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function AccountsSection(props: {
  readonly settings: VibeProxySettings;
  readonly usage: VibeProxyUsageView;
}) {
  const colors = useProviderColors();
  // Anchored once per mount: a live clock would repaint the page every render.
  const [nowMs] = useState(() => Date.now());
  const stage = resolveVibeProxyUsageStage({
    settings: props.settings,
    result: props.usage.result,
    isRefreshing: props.usage.isRefreshing,
    transportError: props.usage.error,
  });
  const pools = useMemo(
    () => (stage.kind === "accounts" ? collectVibeProxyPools(stage.accounts) : []),
    [stage],
  );
  const snapshotAge = stage.kind === "accounts" ? formatSnapshotAge(stage.fetchedAt, nowMs) : null;

  return (
    <SettingsSection title="Accounts" card>
      <View className="flex-row items-center justify-between gap-4 p-4">
        <Text className="min-w-0 flex-1 text-xs text-foreground-muted">
          {snapshotAge ?? "Subscription quotas and request health"}
        </Text>
        <Pressable
          accessibilityLabel="Refresh Vibe-Proxy limits"
          accessibilityRole="button"
          disabled={props.usage.isRefreshing}
          onPress={props.usage.refresh}
          className={
            props.usage.isRefreshing
              ? "rounded-full bg-subtle px-3 py-2 opacity-50"
              : "rounded-full bg-subtle px-3 py-2 active:opacity-60"
          }
        >
          <Text className="text-xs font-t3-medium text-foreground">
            {props.usage.isRefreshing ? "Refreshing..." : "Refresh"}
          </Text>
        </Pressable>
      </View>

      {stage.kind === "disabled" ? (
        <StateNotice>Turn on Vibe-Proxy to see account quotas.</StateNotice>
      ) : null}
      {stage.kind === "unconfigured" ? (
        <StateNotice>{describeMissingConfiguration(stage.missing)}</StateNotice>
      ) : null}
      {stage.kind === "loading" ? <StateNotice>Loading account limits...</StateNotice> : null}
      {stage.kind === "empty" ? (
        <StateNotice warning={stage.problem !== null}>
          {stage.problem ?? "Vibe-Proxy reported no accounts."}
        </StateNotice>
      ) : null}
      {stage.kind === "accounts" ? (
        <View className={stage.stale ? "opacity-60" : undefined}>
          {stage.problem ? (
            <StateNotice warning>
              {stage.problem} Showing the last values Vibe-Proxy reported.
            </StateNotice>
          ) : null}
          {pools.length === 0 ? (
            <StateNotice>Vibe-Proxy reported no accounts.</StateNotice>
          ) : (
            pools.map((pool) => (
              <ProviderPool
                key={pool.key}
                pool={pool}
                color={poolBarColor(pool.kind, colors)}
                nowMs={nowMs}
              />
            ))
          )}
        </View>
      ) : null}
    </SettingsSection>
  );
}

function ProviderPool(props: {
  readonly pool: VibeProxyAccountPool;
  readonly color: string;
  readonly nowMs: number;
}) {
  const accountCount =
    props.pool.windows.reduce((sum, window) => Math.max(sum, window.members.length), 0) ||
    props.pool.unpooled.length;
  return (
    <View className="gap-3 border-t border-border-subtle px-4 py-4">
      <View className="flex-row items-center gap-2">
        <ProviderMark provider={props.pool.provider} />
        <Text className="text-sm font-t3-medium text-foreground">{props.pool.label}</Text>
        <Text className="text-xs text-foreground-tertiary">{accountCount}</Text>
      </View>
      {props.pool.windows.map((window) => (
        <PoolWindowCard key={window.id} pool={window} color={props.color} nowMs={props.nowMs} />
      ))}
      {props.pool.unpooled.map((account) => (
        <UnpooledAccount key={account.id} account={account} />
      ))}
    </View>
  );
}

function PoolWindowCard(props: {
  readonly pool: VibeProxyPoolWindow;
  readonly color: string;
  readonly nowMs: number;
}) {
  const nextRefill = props.pool.resets.find((reset) => reset.restoresPercent > 0);
  return (
    <View className="gap-3 rounded-[24px] border-continuous bg-card p-4">
      <View className="gap-1">
        <Text className="text-sm font-t3-medium text-foreground">{props.pool.label}</Text>
        <View className="flex-row items-baseline gap-1.5">
          <Text className="text-3xl font-t3-bold tabular-nums text-foreground">
            {props.pool.remainingPercent === null ? "—" : `${props.pool.remainingPercent}%`}
          </Text>
          <Text className="text-sm text-foreground-muted">left</Text>
        </View>
      </View>
      {nextRefill ? (
        <Text className="text-xs tabular-nums text-foreground-muted">
          ↻ +{nextRefill.restoresPercent}%{" "}
          {refillRemaining(nextRefill.member.window.resetAt, props.nowMs)}
        </Text>
      ) : null}
      <View className="flex-row gap-1">
        {props.pool.members.map((member, index) => {
          const remaining = member.window.remainingPercent ?? 0;
          return (
            <View
              key={member.account.id}
              accessibilityLabel={`Segment ${index + 1}, ${vibeProxyAccountName(member.account)}, ${remainingLabel(member.window.remainingPercent)} left${member.account.selected ? ", in use" : ""}`}
              className="h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-subtle"
            >
              <View
                className="h-full"
                style={{ width: `${remaining}%`, backgroundColor: props.color, opacity: 0.35 }}
              />
              <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
                <Text className="text-xs font-t3-medium tabular-nums text-foreground">
                  {index + 1}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <View>
        {props.pool.members.map((member, index) => {
          const status = vibeProxyAccountStatus(member.account);
          const health = vibeProxyRequestHealth(member.account);
          const activity = vibeProxyRecentActivity(member.account);
          const resetsIn = formatQuotaResetShort(member.window.resetAt, props.nowMs);
          return (
            <View key={member.account.id} className="min-h-[44px] gap-0.5 py-1.5">
              <View className="flex-row items-center gap-2">
                <View className="size-5 items-center justify-center overflow-hidden rounded-md bg-subtle-strong">
                  <Text className="text-xs font-t3-medium tabular-nums text-foreground">
                    {index + 1}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  className="min-w-0 flex-1 text-sm font-t3-medium text-foreground"
                >
                  {vibeProxyAccountName(member.account)}
                </Text>
                {member.account.selected ? (
                  <Text className="shrink-0 text-xs font-t3-medium text-success">In use</Text>
                ) : null}
                <Text className="text-sm font-t3-medium tabular-nums text-foreground">
                  {remainingLabel(member.window.remainingPercent)}
                </Text>
                {resetsIn ? (
                  <Text className="text-xs tabular-nums text-foreground-muted">{resetsIn}</Text>
                ) : null}
              </View>
              <Text className="pl-7 text-xs text-foreground-muted">
                <Text className={TONE_TEXT_CLASS[status.tone]}>{status.label}</Text>
                {`  ·  ${formatSuccessRate(health.successRate)}`}
                {health.total > 0 ? ` of ${health.total.toLocaleString()}` : ""}
                {health.failed > 0 ? `  ·  ${health.failed.toLocaleString()} failed` : ""}
              </Text>
              {activity.buckets.length > 0 ? (
                <Text className="pl-7 text-xs text-foreground-tertiary">
                  Recent: {activity.success.toLocaleString()} ok, {activity.failed.toLocaleString()}{" "}
                  failed
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function UnpooledAccount(props: { readonly account: VibeProxyUsageAccount }) {
  const status = vibeProxyAccountStatus(props.account);
  const health = vibeProxyRequestHealth(props.account);
  const quota = vibeProxyQuotaSummary(props.account);
  const subtitle = vibeProxyAccountSubtitle(props.account);
  const plan = props.account.planType?.trim() || props.account.accountType?.trim() || null;
  const activity = vibeProxyRecentActivity(props.account);

  return (
    <View className="gap-1 rounded-[24px] border-continuous bg-card p-4">
      <View className="flex-row items-center gap-2">
        <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-t3-medium text-foreground">
          {vibeProxyAccountName(props.account)}
        </Text>
        {props.account.selected ? (
          <Text className="shrink-0 text-xs font-t3-medium text-success">In use</Text>
        ) : null}
        {plan ? <Text className="text-xs text-foreground-muted">{plan}</Text> : null}
      </View>
      {subtitle ? (
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      <Text className="text-xs text-foreground-muted">
        <Text className={TONE_TEXT_CLASS[status.tone]}>{status.label}</Text>
        {`  ·  ${formatSuccessRate(health.successRate)}`}
        {health.total > 0 ? ` of ${health.total.toLocaleString()}` : ""}
        {health.failed > 0 ? `  ·  ${health.failed.toLocaleString()} failed` : ""}
      </Text>
      {activity.buckets.length > 0 ? (
        <Text className="text-xs text-foreground-tertiary">
          Recent: {activity.success.toLocaleString()} ok, {activity.failed.toLocaleString()} failed
        </Text>
      ) : null}
      {quota.kind !== "windows" ? (
        <Text className="text-xs text-foreground-muted">{quota.message}</Text>
      ) : null}
    </View>
  );
}

function ProviderMark(props: { readonly provider: string }) {
  const kind = vibeProxyProviderKind(props.provider);
  const provider = kind === "claude" ? "claudeAgent" : kind;
  if (provider === "codex" || provider === "claudeAgent" || provider === "grok") {
    return <ProviderIcon provider={provider} size={17} />;
  }
  return (
    <View className="size-5 items-center justify-center rounded-md bg-subtle-strong">
      <Text className="text-[8px] font-t3-bold text-foreground-muted">
        {vibeProxyProviderInitials(props.provider)}
      </Text>
    </View>
  );
}

function StateNotice(props: { readonly warning?: boolean; readonly children: React.ReactNode }) {
  return (
    <Text
      className={
        props.warning
          ? "border-t border-border-subtle px-4 py-4 text-sm text-warning"
          : "border-t border-border-subtle px-4 py-4 text-sm text-foreground-muted"
      }
    >
      {props.children}
    </Text>
  );
}
