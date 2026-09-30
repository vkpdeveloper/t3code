import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import {
  dismissDockAgent,
  hideDockAgentKey,
  nextDockAgentExpiryMs,
  pruneFinishedDockAgents,
  reconcileDockAgents,
  sameDockAgentRows,
  type DockAgentRow,
} from "./dockAgents";

const RECONCILE_DEBOUNCE_MS = 250;
const NO_HIDDEN_AGENTS: ReadonlySet<string> = new Set();

function reconcileWithCurrentShells(
  previous: ReadonlyArray<DockAgentRow>,
  hiddenKeys: ReadonlySet<string>,
) {
  return reconcileDockAgents(previous, {
    threads: appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
    projects: appAtomRegistry.get(environmentProjects.projectsAtom),
    nowMs: Date.now(),
    hiddenKeys,
  });
}

/**
 * Live agent rows for Dock mode. Shell updates stream per token during a
 * turn, so they are debounced and only a real change re-renders the dock.
 * `onFinished` runs once per pass in which any visible agent finished or
 * failed. `hide` removes a row and keeps that agent off the dock for good;
 * finished rows otherwise leave after they linger.
 */
export function useDockAgents(onFinished: () => void): {
  readonly rows: ReadonlyArray<DockAgentRow>;
  readonly hide: (key: string) => void;
} {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const hiddenList = AsyncResult.isSuccess(preferences)
    ? preferences.value.dockHiddenAgentKeys
    : undefined;
  const hiddenKeys = useMemo(
    () => (hiddenList && hiddenList.length > 0 ? new Set(hiddenList) : NO_HIDDEN_AGENTS),
    [hiddenList],
  );
  const [rows, setRows] = useState(() => reconcileWithCurrentShells([], hiddenKeys).rows);

  const reconcile = useEffectEvent(() => {
    const result = reconcileWithCurrentShells(rows, hiddenKeys);
    if (!sameDockAgentRows(rows, result.rows)) setRows(result.rows);
    if (result.finished.length > 0) onFinished();
  });

  const prune = useEffectEvent(() => {
    setRows(pruneFinishedDockAgents(rows, Date.now()));
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer ??= setTimeout(() => {
        timer = null;
        reconcile();
      }, RECONCILE_DEBOUNCE_MS);
    };

    const unsubscribeThreads = appAtomRegistry.subscribe(
      environmentThreadShells.threadShellsAtom,
      schedule,
    );
    const unsubscribeProjects = appAtomRegistry.subscribe(
      environmentProjects.projectsAtom,
      schedule,
    );
    // Catch anything that changed between the first render and subscribing.
    schedule();
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribeThreads();
      unsubscribeProjects();
    };
  }, []);

  const hide = useCallback(
    (key: string) => {
      setRows((current) => dismissDockAgent(current, key));
      savePreferences({
        transform: (current) => ({
          dockHiddenAgentKeys: hideDockAgentKey(current.dockHiddenAgentKeys ?? [], key),
        }),
      });
    },
    [savePreferences],
  );

  // Removing a finished row is what triggers its slide-out.
  useEffect(() => {
    const expiry = nextDockAgentExpiryMs(rows);
    if (expiry === null) return;
    const timer = setTimeout(prune, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [rows]);

  // Preferences can load after the first pass; hidden agents never render.
  const visibleRows = useMemo(
    () => (hiddenKeys.size === 0 ? rows : rows.filter((row) => !hiddenKeys.has(row.key))),
    [hiddenKeys, rows],
  );
  return { rows: visibleRows, hide };
}
