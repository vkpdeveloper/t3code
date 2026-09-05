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
 * by older Grok versions. If the fallback is also empty, the typed probe error
 * prevents workspace snapshots from caching an empty catalog.
 *
 * @module provider/Drivers/GrokSkills
 */
import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type { GrokSettings, ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";
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

class GrokSkillsProbeError extends Schema.TaggedErrorClass<GrokSkillsProbeError>()(
  "GrokSkillsProbeError",
  {
    stage: Schema.Literals(["spawn", "timeout", "exit", "decode"]),
    cwd: Schema.optional(Schema.String),
    exitCode: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const location = this.cwd === undefined ? "" : ` for '${this.cwd}'`;
    const exitCode = this.exitCode === undefined ? "" : ` with exit code ${this.exitCode}`;
    return `\`grok inspect --json\` failed during ${this.stage}${location}${exitCode}.`;
  }
}
/**
 * Map `grok inspect --json` output onto provider skills. Entries without a
 * name or a filesystem path are skipped; `userInvocable: false` skills are
 * kept but disabled so pickers that filter on `enabled` hide them.
 */
function decodeGrokInspectSkills(stdout: string): ReadonlyArray<ServerProviderSkill> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const entries = (parsed as Record<string, unknown>).skills;
  if (!Array.isArray(entries)) {
    return undefined;
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

/**
 * Run `grok inspect --json` and map the reported catalog onto provider
 * skills. Callers that need best-effort discovery can recover this effect to
 * an empty list; workspace callers leave failures typed so they are not cached.
 */
export const discoverGrokSkills = Effect.fn("discoverGrokSkills")(function* (
  grokSettings: Pick<GrokSettings, "binaryPath">,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
) {
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
  }).pipe(
    Effect.mapError(
      (cause) =>
        new GrokSkillsProbeError({
          stage: "spawn",
          ...(cwd ? { cwd } : {}),
          cause,
        }),
    ),
    Effect.timeoutOption(GROK_SKILLS_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  const fallbackOrFail = Effect.fn("GrokSkills.fallbackOrFail")(function* (
    error: GrokSkillsProbeError,
  ) {
    const fallback = yield* discoverGrokSkillsFromFilesystem(cwd, environment).pipe(
      Effect.provide(NodeServices.layer),
    );
    if (fallback.length > 0) {
      return fallback;
    }
    return yield* error;
  });

  if (Result.isFailure(inspectResult)) {
    return yield* fallbackOrFail(inspectResult.failure);
  }
  if (Option.isNone(inspectResult.success)) {
    return yield* fallbackOrFail(
      new GrokSkillsProbeError({
        stage: "timeout",
        ...(cwd ? { cwd } : {}),
      }),
    );
  }
  const output = inspectResult.success.value;
  if (output.code !== 0) {
    return yield* fallbackOrFail(
      new GrokSkillsProbeError({
        stage: "exit",
        ...(cwd ? { cwd } : {}),
        exitCode: output.code,
      }),
    );
  }
  const skills = decodeGrokInspectSkills(output.stdout);
  if (skills) {
    return skills;
  }
  return yield* fallbackOrFail(
    new GrokSkillsProbeError({
      stage: "decode",
      ...(cwd ? { cwd } : {}),
    }),
  );
});
