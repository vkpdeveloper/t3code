import { AppRegistry, Platform } from "react-native";

import { AGENT_STATUS_KEEP_ALIVE_TASK_KEY } from "./nativeAgentStatus";

/**
 * Registers the headless task the Android foreground service starts. React
 * Native pauses JS timers while the activity is paused unless a headless task
 * is running, and the connection runtime's reconnect backoff and client
 * activity lease are timer-driven. The task resolves only when the native
 * side finishes it (the service stopping), so it does no work itself.
 */
export function registerAgentStatusKeepAliveTask(): void {
  if (Platform.OS !== "android") return;
  AppRegistry.registerHeadlessTask(
    AGENT_STATUS_KEEP_ALIVE_TASK_KEY,
    () => () => new Promise<void>(() => undefined),
  );
}
