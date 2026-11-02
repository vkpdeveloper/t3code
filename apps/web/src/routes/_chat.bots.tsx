import { createFileRoute } from "@tanstack/react-router";

import { BotsHome } from "../components/bots/BotsHome";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { sidebarModeAtom } from "../state/bots";

export const Route = createFileRoute("/_chat/bots")({
  // A reload or shared link lands here too, so the sidebar follows the page.
  beforeLoad: () => appAtomRegistry.set(sidebarModeAtom, "bots"),
  component: BotsHome,
});
