import { useEffect, useEffectEvent, useState } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentProjects } from "../../state/projects";
import { environmentThreadShells } from "../../state/threads";
import {
  nextDockAgentExpiryMs,
  pruneFinishedDockAgents,
  reconcileDockAgents,
  sameDockAgentRows,
  type DockAgentRow,
} from "./dockAgents";

const RECONCILE_DEBOUNCE_MS = 250;

function reconcileWithCurrentShells(previous: ReadonlyArray<DockAgentRow>) {
  return reconcileDockAgents(previous, {
    threads: appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
    projects: appAtomRegistry.get(environmentProjects.projectsAtom),
    nowMs: Date.now(),
  });
}

/**
 * Live agent rows for Dock mode. Shell updates stream per token during a
 * turn, so they are debounced and only a real change re-renders the dock.
 * `onFinished` runs once per pass in which any agent finished or failed.
 */
export function useDockAgents(onFinished: () => void): ReadonlyArray<DockAgentRow> {
  const [rows, setRows] = useState(() => reconcileWithCurrentShells([]).rows);

  const reconcile = useEffectEvent(() => {
    const result = reconcileWithCurrentShells(rows);
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

  // Removing a finished row is what triggers its slide-out.
  useEffect(() => {
    const expiry = nextDockAgentExpiryMs(rows);
    if (expiry === null) return;
    const timer = setTimeout(prune, Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [rows]);

  return rows;
}
