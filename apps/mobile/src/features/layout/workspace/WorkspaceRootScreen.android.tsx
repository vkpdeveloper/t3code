import { useGT } from "gt-react-native";
import { useAndroidFloatingTabs } from "../../settings/appearance/AppearancePreferencesProvider";
import { WorkspaceNoTabs } from "./WorkspaceNoTabs";
import { useEnabledNavigationTabs } from "./navigation-tabs";
import { NAVIGATION_TAB_ORDER } from "./navigation-tab-order";
import { WorkspaceExtraTab } from "./WorkspaceExtraTab";
import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { AppBar } from "../../../components/ui/AppBar";
import { WorkspaceEmptyDetail } from "../WorkspaceEmptyDetail";
import { ScreenContent } from "../../../components/ui/ScreenContent";
import { useAndroidControlSizing } from "../../../components/ui/useAndroidControlSizing";
import { HomeRouteScreen } from "../../home/HomeRouteScreen";
import { PullRequestsScreen } from "../../pull-requests/PullRequestsScreen";
import { ListSearchToolbar } from "./ListSearchToolbar.android";
import { IssuesScreen } from "../../issues/IssuesScreen";
import { useAdaptiveWorkspaceLayout } from "../AdaptiveWorkspaceLayout";
import { WorkspaceSettledContentWidthContext } from "../workspace-content-width";
import { AndroidWorkspaceNavigation, FloatingWorkspaceTabs } from "./AndroidWorkspaceNavigation";
import { FLOATING_TABS } from "./floating-workspace-tabs";
import {
  WorkspaceTabsContext,
  useWorkspaceTabControls,
  useWorkspaceTabsSelector,
} from "./WorkspaceTabsContext";
import { WorkspaceTabPanes } from "./WorkspaceTabPanes";
import { WorkspaceAppBarScope } from "../../../components/ui/WorkspaceAppBar.android";
import { usePaneRole } from "../../../components/ui/Pane";
import { AndroidWorkspaceSidebar } from "./AndroidWorkspaceSidebar.android";
import { workspaceUsesColumns, type WorkspaceTab } from "./workspace-tabs-state";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { useHardwareBack } from "../../../lib/backHandler";

const TABS: readonly WorkspaceTab[] = NAVIGATION_TAB_ORDER;

export function WorkspaceRootScreen() {
  return usePaneRole() === "sidebar" ? <AndroidWorkspaceSidebar /> : <WorkspaceRoot />;
}

function WorkspaceRoot() {
  const gt = useGT();
  const floatingTabsEnabled = useAndroidFloatingTabs();
  const { layout, startNewTask, workspacePageWidth } = useAdaptiveWorkspaceLayout();
  const controls = useWorkspaceTabControls()!;
  const tab = useWorkspaceTabsSelector((state) => state.selectedTab)!;
  const searchResting = useWorkspaceTabsSelector(
    (state) => state.tabs[state.selectedTab].searchMode === "resting",
  );
  const enabled = useEnabledNavigationTabs();
  const insets = useSafeAreaInsets();
  const { fabClearance, fabSize } = useAndroidControlSizing();
  // Each pane gets values for its own tab, so switching tabs leaves every pane's context alone
  // and hidden panes do not re-render.
  const panes = useMemo(() => {
    const paneFor = (paneTab: WorkspaceTab) => {
      const bottomClearance = layout.usesSplitView
        ? controls.bottomClearance
        : floatingTabsEnabled
          ? insets.bottom + FLOATING_TABS.bottom + FLOATING_TABS.edge + fabSize
          : paneTab === "threads"
            ? fabClearance + 16
            : 16;
      return {
        context: { ...controls, bottomClearance },
        insets: layout.usesSplitView
          ? insets
          : floatingTabsEnabled
            ? !workspaceUsesColumns(paneTab)
              ? { ...insets, bottom: bottomClearance }
              : insets
            : { ...insets, bottom: 0 },
      };
    };
    return Object.fromEntries(TABS.map((paneTab) => [paneTab, paneFor(paneTab)])) as Record<
      WorkspaceTab,
      ReturnType<typeof paneFor>
    >;
  }, [controls, layout.usesSplitView, floatingTabsEnabled, insets, fabClearance, fabSize]);
  const selectTab = useSelectWorkspaceTab();
  // Tabs are panes of Home, not routes, so Back has nothing to pop and would leave the app.
  // An open search keeps Back for itself.
  useHardwareBack(
    tab !== "threads" && enabled.includes("threads") && searchResting === true,
    () => {
      selectTab("threads");
      return true;
    },
  );

  const renderPane = (tab: WorkspaceTab) =>
    tab === "threads" ? (
      <HomeRouteScreen />
    ) : tab === "usage" || tab === "workflows" ? (
      <WorkspacePageFrame width={workspacePageWidth ?? null}>
        <WorkspaceExtraTab tab={tab} />
      </WorkspacePageFrame>
    ) : layout.usesSplitView ? (
      <>
        <NativeStackScreenOptions options={{ headerShown: false }} />
        <AppBar
          embedded
          title={
            tab === "issues"
              ? gt("Issues", { $context: "screen title, list of issues" })
              : gt("Pull requests")
          }
        />
        <WorkspaceEmptyDetail tab={tab} />
      </>
    ) : tab === "issues" ? (
      <IssuesScreen
        renderFrame={(filters, list) => (
          <>
            <ListSearchToolbar tab="issues" filters={filters} />
            <ScreenContent>{list}</ScreenContent>
          </>
        )}
      />
    ) : (
      <PullRequestsScreen
        renderFrame={(filters, list) => (
          <>
            <ListSearchToolbar tab="pullRequests" filters={filters} />
            <ScreenContent>{list}</ScreenContent>
          </>
        )}
      />
    );

  return (
    <WorkspaceTabsContext value={panes[tab].context}>
      <View className={layout.usesSplitView ? "flex-1 bg-screen" : "flex-1 bg-header"}>
        {!layout.usesSplitView ? (
          <NativeStackScreenOptions options={{ headerShown: false }} />
        ) : null}
        {enabled.length === 0 ? (
          <SafeAreaInsetsContext value={panes[tab].insets}>
            {layout.usesSplitView ? <View className="flex-1 bg-screen" /> : <WorkspaceNoTabs />}
          </SafeAreaInsetsContext>
        ) : (
          <WorkspaceAppBarScope enabled={!layout.usesSplitView}>
            <WorkspaceTabPanes
              tabs={TABS}
              selected={tab}
              renderTab={(tab) => (
                <WorkspaceTabsContext value={panes[tab].context}>
                  <SafeAreaInsetsContext value={panes[tab].insets}>
                    {renderPane(tab)}
                  </SafeAreaInsetsContext>
                </WorkspaceTabsContext>
              )}
            />
          </WorkspaceAppBarScope>
        )}
        {layout.usesSplitView ? null : floatingTabsEnabled ? (
          <FloatingWorkspaceTabs fillWidth onNewThread={startNewTask} />
        ) : (
          <AndroidWorkspaceNavigation onNewThread={startNewTask} />
        )}
      </View>
    </WorkspaceTabsContext>
  );
}

// Hidden, the page sits in the narrower pane beside the list; laying it out at the width it opens
// at keeps measured bars and breakpoints from catching up a frame after it appears.
function WorkspacePageFrame(props: {
  readonly width: number | null;
  readonly children: ReactNode;
}) {
  if (props.width === null) return props.children;
  return (
    <WorkspaceSettledContentWidthContext value={props.width}>
      <View style={{ flex: 1, width: props.width }}>{props.children}</View>
    </WorkspaceSettledContentWidthContext>
  );
}
