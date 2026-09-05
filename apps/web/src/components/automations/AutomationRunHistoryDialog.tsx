import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { automationRunStatusLabel } from "@t3tools/client-runtime/state/automations";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { AutomationId, AutomationRun, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useAutomations } from "../../state/automations";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

const PAGE_SIZE = 20;
const runDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

function AutomationRunRow({
  environmentId,
  run,
}: {
  environmentId: EnvironmentId;
  run: AutomationRun;
}) {
  const thread = useThreadShell(scopeThreadRef(environmentId, run.threadId));
  const restore = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const status = automationRunStatusLabel(run, thread);
  const error =
    restoreError ?? run.error ?? (status === "Failed" ? thread?.session?.lastError : null);

  const restoreThread = async () => {
    setRestoring(true);
    setRestoreError(null);
    const result = await restore({ environmentId, input: { threadId: run.threadId } });
    setRestoring(false);
    if (result._tag !== "Success") {
      const cause = squashAtomCommandFailure(result);
      setRestoreError(
        cause instanceof Error ? cause.message : "Could not restore this run's thread.",
      );
    }
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <time className="text-sm font-medium" dateTime={run.scheduledFor}>
            {runDateFormatter.format(new Date(run.scheduledFor))}
          </time>
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span className={status === "Failed" ? "text-destructive" : undefined}>{status}</span>
            <span>·</span>
            <span>{run.trigger === "manual" ? "Manual" : "Scheduled"}</span>
          </div>
        </div>
        {thread !== null ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: run.threadId }}
                aria-label={`Open run from ${runDateFormatter.format(new Date(run.scheduledFor))}`}
              />
            }
          >
            Open run <ArrowRightIcon />
          </Button>
        ) : run.status === "started" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={restoring}
            onClick={() => void restoreThread()}
          >
            {restoring ? "Restoring…" : "Restore thread"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {run.status === "pending" ? "Waiting to start" : "Thread unavailable"}
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>
      ) : null}
    </li>
  );
}

export function AutomationRunHistoryDialog({
  environmentId,
  automationId,
  onClose,
}: {
  environmentId: EnvironmentId;
  automationId: AutomationId;
  onClose: () => void;
}) {
  const query = useAutomations(environmentId);
  const refresh = query.refresh;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const automation = query.data?.automations.find((candidate) => candidate.id === automationId);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {automation?.name ?? "Automation"}: Run history
          </DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {query.error ? (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {query.error}
            </p>
          ) : null}
          {query.isPending && query.data === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading run history…</p>
          ) : automation ? (
            automation.runs.length > 0 ? (
              <ul className="divide-y">
                {automation.runs.slice(0, visibleCount).map((run) => (
                  <AutomationRunRow key={run.id} environmentId={environmentId} run={run} />
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No runs yet</p>
            )
          ) : !query.error ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Automation not found.</p>
          ) : null}
        </DialogPanel>
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {automation
              ? `${automation.runs.length} ${automation.runs.length === 1 ? "run" : "runs"}`
              : null}
          </span>
          <div className="flex gap-2">
            {automation && visibleCount < automation.runs.length ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                Show older runs
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" disabled={query.isPending} onClick={refresh}>
              <RefreshCwIcon /> Refresh
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
