import { AlertTriangleIcon, GaugeIcon, RefreshCwIcon } from "lucide-react";
import type { VibeProxyUsageAccount } from "@t3tools/contracts";
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
  vibeProxyQuotaSummary,
  vibeProxyRecentActivity,
  vibeProxyRequestHealth,
  type VibeProxyAccountPool,
  type VibeProxyAccountTone,
  type VibeProxyPoolMember,
  type VibeProxyPoolWindow,
  type VibeProxyProviderKind,
  type VibeProxyQuotaWindowView,
} from "@t3tools/shared/vibeProxyUsage";
import { type ReactNode, useMemo, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { useVibeProxyUsage } from "~/state/vibeProxyUsage";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { VibeProxyProviderMark } from "./VibeProxyProviderMark";

const TONE_TEXT_CLASS: Readonly<Record<VibeProxyAccountTone, string>> = {
  ok: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-error-foreground",
  muted: "text-muted-foreground",
};

const PROVIDER_BAR_COLOR: Readonly<Record<VibeProxyProviderKind, string>> = {
  codex: "var(--contrast-foreground)",
  claude: "#d97757",
  grok: "color-mix(in oklab, var(--contrast-foreground) 72%, var(--background))",
  antigravity: "var(--foreground)",
  gemini: "var(--foreground)",
  unknown: "var(--foreground)",
};

function remainingLabel(window: VibeProxyQuotaWindowView): string {
  return window.remainingPercent === null ? "Unknown" : formatQuotaPercent(window.remainingPercent);
}

function remainingWidth(window: VibeProxyQuotaWindowView): number {
  return window.remainingPercent === null ? 0 : Math.round(window.remainingPercent);
}

function refillRemaining(resetAt: string | null, nowMs: number): string {
  const label = formatQuotaReset(resetAt, nowMs);
  if (label === null || label === "Reset due") return "now";
  return `in ${label.replace(/^Resets in /u, "")}`;
}

/** `someone@example.com` → `SE`: enough to tell accounts apart, too little to identify one. */
function accountInitials(value: string): string {
  const [local = "", domain = ""] = value.split("@");
  if (domain.length > 0) return `${local[0] ?? ""}${domain[0] ?? ""}`.toUpperCase() || "?";
  const words = value
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}

function accountHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}

function AccountChip({ value }: { readonly value: string }) {
  const hue = accountHue(value);
  const initials = accountInitials(value);
  return (
    <span
      role="img"
      aria-label={`Account ${initials}`}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] leading-none font-semibold"
      style={{ backgroundColor: `oklch(0.85 0.08 ${hue})`, color: `oklch(0.35 0.1 ${hue})` }}
    >
      {initials}
    </span>
  );
}

/**
 * Who an account is, without printing the email: a label when we have one,
 * else a two-letter chip. The address itself is revealed on demand in the
 * segment's popover.
 */
function AccountName({
  account,
  className,
}: {
  readonly account: VibeProxyUsageAccount;
  readonly className?: string;
}) {
  const name = vibeProxyAccountName(account);
  if (name.includes("@")) {
    return (
      <span className={cn("inline-flex min-w-0 items-center", className)}>
        <AccountChip value={name} />
      </span>
    );
  }
  return <span className={className}>{name}</span>;
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground tabular-nums">{children}</span>
    </div>
  );
}

