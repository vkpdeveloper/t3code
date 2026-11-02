import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ShellSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { createBotListAtom } from "./bots.ts";
import { v2Project, v2ShellSnapshot, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { createEnvironmentProjectAtoms } from "./projectEntities.ts";
import { createEnvironmentThreadShellAtoms } from "./threadShell.ts";

const environmentId = EnvironmentId.make("environment-bots");
const botProjectId = ProjectId.make("bot-project");
const botThreadId = ThreadId.make("bot-thread");
const botChildThreadId = ThreadId.make("bot-child");

const botProject = {
  ...v2Project,
  id: botProjectId,
  title: "Scout",
  workspaceRoot: "/t3/bots/scout",
  bot: {
    threadId: botThreadId,
    avatar: { shape: "star", color: "teal" },
    description: null,
  },
};

const reply = (at: string) => ({
  id: MessageId.make(`reply-${at}`),
  role: "assistant" as const,
  text: "Found  three\nflights.",
  updatedAt: DateTime.makeUnsafe(at),
});

function makeHarness(snapshot: OrchestrationV2ShellSnapshot) {
  const snapshotAtom = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>(snapshot),
  );
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([
      [
        environmentId,
        {
          target: new PrimaryConnectionTarget({
            environmentId,
            label: "Environment",
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          profile: Option.none(),
          enabled: true,
        },
      ],
    ]),
  });
  const projects = createEnvironmentProjectAtoms({ catalogValueAtom, snapshotAtom });
  const threads = createEnvironmentThreadShellAtoms({ catalogValueAtom, snapshotAtom });
  const bots = createBotListAtom({
    botsAtom: projects.botsAtom,
    quietThreadShellAtom: threads.quietThreadShellAtom,
  });
  return { registry: AtomRegistry.make(), snapshotAtom, projects, threads, bots };
}

describe("bots", () => {
  it("keeps bots and their threads out of project and thread lists but reachable by id", () => {
    const { registry, projects, threads, bots } = makeHarness({
      ...v2ShellSnapshot,
      projects: [v2Project, botProject],
      threads: [
        v2ThreadShell,
        { ...v2ThreadShell, id: botThreadId, projectId: botProjectId },
        {
          ...v2ThreadShell,
          id: botChildThreadId,
          projectId: botProjectId,
          lineage: {
            rootThreadId: botThreadId,
            parentThreadId: botThreadId,
            relationshipToParent: "subagent",
          },
        },
      ],
    });

    expect(registry.get(projects.projectsAtom).map((project) => project.id)).toEqual([
      v2Project.id,
    ]);
    expect(registry.get(threads.threadShellsAtom).map((thread) => thread.id)).toEqual([
      v2ThreadShell.id,
    ]);
    expect(registry.get(threads.threadRefsAtom)).toHaveLength(1);
    expect(registry.get(projects.projectAtom({ environmentId, projectId: botProjectId }))).not.toBe(
      null,
    );
    expect(
      registry.get(threads.threadShellAtom({ environmentId, threadId: botThreadId }))?.id,
    ).toBe(botThreadId);
    expect(registry.get(bots).map((bot) => bot.name)).toEqual(["Scout"]);
    registry.dispose();
  });

  it("marks a reply unread until the thread is visited after it, newest activity first", () => {
    const { registry, snapshotAtom, bots } = makeHarness({
      ...v2ShellSnapshot,
      projects: [
        botProject,
        {
          ...botProject,
          id: ProjectId.make("quiet"),
          title: "Quiet",
          bot: { ...botProject.bot, threadId: ThreadId.make("quiet-thread") },
        },
      ],
      threads: [
        {
          ...v2ThreadShell,
          id: botThreadId,
          projectId: botProjectId,
          latestVisibleMessage: reply("2026-06-20T10:00:00.000Z"),
          lastVisitedAt: DateTime.makeUnsafe("2026-06-20T09:00:00.000Z"),
        },
        {
          ...v2ThreadShell,
          id: ThreadId.make("quiet-thread"),
          projectId: ProjectId.make("quiet"),
          latestVisibleMessage: reply("2026-06-20T08:00:00.000Z"),
          lastVisitedAt: DateTime.makeUnsafe("2026-06-20T08:30:00.000Z"),
        },
      ],
    });

    const [first, second] = registry.get(bots);
    expect(first).toMatchObject({ name: "Scout", unread: true, preview: "Found three flights." });
    expect(second).toMatchObject({ name: "Quiet", unread: false });

    const visited = registry.get(snapshotAtom(environmentId))!;
    registry.set(snapshotAtom(environmentId), {
      ...visited,
      threads: visited.threads.map((thread) =>
        thread.id === botThreadId
          ? { ...thread, lastVisitedAt: DateTime.makeUnsafe("2026-06-20T10:05:00.000Z") }
          : thread,
      ),
    });
    expect(registry.get(bots)[0]).toMatchObject({ name: "Scout", unread: false });
    registry.dispose();
  });
});
