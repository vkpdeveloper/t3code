import {
  type BotAvatar,
  type BotPreview,
  type BotPreviewsResult,
  type EnvironmentId,
  type OrchestrationProjectShell,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
  WS_METHODS,
} from "@t3tools/contracts";
import { markdownPreviewText } from "@t3tools/shared/markdownPreview";
import { AsyncResult, Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import { arrayElementsEqual } from "./entities.ts";
import {
  type EnvironmentProject,
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "./models.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

const EMPTY_PROJECT_IDS: ReadonlySet<ProjectId> = new Set();

export function isBotProject(project: Pick<OrchestrationProjectShell, "bot">): boolean {
  return project.bot != null;
}

/** Bot projects and everything in them stay out of project and thread lists. */
export function botProjectIds(
  projects: ReadonlyArray<Pick<OrchestrationProjectShell, "id" | "bot">>,
): ReadonlySet<ProjectId> {
  let ids: Set<ProjectId> | null = null;
  for (const project of projects) {
    if (project.bot == null) continue;
    ids ??= new Set();
    ids.add(project.id);
  }
  return ids ?? EMPTY_PROJECT_IDS;
}

export interface BotSummary {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly threadRef: ScopedThreadRef;
  readonly name: string;
  readonly avatar: BotAvatar;
  readonly description: string | null;
  readonly workspaceRoot: string;
  readonly preview: string | null;
  /** ISO time of the bot's latest activity, used to order the list. */
  readonly activityAt: string;
  readonly unread: boolean;
  readonly working: boolean;
}

/**
 * Like a thread's unseen completion: a run finished after the user last opened the chat.
 * A bot the user never opened counts too, since its first run is its greeting.
 */
function hasUnreadBotReply(shell: EnvironmentThreadShell): boolean {
  const completedAt = shell.latestRun?.completedAt;
  if (!completedAt) return false;
  if (!shell.lastVisitedAt) return true;
  return Date.parse(completedAt) > Date.parse(shell.lastVisitedAt);
}

function previewText(preview: BotPreview): string | null {
  const line = markdownPreviewText(preview.text);
  if (line.length === 0) return null;
  return (preview.role === "user" ? `You: ${line}` : line).slice(0, 160);
}

function latestOf(...times: ReadonlyArray<string | null | undefined>): string {
  let latest = "";
  for (const time of times) {
    if (time && (latest === "" || Date.parse(time) > Date.parse(latest))) latest = time;
  }
  return latest;
}

function summarizeBot(
  project: EnvironmentProject,
  shell: EnvironmentThreadShell | null,
  preview: BotPreview | null,
): BotSummary | null {
  const bot = project.bot;
  if (bot == null) return null;
  return {
    key: `${project.environmentId}:${project.id}`,
    environmentId: project.environmentId,
    projectId: project.id,
    threadId: bot.threadId,
    threadRef: { environmentId: project.environmentId, threadId: bot.threadId },
    name: project.title,
    avatar: bot.avatar,
    description: bot.description,
    workspaceRoot: project.workspaceRoot,
    preview: preview === null ? null : previewText(preview),
    activityAt: latestOf(
      project.createdAt,
      shell?.latestUserMessageAt,
      shell?.latestRun?.completedAt,
      preview?.updatedAt,
    ),
    unread: shell !== null && hasUnreadBotReply(shell),
    working: threadRuntimeIsActive(shell?.runtime),
  };
}

/** Like a chat list: the most recent activity first. */
function compareBots(left: BotSummary, right: BotSummary): number {
  const byActivity = Date.parse(right.activityAt) - Date.parse(left.activityAt);
  if (byActivity !== 0 && !Number.isNaN(byActivity)) return byActivity;
  return left.name.localeCompare(right.name);
}

type BotPreviewsAtom = (
  environmentId: EnvironmentId,
) => Atom.Atom<AsyncResult.AsyncResult<BotPreviewsResult, unknown>>;

/**
 * Each environment's bot previews, fetched again only when one of its bots gets a new
 * message from the user or finishes a run. Thread shells carry no message text.
 */
export function createBotPreviewsAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  input: {
    readonly botsAtom: Atom.Atom<ReadonlyArray<EnvironmentProject>>;
    readonly quietThreadShellAtom: (
      ref: ScopedThreadRef,
    ) => Atom.Atom<EnvironmentThreadShell | null>;
  },
) {
  const activity = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get) => {
      let key = "";
      for (const project of get(input.botsAtom)) {
        if (project.environmentId !== environmentId || project.bot == null) continue;
        const shell = get(
          input.quietThreadShellAtom({ environmentId, threadId: project.bot.threadId }),
        );
        key += `${project.bot.threadId}:${shell?.latestUserMessageAt}:${shell?.latestRun?.completedAt};`;
      }
      return key;
    }),
  );
  const family = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:bots:previews",
    tag: WS_METHODS.botsPreviews,
    refreshTrigger: ({ environmentId }) => activity(environmentId),
  });
  return (environmentId: EnvironmentId) => family({ environmentId, input: {} });
}

/**
 * Reads quiet shells, so the list reorders when a reply lands rather than on
 * every streamed token. Summaries keep their identity while nothing changed.
 */
export function createBotListAtom(input: {
  readonly botsAtom: Atom.Atom<ReadonlyArray<EnvironmentProject>>;
  readonly quietThreadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>;
  readonly previewsAtom: BotPreviewsAtom;
}) {
  const cache = new WeakMap<
    EnvironmentProject,
    {
      shell: EnvironmentThreadShell | null;
      preview: BotPreview | null;
      summary: BotSummary | null;
    }
  >();
  const previewMaps = new WeakMap<BotPreviewsResult, ReadonlyMap<string, BotPreview>>();
  const previewsIn = (result: BotPreviewsResult | null) => {
    if (result === null) return null;
    let map = previewMaps.get(result);
    if (map === undefined) {
      map = new Map(result.previews.map((preview) => [preview.threadId, preview]));
      previewMaps.set(result, map);
    }
    return map;
  };
  let previous: ReadonlyArray<BotSummary> = [];
  return Atom.make((get) => {
    const next: BotSummary[] = [];
    for (const project of get(input.botsAtom)) {
      if (project.bot == null) continue;
      const shell = get(
        input.quietThreadShellAtom({
          environmentId: project.environmentId,
          threadId: project.bot.threadId,
        }),
      );
      const previews = previewsIn(
        AsyncResult.getOrElse(get(input.previewsAtom(project.environmentId)), () => null),
      );
      const preview = previews?.get(project.bot.threadId) ?? null;
      let entry = cache.get(project);
      // Compared by value: every refetch decodes new preview objects.
      if (
        entry === undefined ||
        entry.shell !== shell ||
        entry.preview?.text !== preview?.text ||
        entry.preview?.updatedAt !== preview?.updatedAt
      ) {
        entry = { shell, preview, summary: summarizeBot(project, shell, preview) };
        cache.set(project, entry);
      }
      if (entry.summary !== null) next.push(entry.summary);
    }
    next.sort(compareBots);
    if (arrayElementsEqual(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel("bot-list"));
}
