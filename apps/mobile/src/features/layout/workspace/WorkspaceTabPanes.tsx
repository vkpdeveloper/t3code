import { Activity, useState, type ReactNode } from "react";
import { View } from "react-native";

/**
 * Top-level tabs swap in a single frame. A tab mounts on its first visit and then stays mounted
 * while hidden, so returning to it shows its list as it was left instead of an empty one that
 * fills in. Hidden tabs keep their state but run no effects, so they register no keyboard
 * commands, back handlers, or header options.
 */
export function WorkspaceTabPanes<Tab extends string>(props: {
  readonly tabs: readonly Tab[];
  readonly selected: Tab;
  readonly renderTab: (tab: Tab) => ReactNode;
}) {
  const [visited, setVisited] = useState<readonly Tab[]>(() => [props.selected]);
  if (!visited.includes(props.selected)) {
    setVisited([...visited, props.selected]);
  }
  return props.tabs.map((tab) =>
    visited.includes(tab) ? (
      <Activity key={tab} mode={tab === props.selected ? "visible" : "hidden"}>
        <WorkspaceTabPane tab={tab} renderTab={props.renderTab} />
      </Activity>
    ) : null,
  );
}

// A component of its own so the compiler keeps each pane's element while its inputs hold: a
// selection change then re-renders only what reads the selection, not every mounted tab.
function WorkspaceTabPane<Tab extends string>(props: {
  readonly tab: Tab;
  readonly renderTab: (tab: Tab) => ReactNode;
}) {
  return <View className="flex-1">{props.renderTab(props.tab)}</View>;
}
