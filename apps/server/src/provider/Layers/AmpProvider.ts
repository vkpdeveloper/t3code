import * as Schema from "effect/Schema";
import * as Path from "effect/Path";
import * as Data from "effect/Data";
class AmpSkillsError extends Data.TaggedError("AmpSkillsError")<{ readonly detail: string }> {}
import * as Result from "effect/Result";
import * as DateTime from "effect/DateTime";
import { ChildProcess } from "effect/unstable/process";
import { spawnAndCollect, providerModelsFromSettings } from "../providerSnapshot.ts";
import type { AmpSettings, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import { buildServerProvider, parseGenericCliVersion } from "../providerSnapshot.ts";

export const AMP_MODES = ["low", "medium", "high", "ultra"] as const;
export const AMP_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    {
      id: "fast",
      label: "Fast",
      description: "Faster serving, billed at a premium",
      type: "boolean",
    },
    { id: "pro", label: "Pro", description: "Requires an OpenAI API connection", type: "boolean" },
    { id: "thinking", label: "Thinking", type: "boolean", currentValue: true },
    {
      id: "visibility",
      label: "Visibility",
      type: "select",
      options: ["private", "unlisted", "workspace", "group"].map((id) => ({ id, label: id })),
    },
  ],
});
export function ampModels(settings: AmpSettings): ServerProviderModel[] {
  return [
    ...providerModelsFromSettings(
      AMP_MODES.map((mode) => ({
        slug: mode,
        name: mode[0]!.toUpperCase() + mode.slice(1),
        isCustom: false,
        isDefault: mode === "medium",
        capabilities: AMP_CAPABILITIES,
      })),
      settings.customModels,
      AMP_CAPABILITIES,
    ),
  ];
}
export const runAmpCommand = (
  settings: AmpSettings,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
  cwd?: string,
) =>
  spawnAndCollect(
    settings.binaryPath || "amp",
    ChildProcess.make(
      settings.binaryPath || "amp",
      [...(settings.settingsFile ? ["--settings-file", settings.settingsFile] : []), ...args],
      { env: environment, ...(cwd ? { cwd } : {}) },
    ),
  ).pipe(Effect.timeout("20 seconds"), Effect.scoped);

const presentation = {
  displayName: "Amp",
  showInteractionModeToggle: false,
  supportsConversationRollback: false,
  requiresNewThreadForModelChange: false,
};
export const buildInitialAmpProviderSnapshot = (settings: AmpSettings) =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return buildServerProvider({
      presentation,
      enabled: settings.enabled,
      checkedAt,
      models: ampModels(settings),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled ? "Checking Amp CLI..." : "Amp is disabled.",
      },
    });
  });
export const checkAmpProviderStatus = (settings: AmpSettings, environment: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    if (!settings.enabled) return yield* buildInitialAmpProviderSnapshot(settings);
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const base = { presentation, enabled: true, checkedAt, models: ampModels(settings) };
    const versionResult = yield* Effect.result(runAmpCommand(settings, environment, ["--version"]));
    if (Result.isFailure(versionResult) || versionResult.success.code !== 0)
      return buildServerProvider({
        ...base,
        probe: {
          installed: false,
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: "Amp CLI could not be started. Check its binary path.",
        },
      });
    const version = parseGenericCliVersion(versionResult.success.stdout);
    const usage = yield* Effect.result(runAmpCommand(settings, environment, ["usage"]));
    return buildServerProvider({
      ...base,
      probe:
        Result.isSuccess(usage) && usage.success.code === 0
          ? {
              installed: true,
              version,
              status: "ready",
              auth: { status: "authenticated", type: "cached_token", label: "Amp account" },
            }
          : {
              installed: true,
              version,
              status: "warning",
              auth: { status: "unknown" },
              message: "Could not verify Amp sign-in. Run amp login on this environment.",
            },
    });
  });

const SkillList = Schema.fromJsonString(
  Schema.Struct({
    skills: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.optional(Schema.String),
        baseDir: Schema.String,
        source: Schema.String,
      }),
    ),
  }),
);
const decodeSkillList = Schema.decodeEffect(SkillList);
export const discoverAmpSkills = (
  settings: AmpSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) =>
  Effect.gen(function* () {
    const result = yield* runAmpCommand(settings, environment, ["skill", "list", "--json"], cwd);
    if (result.code !== 0)
      return yield* Effect.fail(new AmpSkillsError({ detail: "Amp skill discovery failed" }));
    const path = yield* Path.Path;
    const { skills } = yield* decodeSkillList(result.stdout);
    return skills.map((skill) => ({
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      path: skill.baseDir.startsWith("builtin:")
        ? `${skill.baseDir}/${skill.name}`
        : path.join(skill.baseDir, "SKILL.md"),
      scope: skill.source,
      enabled: true,
    }));
  });
