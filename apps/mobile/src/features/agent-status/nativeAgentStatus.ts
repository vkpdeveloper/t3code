import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export interface NativeAgentStatusRow {
  readonly threadKey: string;
  readonly environmentLabel: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly phase: "starting" | "running" | "waiting_for_approval" | "waiting_for_input";
  readonly phaseLabel: string;
  readonly deepLink: string;
  readonly startedAtMs?: number;
}

export interface NativeAgentStatusTheme {
  readonly accentColor: string;
  readonly backgroundColor: string;
  readonly foregroundColor: string;
}

export interface NativeAgentStatusSummary {
  readonly rows: ReadonlyArray<NativeAgentStatusRow>;
  readonly onlineCount: number;
  readonly totalCount: number;
  readonly theme: NativeAgentStatusTheme;
  readonly launchUrlScheme: string;
}

interface NativeAgentStatusModule {
  canPostPromotedNotifications(): boolean;
  ensureChannels(): void;
  /** False when Android refused a background start; retry once foregrounded. */
  update(summary: NativeAgentStatusSummary): boolean;
  stop(): void;
}

/** Registered from JS with AppRegistry.registerHeadlessTask; must match the Kotlin constant. */
export const AGENT_STATUS_KEEP_ALIVE_TASK_KEY = "T3AgentStatusKeepAlive";

export const ALERT_CHANNEL_ID = "t3code.agent-alerts";

const nativeModule: NativeAgentStatusModule | null =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeAgentStatusModule>("T3AgentStatus")
    : null;

export function nativeAgentStatus(): NativeAgentStatusModule | null {
  return nativeModule;
}

export function supportsAgentStatusNotification(): boolean {
  return nativeModule !== null;
}
