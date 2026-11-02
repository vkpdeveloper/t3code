import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { createBotListAtom, createBotPreviewsAtomFamily } from "@t3tools/client-runtime/state/bots";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { appAtomRegistry } from "./atom-registry";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentProjects } from "./projects";
import { environmentThreadShells } from "./threads";

const botListAtom = createBotListAtom({
  botsAtom: environmentProjects.botsAtom,
  quietThreadShellAtom: environmentThreadShells.quietThreadShellAtom,
  previewsAtom: createBotPreviewsAtomFamily(connectionAtomRuntime, {
    botsAtom: environmentProjects.botsAtom,
    quietThreadShellAtom: environmentThreadShells.quietThreadShellAtom,
  }),
});

export function useBotList() {
  return useAtomValue(botListAtom);
}

function botForThread(
  bots: ReadonlyArray<EnvironmentProject>,
  environmentId: string,
  threadId: string,
) {
  return (
    bots.find((bot) => bot.environmentId === environmentId && bot.bot?.threadId === threadId) ??
    null
  );
}

/** Read outside React, for navigation decisions such as which tab a thread belongs to. */
export function isBotThread(environmentId: string, threadId: string) {
  return (
    botForThread(appAtomRegistry.get(environmentProjects.botsAtom), environmentId, threadId) !==
    null
  );
}

export function useBotProjectForThread(
  environmentId: EnvironmentId | null,
  threadId: string | null,
) {
  const bots = useAtomValue(environmentProjects.botsAtom);
  return environmentId === null || threadId === null
    ? null
    : botForThread(bots, environmentId, threadId);
}

export function useBotProject(environmentId: EnvironmentId, projectId: ProjectId) {
  const bots = useAtomValue(environmentProjects.botsAtom);
  return bots.find((bot) => bot.environmentId === environmentId && bot.id === projectId) ?? null;
}
