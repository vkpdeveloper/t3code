import { RegistryContext, useAtomMount, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { createContext, use, useMemo, useState, type Dispatch, type ReactNode } from "react";

import { mobilePreferencesAtom, saveMobilePreferences } from "../../../state/preferences";
import { useAtomCommand } from "../../../state/use-atom-command";
import {
  isSharedSlotTab,
  sharedSlotAbsentee,
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  resolveSelectedNavigationTab,
} from "./navigation-tab-order";
import {
  initialWorkspaceTabsState,
  resolveWorkspaceTabOrder,
  workspaceTabsReducer,
  type WorkspaceSearchTab,
  type WorkspaceTab,
  type WorkspaceTabsAction,
  type WorkspaceTabsState,
} from "./workspace-tabs-state";

// The context carries no tab state, so its value survives tab switches. Every mounted tab reads it,
// and a value that changed per switch re-rendered all of them, hidden ones included.
export const WorkspaceTabsContext = createContext<{
  readonly stateAtom: Atom.Atom<WorkspaceTabsState>;
  readonly dispatch: Dispatch<WorkspaceTabsAction>;
  readonly isTabActive: (tab: WorkspaceTab) => boolean;
  readonly bottomClearance: number;
  readonly settingsOpen: boolean;
  readonly getScrollOffset: (tab: WorkspaceSearchTab) => number;
  readonly recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => void;
  /** Leaves search and returns the list to where it was when search began. */
  readonly cancelSearch: (tab: WorkspaceSearchTab) => void;
} | null>(null);

const noWorkspaceTabsAtom = Atom.make<WorkspaceTabsState | null>(null);

export function useWorkspaceTabControls() {
  return use(WorkspaceTabsContext);
}

/** Re-renders only when the selected value changes, unlike `useWorkspaceTabs`. */
export function useWorkspaceTabsSelector<A>(
  select: (state: WorkspaceTabsState) => A,
): A | undefined {
  const controls = use(WorkspaceTabsContext);
  return useAtomValue(controls?.stateAtom ?? noWorkspaceTabsAtom, (state) =>
    state === null ? undefined : select(state),
  );
}

/** The whole tab state. Re-renders on every tab change, so tab panes use the selector instead. */
export function useWorkspaceTabs() {
  const controls = use(WorkspaceTabsContext);
  const state = useWorkspaceTabsSelector((current) => current);
  return useMemo(() => (controls && state ? { ...controls, state } : null), [controls, state]);
}

type MobilePreferencesResult = Atom.Type<typeof mobilePreferencesAtom>;

/** Moves the selection off a tab the user has hidden or that no longer exists. */
function resolveWorkspaceTabsSelection(
  state: WorkspaceTabsState,
  preferences: MobilePreferencesResult,
): WorkspaceTabsState {
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const order = resolveWorkspaceTabOrder(saved?.navigationTabOrder);
  const hidden = [
    ...(navigationCustomizationAvailable()
      ? resolveHiddenNavigationTabs(saved?.hiddenNavigationTabs)
      : []),
    sharedSlotAbsentee(state.selectedTab, saved?.sharedSlotTab),
  ];
  const selected = resolveSelectedNavigationTab(order, hidden, state.selectedTab);
  return selected && selected !== state.selectedTab
    ? workspaceTabsReducer(state, { type: "select", tab: selected })
    : state;
}

// One model per provider. Handlers on frozen screens keep stale closures, so
// they read the current selection from the registry at call time.
function createWorkspaceTabsModel(selectedTab?: WorkspaceTab) {
  const stored = Atom.make(initialWorkspaceTabsState(selectedTab));
  const scrollOffsets: Record<WorkspaceSearchTab, number> = {
    threads: 0,
    pullRequests: 0,
    issues: 0,
    workflows: 0,
    usage: 0,
    settings: 0,
  };
  return {
    stored,
    resolved: Atom.make((get) =>
      resolveWorkspaceTabsSelection(get(stored), get(mobilePreferencesAtom)),
    ),
    getScrollOffset: (tab: WorkspaceSearchTab) => scrollOffsets[tab],
    recordScrollOffset: (tab: WorkspaceSearchTab, offset: number) => {
      scrollOffsets[tab] = offset;
    },
  };
}

export function WorkspaceTabsProvider(props: {
  readonly children: ReactNode;
  readonly settingsOpen?: boolean;
  readonly initialTab?: WorkspaceTab;
}) {
  const registry = use(RegistryContext);
  const [model] = useState(() => createWorkspaceTabsModel(props.initialTab));
  // Keeps the tab state alive without re-rendering this provider on each change.
  useAtomMount(model.resolved);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const dispatch = (action: WorkspaceTabsAction) => {
    registry.set(model.stored, workspaceTabsReducer(registry.get(model.resolved), action));
    if (action.type === "select" && isSharedSlotTab(action.tab))
      void savePreferences({ sharedSlotTab: action.tab });
  };
  const context = {
    stateAtom: model.resolved,
    dispatch,
    isTabActive: (tab: WorkspaceTab) => registry.get(model.resolved).selectedTab === tab,
    bottomClearance: 0,
    settingsOpen: props.settingsOpen ?? false,
    getScrollOffset: model.getScrollOffset,
    recordScrollOffset: model.recordScrollOffset,
    cancelSearch: (tab: WorkspaceSearchTab) => {
      model.recordScrollOffset(tab, registry.get(model.resolved).tabs[tab].searchEntryOffset);
      dispatch({ type: "cancel", tab });
    },
  };
  return <WorkspaceTabsContext value={context}>{props.children}</WorkspaceTabsContext>;
}
