import type {
  BotAvatar,
  EnvironmentId,
  OrchestrationProjectShell,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";

import { arrayElementsEqual } from "./entities.ts";
import {
  type EnvironmentProject,
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "./models.ts";

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

/** A reply the user has not opened yet. Opening the thread moves `lastVisitedAt` past it. */
function hasUnreadBotReply(shell: EnvironmentThreadShell): boolean {
  const message = shell.source.latestVisibleMessage;
  if (message === null || message.role !== "assistant") return false;
  if (shell.lastVisitedAt == null) return true;
  return DateTime.toEpochMillis(message.updatedAt) > Date.parse(shell.lastVisitedAt);
}

function previewText(text: string): string | null {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length === 0 ? null : line.slice(0, 160);
}

function summarizeBot(
  project: EnvironmentProject,
  shell: EnvironmentThreadShell | null,
): BotSummary | null {
  const bot = project.bot;
  if (bot == null) return null;
  const message = shell?.source.latestVisibleMessage ?? null;
  const working = threadRuntimeIsActive(shell?.runtime);
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
    preview: message === null ? null : previewText(message.text),
    activityAt:
      message === null
        ? (shell?.updatedAt ?? project.createdAt)
        : DateTime.formatIso(message.updatedAt),
    unread: shell !== null && hasUnreadBotReply(shell),
    working,
  };
}

/** Like a chat list: the most recent activity first. */
function compareBots(left: BotSummary, right: BotSummary): number {
  const byActivity = Date.parse(right.activityAt) - Date.parse(left.activityAt);
  if (byActivity !== 0 && !Number.isNaN(byActivity)) return byActivity;
  return left.name.localeCompare(right.name);
}

/**
 * Reads quiet shells, so the list reorders when a reply lands rather than on
 * every streamed token. Summaries keep their identity while nothing changed.
 */
export function createBotListAtom(input: {
  readonly botsAtom: Atom.Atom<ReadonlyArray<EnvironmentProject>>;
  readonly quietThreadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>;
}) {
  const cache = new WeakMap<
    EnvironmentProject,
    { shell: EnvironmentThreadShell | null; summary: BotSummary | null }
  >();
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
      let entry = cache.get(project);
      if (entry === undefined || entry.shell !== shell) {
        entry = { shell, summary: summarizeBot(project, shell) };
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
