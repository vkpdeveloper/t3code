import { createBotListAtom, createBotPreviewsAtomFamily } from "@t3tools/client-runtime/state/bots";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentProjects } from "./projects";
import { environmentThreadShells } from "./threads";

export const botListAtom = createBotListAtom({
  botsAtom: environmentProjects.botsAtom,
  quietThreadShellAtom: environmentThreadShells.quietThreadShellAtom,
  previewsAtom: createBotPreviewsAtomFamily(connectionAtomRuntime, {
    botsAtom: environmentProjects.botsAtom,
    quietThreadShellAtom: environmentThreadShells.quietThreadShellAtom,
  }),
});

/** The newest bot with a reply the user has not opened, shown on the sidebar's Bots button. */
export const unreadBotAtom = Atom.make((get) => get(botListAtom).find((bot) => bot.unread) ?? null);

export type SidebarMode = "threads" | "bots";
export const sidebarModeAtom = Atom.make<SidebarMode>("threads").pipe(Atom.keepAlive);
