import { Keyboard } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../adaptive-workspace-context";
import { useWorkspaceTabControls } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** Opens a workspace tab, Settings included, from a tab bar, rail, toolbar or command. */
export function useSelectWorkspaceTab() {
  const dispatch = useWorkspaceTabControls()?.dispatch;
  const { openWorkspaceTab } = useAdaptiveWorkspaceLayout();
  return (tab: WorkspaceTab | "settings") => {
    Keyboard.dismiss();
    openWorkspaceTab(tab);
    if (tab !== "settings") dispatch?.({ type: "select", tab });
  };
}
