/**
 * GrokSkills — skill discovery for the `$` picker via `grok inspect --json`.
 *
 * Unlike Claude Code, the Grok CLI reports its full skill catalog itself:
 * `grok inspect --json` returns `skills[]` with `name`, `description`,
 * `source.type` (`user` / `project` / `bundled` / `plugin`), `source.path`
 * (the absolute `SKILL.md` path), and `userInvocable`. Asking the CLI beats
 * scanning the filesystem because the catalog honors Grok's own skill config
 * (ignore lists, disabled skills) and includes plugin skills, which live
 * three levels deep under `~/.grok/installed-plugins/` where a flat scan
 * cannot see them. This mirrors how the Codex app-server reports skills over
 * `skills/list`. Discovery is best-effort: an older CLI without `inspect`,
 * a timeout, or a non-zero exit falls back to the filesystem locations used
 * by older Grok versions. Malformed successful output also falls back, while a
 * valid empty catalog remains empty.
 *
 * @module provider/Drivers/GrokSkills
 */
import * as NodeOS from "node:os";

import type { GrokSettings, ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { parse as parseYamlDocument } from "yaml";

import { spawnAndCollect } from "../providerSnapshot.ts";

const GROK_SKILLS_PROBE_TIMEOUT_MS = 4_000;

type GrokSkillScope = "system" | "user" | "project";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "parsed"; readonly name?: string; readonly description?: string };

function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { kind: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed" };
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return {
    kind: "parsed",
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

function skillDedupKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Resolve the user home used for `~/.agents` (and default `~/.grok`). Prefer
 * `HOME` / `USERPROFILE` from the provider environment so tests can isolate
 * discovery without touching the real home directory.
 */
const resolveUserHomePath = Effect.fn("resolveUserHomePath")(function* (
  environment: NodeJS.ProcessEnv,
  cwd?: string,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim() || "";
  if (home.length > 0) {
    return cwd ? path.resolve(cwd, home) : path.resolve(home);
  }
  return NodeOS.homedir();
});

/**
 * Resolve the Grok home directory the CLI would use: `GROK_HOME` when set
 * (resolved against the workspace cwd when relative), otherwise `<user home>/.grok`.
 */
const resolveGrokHomePath = Effect.fn("resolveGrokHomePath")(function* (
  environment: NodeJS.ProcessEnv,
  userHomePath: string,
  cwd?: string,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  // Env vars are never shell-expanded, so a literal `~` must stay literal for
  // discovery to match the runtime. Relative values resolve against cwd.
  const grokHome = environment.GROK_HOME?.trim() ?? "";
  if (grokHome.length > 0) {
    return cwd ? path.resolve(cwd, grokHome) : path.resolve(grokHome);
  }
  return path.join(userHomePath, ".grok");
});

const discoverGrokSkillsFromFilesystem = Effect.fn("discoverGrokSkills")(function* (
  cwd?: string,
  environment?: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = environment ?? process.env;
  const userHomePath = yield* resolveUserHomePath(env, cwd);
  const homePath = yield* resolveGrokHomePath(env, userHomePath, cwd);

  // Lowest priority first. Later roots overwrite earlier ones with the same
  // case-insensitive name.
  const roots: ReadonlyArray<{ directory: string; scope: GrokSkillScope }> = [
    { directory: path.join(homePath, "bundled", "skills"), scope: "system" },
    { directory: path.join(userHomePath, ".agents", "skills"), scope: "user" },
    { directory: path.join(homePath, "skills"), scope: "user" },
    ...(cwd
      ? [
          { directory: path.join(cwd, ".agents", "skills"), scope: "project" as const },
          { directory: path.join(cwd, ".claude", "skills"), scope: "project" as const },
          { directory: path.join(cwd, ".grok", "skills"), scope: "project" as const },
        ]
      : []),
  ];

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const root of roots) {
    const entries = yield* fileSystem
      .readDirectory(root.directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    for (const entry of [...entries].sort()) {
      const skillPath = path.join(root.directory, entry, "SKILL.md");
      const contents = yield* fileSystem
        .readFileString(skillPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) {
        continue;
      }

      const frontmatter = parseSkillFrontmatter(contents);
      // Malformed frontmatter means the skill won't load in Grok either —
      // skip it rather than surfacing a broken entry under its directory name.
      if (frontmatter.kind === "malformed") {
        continue;
      }

      const name = (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ?? entry.trim();
      if (!name) {
        continue;
      }

      skillsByName.set(skillDedupKey(name), {
        name,
        path: skillPath,
        enabled: true,
        scope: root.scope,
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
      });
    }
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});

/**
 * Map `grok inspect --json` output onto provider skills. Entries without a
 * name or a filesystem path are skipped; `userInvocable: false` skills are
 * kept but disabled so pickers that filter on `enabled` hide them.
 */
export function parseGrokInspectSkills(stdout: string): ReadonlyArray<ServerProviderSkill> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const entries = (parsed as Record<string, unknown>).skills;
  if (!Array.isArray(entries)) {
    return [];
  }

  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const source =
      typeof record.source === "object" && record.source !== null
        ? (record.source as Record<string, unknown>)
        : undefined;
    const path = typeof source?.path === "string" ? source.path.trim() : "";
    if (!name || !path) {
      continue;
    }
    const scope = typeof source?.type === "string" ? source.type.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    skillsByName.set(name, {
      name,
      path,
      enabled: record.userInvocable !== false,
      ...(scope ? { scope } : {}),
      ...(description ? { description } : {}),
    });
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function hasGrokInspectSkillsPayload(stdout: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return false;
  }
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).skills)
  );
}

/**
 * Run `grok inspect --json` and map the reported catalog onto provider
 * skills. Never fails: any spawn error, non-zero exit, or timeout resolves
 * to an empty list.
 */
export const discoverGrokSkills = Effect.fn("discoverGrokSkills")(function* (
  grokSettings: Pick<GrokSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Effect.fn.Return<
  ReadonlyArray<ServerProviderSkill>,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const command = grokSettings.binaryPath || "grok";
  const inspectResult = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(command, ["inspect", "--json"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        ...(cwd ? { cwd } : {}),
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  }).pipe(Effect.timeoutOption(GROK_SKILLS_PROBE_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(inspectResult) || Option.isNone(inspectResult.success)) {
    yield* Effect.logDebug("Grok skill discovery failed; continuing without skills.");
    return yield* discoverGrokSkillsFromFilesystem(cwd, environment);
  }
  const output = inspectResult.success.value;
  if (output.code !== 0) {
    yield* Effect.logDebug("Grok skill discovery exited non-zero; continuing without skills.", {
      exitCode: output.code,
    });
    return yield* discoverGrokSkillsFromFilesystem(cwd, environment);
  }
  const skills = parseGrokInspectSkills(output.stdout);
  if (skills.length > 0) {
    return skills;
  }
  if (hasGrokInspectSkillsPayload(output.stdout)) {
    return skills;
  }
  // Older Grok versions may print ordinary command output for `inspect`.
  return yield* discoverGrokSkillsFromFilesystem(cwd, environment);
});