function RecentActivityStrip({ account }: { readonly account: VibeProxyUsageAccount }) {
  const activity = useMemo(() => vibeProxyRecentActivity(account), [account]);
  if (activity.buckets.length === 0) return null;

  return (
    <div className="flex items-end gap-px" aria-hidden>
      {activity.buckets.map((bucket) => {
        const total = bucket.success + bucket.failed;
        const height = total === 0 ? 2 : Math.max(3, (total / activity.peak) * 16);
        return (
          <span
            key={bucket.key}
            className={cn(
              "w-1 shrink-0 rounded-[1px]",
              total === 0
                ? "bg-muted"
                : bucket.failed === 0
                  ? "bg-success/70"
                  : bucket.success === 0
                    ? "bg-error/70"
                    : "bg-warning/70",
            )}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

function SegmentPopover({
  member,
  reset,
  nowMs,
}: {
  readonly member: VibeProxyPoolMember;
  readonly reset: VibeProxyPoolWindow["resets"][number] | undefined;
  readonly nowMs: number;
}) {
  const { account, window } = member;
  const status = vibeProxyAccountStatus(account);
  const health = vibeProxyRequestHealth(account);
  const subtitle = vibeProxyAccountSubtitle(account);
  const plan = account.planType?.trim() || account.accountType?.trim() || null;
  const remaining = remainingLabel(window);
  const resetsIn = formatQuotaReset(window.resetAt, nowMs);

  return (
    <div className="flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-2.5 text-xs">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <AccountChip value={vibeProxyAccountName(account)} />
          <span className="truncate">{vibeProxyAccountName(account)}</span>
          {account.selected ? (
            <span className="shrink-0 text-[11px] font-medium text-success-foreground">In use</span>
          ) : null}
        </span>
        {account.email ? (
          <RedactedSensitiveText
            value={account.email}
            ariaLabel="Toggle account email visibility"
            revealTooltip="Click to reveal email"
            hideTooltip="Click to hide email"
            className="w-fit"
          />
        ) : subtitle ? (
          <span className="truncate text-muted-foreground">{subtitle}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        {plan ? <Row label="Plan">{plan}</Row> : null}
        <Row label="Status">
          <span className={TONE_TEXT_CLASS[status.tone]}>{status.label}</span>
        </Row>
        <Row label="Health">
          <span className={health.tone === "ok" ? undefined : TONE_TEXT_CLASS[health.tone]}>
            {formatSuccessRate(health.successRate)}
            {health.total > 0 ? ` of ${health.total.toLocaleString()}` : ""}
          </span>
        </Row>
        {health.failed > 0 ? (
          <Row label="Failed">
            <span className="text-error-foreground">{health.failed.toLocaleString()}</span>
          </Row>
        ) : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-border/60 pt-2.5">
        <Row label="Left">{remaining}</Row>
        {resetsIn ? <Row label="Resets">{resetsIn.replace(/^Resets /u, "")}</Row> : null}
        {reset && reset.restoresPercent > 0 ? (
          <Row label="Restores">+{reset.restoresPercent}% of pool</Row>
        ) : null}
        {window.routing ? <Row label="Routing">Yes</Row> : null}
      </div>
      {status.detail ? (
        <p className="border-t border-border/60 pt-2.5 text-muted-foreground">{status.detail}</p>
      ) : null}
      <RecentActivityStrip account={account} />
    </div>
  );
}

function PoolSegment({
  member,
  reset,
  color,
  nowMs,
  index,
}: {
  readonly member: VibeProxyPoolMember;
  readonly reset: VibeProxyPoolWindow["resets"][number] | undefined;
  readonly color: string;
  readonly nowMs: number;
  readonly index: number;
}) {
  const [open, setOpen] = useState(false);
  const remaining = remainingWidth(member.window);
  const remainingText = remainingLabel(member.window);
  const resetsIn = formatQuotaResetShort(member.window.resetAt, nowMs);
  const name = vibeProxyAccountName(member.account);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        render={
          <button
            type="button"
            style={{ gridColumn: index, gridRow: 1 }}
            aria-label={`${name}: ${remainingText} left${resetsIn ? `, ${resetsIn}` : ""}${member.account.selected ? ", in use" : ""}`}
            className="relative h-5 min-w-0 cursor-pointer overflow-hidden rounded-md bg-muted text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[popup-open]:ring-1 data-[popup-open]:ring-border @2xl/pool:h-8"
          />
        }
      >
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-md opacity-35"
          style={{ width: `${remaining}%`, backgroundColor: color }}
        />
        {remaining < 100 && reset ? (
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 opacity-20"
            style={{
              width: `${100 - remaining}%`,
              backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 1px, transparent 1px 5px)`,
            }}
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-[10px] leading-none font-semibold text-foreground/80 tabular-nums @2xl/pool:hidden"
        >
          {index}
        </span>
        <div className="relative hidden h-full min-w-0 items-center gap-1.5 px-2 text-xs @2xl/pool:flex">
          <AccountName
            account={member.account}
            className="min-w-0 truncate font-medium text-foreground"
          />
          {member.account.selected ? (
            <span className="shrink-0 text-[11px] font-medium text-success-foreground">In use</span>
          ) : null}
          <span className="shrink-0 font-semibold text-foreground tabular-nums">
            {remainingText}
          </span>
          {resetsIn ? (
            <span className="ms-auto flex shrink-0 items-center gap-1.5 rounded-sm bg-background/85 px-1.5 py-0.5 text-[11px] text-foreground tabular-nums">
              {resetsIn}
            </span>
          ) : null}
        </div>
      </PopoverTrigger>
      <LegendRow member={member} color={color} nowMs={nowMs} index={index} />
      <PopoverPopup side="top" sideOffset={6}>
        <SegmentPopover member={member} reset={reset} nowMs={nowMs} />
      </PopoverPopup>
    </Popover>
  );
}

function LegendRow({
  member,
  color,
  nowMs,
  index,
}: {
  readonly member: VibeProxyPoolMember;
  readonly color: string;
  readonly nowMs: number;
  readonly index: number;
}) {
  const remainingText = remainingLabel(member.window);
  const resetsIn = formatQuotaResetShort(member.window.resetAt, nowMs);
  return (
    <PopoverTrigger
      style={{ gridColumn: "1 / -1", gridRow: index + 1 }}
      className="flex min-h-7 min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 text-start text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring @2xl/pool:hidden"
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[10px] leading-none font-semibold text-foreground/80 tabular-nums">
        <span
          aria-hidden
          className="absolute inset-0 rounded-sm opacity-35"
          style={{ backgroundColor: color }}
        />
        <span className="sr-only">Segment </span>
        <span className="relative">{index}</span>
      </span>
      <AccountName
        account={member.account}
        className="min-w-0 truncate font-medium text-foreground"
      />
      {member.account.selected ? (
        <span className="shrink-0 text-[11px] font-medium text-success-foreground">In use</span>
      ) : null}
      <span className="shrink-0 font-semibold text-foreground tabular-nums">{remainingText}</span>
      <span className="ms-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground tabular-nums">
        {resetsIn}
      </span>
    </PopoverTrigger>
  );
}

function PoolWindowCard({
  pool,
  color,
  nowMs,
}: {
  readonly pool: VibeProxyPoolWindow;
  readonly color: string;
  readonly nowMs: number;
}) {
  const nextRefill = pool.resets.find((reset) => reset.restoresPercent > 0);
  const restores = new Map(pool.resets.map((reset) => [reset.member.account.id, reset]));
  return (
    <div className="grid items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{pool.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground tabular-nums">
            {pool.remainingPercent === null ? "—" : `${pool.remainingPercent}%`}
          </span>
          <span className="text-sm text-muted-foreground">left</span>
        </span>
        {nextRefill ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            <span className="font-medium text-foreground">↻ +{nextRefill.restoresPercent}%</span>{" "}
            {refillRemaining(nextRefill.member.window.resetAt, nowMs)}
          </span>
        ) : null}
      </div>
      <div className="@container/pool min-w-0">
        <div
          className="grid gap-x-1 gap-y-1"
          style={{ gridTemplateColumns: `repeat(${pool.members.length}, minmax(0, 1fr))` }}
        >
          {pool.members.map((member, position) => (
            <PoolSegment
              key={member.account.id}
              member={member}
              reset={restores.get(member.account.id)}
              color={color}
              nowMs={nowMs}
              index={position + 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function UnpooledAccount({ account }: { readonly account: VibeProxyUsageAccount }) {
  const status = vibeProxyAccountStatus(account);
  const health = vibeProxyRequestHealth(account);
  const quota = vibeProxyQuotaSummary(account);
  const subtitle = vibeProxyAccountSubtitle(account);
  const plan = account.planType?.trim() || account.accountType?.trim() || null;

  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 px-3 py-3">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <AccountName account={account} className="min-w-0 truncate" />
        {account.selected ? (
          <span className="shrink-0 text-[11px] font-medium text-success-foreground">In use</span>
        ) : null}
        {plan ? (
          <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{plan}</span>
        ) : null}
      </div>
      {subtitle ? <p className="truncate text-xs text-muted-foreground/80">{subtitle}</p> : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className={TONE_TEXT_CLASS[status.tone]}>{status.label}</span>
        <span aria-hidden>·</span>
        <span className={health.tone === "ok" ? undefined : TONE_TEXT_CLASS[health.tone]}>
          {formatSuccessRate(health.successRate)}
          {health.total > 0 ? ` of ${health.total.toLocaleString()}` : ""}
        </span>
      </p>
      {quota.kind !== "windows" ? (
        <p className="text-xs text-muted-foreground">{quota.message}</p>
      ) : null}
    </div>
  );
}

function ProviderPool({
  pool,
  nowMs,
}: {
  readonly pool: VibeProxyAccountPool;
  readonly nowMs: number;
}) {
  const color = PROVIDER_BAR_COLOR[pool.kind];
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <VibeProxyProviderMark provider={pool.provider} className="size-4" />
        {pool.label}
        <span className="text-xs font-normal text-muted-foreground">
          {pool.windows.reduce((sum, window) => Math.max(sum, window.members.length), 0) ||
            pool.unpooled.length}
        </span>
      </h3>
      {pool.windows.map((window) => (
        <PoolWindowCard key={window.id} pool={window} color={color} nowMs={nowMs} />
      ))}
      {pool.unpooled.map((account) => (
        <UnpooledAccount key={account.id} account={account} />
      ))}
    </section>
  );
}

function AccountsSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="grid gap-3 rounded-lg border border-border/60 p-4 md:grid-cols-[11rem_minmax(0,1fr)]"
        >
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

function StateNotice({
  tone = "muted",
  children,
}: {
  readonly tone?: "muted" | "warning";
  readonly children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 px-3 py-3 text-xs sm:px-4",
        tone === "warning" ? "text-warning-foreground" : "text-muted-foreground",
      )}
    >
      {tone === "warning" ? <AlertTriangleIcon className="mt-px size-3.5 shrink-0" /> : null}
      <span>{children}</span>
    </p>
  );
}

export function UsagesSettingsPanel() {
  const vibeProxy = usePrimarySettings((settings) => settings.vibeProxy);
  const updateSettings = useUpdatePrimarySettings();
  const nowMs = useRelativeTimeTick(30_000);

  const hasCredentials =
    vibeProxy.baseUrl.trim().length > 0 &&
    (vibeProxy.apiKey.trim().length > 0 || vibeProxy.apiKeyRedacted);
  const usageConfigurationKey =
    vibeProxy.enabled && hasCredentials
      ? `${vibeProxy.baseUrl.trim()}:${vibeProxy.apiKeyRedacted ? "stored" : vibeProxy.apiKey.length}`
      : null;
  const usage = useVibeProxyUsage(usageConfigurationKey);

  const stage = resolveVibeProxyUsageStage({
    settings: vibeProxy,
    result: usage.result,
    isRefreshing: usage.isRefreshing,
    transportError: usage.error,
  });
  const pools = useMemo(
    () => (stage.kind === "accounts" ? collectVibeProxyPools(stage.accounts) : []),
    [stage],
  );

  const snapshotAge = stage.kind === "accounts" ? formatSnapshotAge(stage.fetchedAt, nowMs) : null;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Vibe-Proxy" icon={<GaugeIcon className="size-4" />}>
        <SettingsRow
          {...searchableSetting("vibe-proxy-enabled")}
          description="Read account quotas and request health from a Vibe-Proxy instance."
          control={
            <Switch
              checked={vibeProxy.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ vibeProxy: { enabled: Boolean(checked) } })
              }
              aria-label="Enable Vibe-Proxy usage"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("vibe-proxy-base-url")}
          control={
            <DraftInput
              className="w-full sm:w-80"
              value={vibeProxy.baseUrl}
              onCommit={(baseUrl) => updateSettings({ vibeProxy: { baseUrl: baseUrl.trim() } })}
              placeholder="https://vibe-proxy.example.com"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              aria-label="Vibe-Proxy API base URL"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("vibe-proxy-api-key")}
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <DraftInput
                className="min-w-0 flex-1 sm:w-80"
                value=""
                onCommit={(apiKey) => updateSettings({ vibeProxy: { apiKey: apiKey.trim() } })}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  vibeProxy.apiKeyRedacted
                    ? "Stored key - enter a new value to replace"
                    : "Management API key"
                }
                aria-label="Vibe-Proxy API key"
              />
              {vibeProxy.apiKeyRedacted ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => updateSettings({ vibeProxy: { apiKey: "" } })}
                >
                  Remove key
                </Button>
              ) : null}
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Accounts"
        headerAction={
          <div className="flex items-center gap-3">
            {snapshotAge ? (
              <span className="text-xs text-muted-foreground">{snapshotAge}</span>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              disabled={!vibeProxy.enabled || !hasCredentials || usage.isRefreshing}
              onClick={usage.refresh}
            >
              <RefreshCwIcon className={cn("size-3.5", usage.isRefreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      >
        {stage.kind === "disabled" ? (
          <StateNotice>Turn on Vibe-Proxy to see account quotas here.</StateNotice>
        ) : null}

        {stage.kind === "unconfigured" ? (
          <StateNotice>{describeMissingConfiguration(stage.missing)}</StateNotice>
        ) : null}

        {stage.kind === "loading" ? <AccountsSkeleton /> : null}

        {stage.kind === "empty" ? (
          <StateNotice tone={stage.problem ? "warning" : "muted"}>
            {stage.problem ?? "Vibe-Proxy reported no accounts."}
          </StateNotice>
        ) : null}

        {stage.kind === "accounts" ? (
          <>
            {stage.problem ? (
              <StateNotice tone="warning">
                {stage.problem} Showing the last values Vibe-Proxy reported.
              </StateNotice>
            ) : null}
            {pools.length === 0 ? (
              <StateNotice>Vibe-Proxy reported no accounts.</StateNotice>
            ) : (
              <div
                className={cn("flex flex-col gap-8 px-3 py-3 sm:px-4", stage.stale && "opacity-70")}
              >
                {pools.map((pool) => (
                  <ProviderPool key={pool.key} pool={pool} nowMs={nowMs} />
                ))}
              </div>
            )}
          </>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
