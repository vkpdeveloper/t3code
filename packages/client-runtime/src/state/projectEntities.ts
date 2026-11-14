import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2ShellSnapshot,
  ProjectId,
  ScopedProjectRef,
  ServerConfig,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentProject } from "./models.ts";
import { scopeProject } from "./models.ts";
import { isScratchProject } from "./projects.ts";
import { isBotProject } from "./bots.ts";
import { type EnvironmentCatalogState, enabledEnvironmentIds } from "./connections.ts";
import { arrayElementsEqual, parseProjectKey, projectKey, projectRefsEqual } from "./entities.ts";

const EMPTY_PROJECTS: ReadonlyArray<OrchestrationProjectShell> = Object.freeze([]);
const EMPTY_PROJECT_INDEX: ReadonlyMap<ProjectId, OrchestrationProjectShell> = new Map();

export function createEnvironmentProjectAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationV2ShellSnapshot | null>;
  readonly serverConfigValueAtom?: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<Pick<ServerConfig, "scratchWorkspaceRoot"> | null>;
}) {
  const environmentProjectsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationProjectShell> =>
        get(input.snapshotAtom(environmentId))?.projects ?? EMPTY_PROJECTS,
    ).pipe(Atom.withLabel(`environment-projects:${environmentId}`)),
  );

  const environmentProjectIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<ProjectId, OrchestrationProjectShell> => {
      const projects = get(environmentProjectsAtom(environmentId));
      if (projects.length === 0) {
        return EMPTY_PROJECT_INDEX;
      }
      return new Map(projects.map((project) => [project.id, project] as const));
    }).pipe(Atom.withLabel(`environment-project-index:${environmentId}`)),
  );

  // Bots are projects, but they live in the Bots list rather than among projects.
  const makeRefsAtom = (environmentId: EnvironmentId, bots: boolean, label: string) => {
    let previous: ReadonlyArray<ScopedProjectRef> = [];
    return Atom.make((get) => {
      const next = get(environmentProjectsAtom(environmentId)).flatMap((project) =>
        isBotProject(project) === bots ? [{ environmentId, projectId: project.id }] : [],
      );
      if (projectRefsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`${label}:${environmentId}`));
  };
  const environmentProjectRefsAtom = Atom.family((environmentId: EnvironmentId) =>
    makeRefsAtom(environmentId, false, "environment-project-refs"),
  );
  const environmentBotRefsAtom = Atom.family((environmentId: EnvironmentId) =>
    makeRefsAtom(environmentId, true, "environment-bot-refs"),
  );

  const projectAtomFamily = Atom.family((key: string) => {
    const ref = parseProjectKey(key);
    let previousSource: OrchestrationProjectShell | null = null;
    let previousIsScratch = false;
    let previousValue: EnvironmentProject | null = null;
    return Atom.make((get) => {
      const source = get(environmentProjectIndexAtom(ref.environmentId)).get(ref.projectId) ?? null;
      const scratch =
        source !== null &&
        isScratchProject(
          source,
          input.serverConfigValueAtom
            ? get(input.serverConfigValueAtom(ref.environmentId))?.scratchWorkspaceRoot
            : null,
        );
      if (source === previousSource && scratch === previousIsScratch) {
        return previousValue;
      }
      previousSource = source;
      previousIsScratch = scratch;
      previousValue =
        source === null
          ? null
          : {
              ...scopeProject(ref.environmentId, source),
              ...(scratch ? { isScratch: true as const } : {}),
            };
      return previousValue;
    }).pipe(Atom.withLabel(`environment-project:${key}`));
  });

  let previousProjectRefs: ReadonlyArray<ScopedProjectRef> = [];
  const projectRefsAtom = Atom.make((get) => {
    const refs: ScopedProjectRef[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      refs.push(...get(environmentProjectRefsAtom(environmentId)));
    }
    if (projectRefsEqual(previousProjectRefs, refs)) {
      return previousProjectRefs;
    }
    previousProjectRefs = refs;
    return refs;
  }).pipe(Atom.withLabel("environment-project-refs"));

  let previousProjects: ReadonlyArray<EnvironmentProject> = [];
  const projectsAtom = Atom.make((get) => {
    const next = get(projectRefsAtom).flatMap((ref) => {
      const project = get(projectAtomFamily(projectKey(ref)));
      return project === null ? [] : [project];
    });
    if (arrayElementsEqual(previousProjects, next)) {
      return previousProjects;
    }
    previousProjects = next;
    return previousProjects;
  }).pipe(Atom.withLabel("environment-project-list"));

  let previousBots: ReadonlyArray<EnvironmentProject> = [];
  const botsAtom = Atom.make((get) => {
    const next: EnvironmentProject[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      for (const ref of get(environmentBotRefsAtom(environmentId))) {
        const project = get(projectAtomFamily(projectKey(ref)));
        if (project !== null) next.push(project);
      }
    }
    if (arrayElementsEqual(previousBots, next)) return previousBots;
    previousBots = next;
    return next;
  }).pipe(Atom.withLabel("environment-bot-list"));

  const projectConfigsReadyAtom = Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    if (!catalog.isReady) return false;
    for (const environmentId of enabledEnvironmentIds(catalog)) {
      if (input.serverConfigValueAtom && get(input.serverConfigValueAtom(environmentId)) === null) {
        return false;
      }
    }
    return true;
  }).pipe(Atom.withLabel("environment-project-configs-ready"));

  return {
    environmentProjectsAtom,
    environmentProjectIndexAtom,
    environmentProjectRefsAtom,
    projectRefsAtom,
    projectsAtom,
    botsAtom,
    projectConfigsReadyAtom,
    projectAtom: (ref: ScopedProjectRef) => projectAtomFamily(projectKey(ref)),
  };
}
