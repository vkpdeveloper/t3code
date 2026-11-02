import { useAtomValue } from "@effect/atom-react";
import { Navigate } from "@tanstack/react-router";
import { useState } from "react";

import { botListAtom } from "../../state/bots";
import { useAllEnvironmentShellsBootstrapped } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { isElectron } from "../../env";
import { CreateBotPanel } from "./CreateBotDialog";

/** Opens the newest bot, or the create form when there are none. */
export function BotsHome() {
  const bots = useAtomValue(botListAtom);
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  // The new bot can show up before its launch finishes, and launch can still fail. Keep
  // the form while creating; a successful submit navigates on its own.
  const [creating, setCreating] = useState(false);
  const newest = bots[0];
  if (newest && !creating) {
    return (
      <Navigate
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(newest.threadRef)}
        replace
      />
    );
  }
  // A pending environment cannot prove there are no bots.
  if (!bootstrapped) return null;
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} />
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto scrollbar-gutter-both px-4 pt-6 pb-12 sm:items-center sm:pt-0">
        <CreateBotPanel pending={creating} onPendingChange={setCreating} />
      </div>
    </SidebarInset>
  );
}
