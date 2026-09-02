// @effect-diagnostics nodeBuiltinImport:off - resolves the mock ACP agent script path relative to this test file.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { GrokSettings } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  buildGrokDiscoveredModelsFromSessionModelState,
  buildGrokModelsFromSessionModelState,
  buildInitialGrokProviderSnapshot,
  checkGrokProviderStatus,
  parseGrokModelsCliOutput,
} from "./GrokProvider.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

const LOGGED_IN_MODELS_OUTPUT = [
  "You are logged in with grok.com.",
  "",
  "Default model: grok-4.6",
  "",
  "Available models:",
  "  * grok-4.6 (default)",
  "  - grok-4.5",
  "",
].join("\n");

const LOGGED_OUT_MODELS_OUTPUT = LOGGED_IN_MODELS_OUTPUT.replace(
  "You are logged in with grok.com.",
  "You are not authenticated.",
);

describe("parseGrokModelsCliOutput", () => {
  it("reads login state and model slugs, marking the default", () => {
    const parsed = parseGrokModelsCliOutput(LOGGED_IN_MODELS_OUTPUT);
    expect(parsed.authenticated).toBe(true);
    expect(parsed.models.map((model) => [model.slug, model.isDefault ?? false])).toEqual([
      ["grok-4.6", true],
      ["grok-4.5", false],
    ]);
  });

  it("detects a logged-out CLI even though it exits 0", () => {
    expect(parseGrokModelsCliOutput(LOGGED_OUT_MODELS_OUTPUT).authenticated).toBe(false);
  });

  it("returns unknown auth for unrecognized output", () => {
    expect(parseGrokModelsCliOutput("grok 9.9.9\n").authenticated).toBeNull();
  });
});

describe("buildGrokModelsFromSessionModelState", () => {
  it("marks the agent's current model as default and keeps reasoning options", () => {
    const models = buildGrokModelsFromSessionModelState({
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: {
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [{ value: "high", label: "High", default: true }],
          },
        },
        { modelId: "grok-4.5", name: "Grok 4.5" },
      ],
    });
    expect(models.map((model) => [model.slug, model.isDefault ?? false])).toEqual([
      ["grok-4.6", true],
      ["grok-4.5", false],
    ]);
    expect(models[0]?.capabilities?.optionDescriptors).toHaveLength(1);
  });
});

function mockGrokWrapperScript(mockAgentPath: string, extraEnv?: Record<string, string>): string {
  const modelsOutput =
    extraEnv?.T3_ACP_FAIL_AUTHENTICATION === "1"
      ? LOGGED_OUT_MODELS_OUTPUT
      : LOGGED_IN_MODELS_OUTPUT;
  return [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then',
    '  printf "grok-cli 1.0.5\\n"',
    "  exit 0",
    "fi",
    'if [ "$1" = "inspect" ]; then',
    "  printf '{\"skills\":[]}\\n'",
    "  exit 0",
    "fi",
    'if [ "$1" = "models" ]; then',
    `  printf '%b' ${JSON.stringify(modelsOutput)}`,
    "  exit 0",
    "fi",
    ...Object.entries(extraEnv ?? {}).map(
      ([key, value]) => `export ${key}=${JSON.stringify(value)}`,
    ),
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"`,
    "",
  ].join("\n");
}

describe("buildInitialGrokProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(
        decodeGrokSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a disabled snapshot by default — Grok is opt-in", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(decodeGrokSettings({}));
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
    }),
  );

  it.effect("returns a pending snapshot when enabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(
        decodeGrokSettings({ enabled: true }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Grok");
      expect(snapshot.requiresNewThreadForModelChange).toBe(false);
      expect(snapshot.showInteractionModeToggle).toBe(false);
    }),
  );
});

describe("buildGrokDiscoveredModelsFromSessionModelState", () => {
  it("maps Grok reasoning metadata and marks the ACP current model as default", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState({
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: {
            agentType: "grok-build",
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [
              {
                id: "deep",
                value: "xhigh",
                label: "Deep",
                description: "Spend the most time reasoning.",
                default: false,
              },
              {
                id: "high",
                value: "high",
                label: "High",
                description: "Balance speed and depth.",
                default: true,
              },
              { id: "low", value: "low", label: "Low", default: false },
            ],
          },
        },
        {
          modelId: "grok-4.5",
          name: "Grok 4.5",
          _meta: {
            agentType: "grok-build-plan",
            supportsReasoningEffort: true,
            reasoningEffort: "medium",
            reasoningEfforts: [
              { value: "medium", label: "Medium", default: true },
              { value: "low", label: "Low", default: false },
            ],
          },
        },
        {
          modelId: "grok-codex",
          name: "Grok Codex",
          _meta: { agentType: "codex" },
        },
      ],
    } satisfies EffectAcpSchema.SessionModelState);

    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({
      slug: "grok-4.6",
      name: "Grok 4.6",
      isDefault: true,
      sessionCompatibilityGroup: "grok-stock",
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            currentValue: "high",
            options: [
              {
                id: "xhigh",
                label: "Deep",
                description: "Spend the most time reasoning.",
              },
              {
                id: "high",
                label: "High",
                description: "Balance speed and depth.",
                isDefault: true,
              },
              { id: "low", label: "Low" },
            ],
          },
        ],
      },
    });
    expect(models[1]?.isDefault).toBeUndefined();
    expect(models[1]?.sessionCompatibilityGroup).toBe("grok-stock");
    expect(models[2]?.sessionCompatibilityGroup).toBe("grok-strict:codex");
  });

  it("keeps models with malformed effort metadata and drops invalid duplicates", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState({
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: {
            supportsReasoningEffort: true,
            reasoningEffort: "high",
            reasoningEfforts: [
              null,
              { value: " ", label: "Blank" },
              { value: "high", label: "High", default: true },
              { value: "high", label: "Duplicate" },
            ],
          },
        },
        {
          modelId: "grok-4.6",
          name: "Duplicate model",
        },
        {
          modelId: " ",
          name: "Blank model",
        },
        {
          modelId: "grok-4.5",
          name: "Grok 4.5",
          _meta: { supportsReasoningEffort: "yes", reasoningEfforts: {} },
        },
      ],
    } as EffectAcpSchema.SessionModelState);

    expect(models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-4.5"]);
    expect(models[0]?.capabilities?.optionDescriptors?.[0]).toMatchObject({
      currentValue: "high",
      options: [{ id: "high", label: "High", isDefault: true }],
    });
    expect(models[1]?.capabilities?.optionDescriptors).toEqual([]);
  });
});

it.layer(NodeServices.layer)("checkGrokProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkGrokProviderStatus(
        decodeGrokSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/grok-binary",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );

  it.effect("reports an installed CLI as unhealthy when --version exits non-zero", () =>
    Effect.gen(function* () {
      const secretStderr = "broken grok install: secret-token-value";
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-version-" });
          const grokPath = path.join(dir, "grok");
          yield* fs.writeFileString(
            grokPath,
            ["#!/bin/sh", `printf "%s\\n" "${secretStderr}" >&2`, "exit 2", ""].join("\n"),
          );
          yield* fs.chmod(grokPath, 0o755);

          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Grok CLI is installed but failed to run.");
      expect(snapshot.message).not.toContain(secretStderr);
    }),
  );

  // Single-quotes a path for /bin/sh. Temp dirs and execPath never contain quotes.
  const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

  // A shell stand-in for the Grok CLI: `--version` and `models` print canned text,
  // and `agent stdio` execs the mock ACP agent so `initialize` returns model metadata.
  const writeFakeGrokCli = (input: { readonly modelsOutput: string; readonly acp: boolean }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-probe-" });
      const modelsPath = path.join(dir, "models.txt");
      yield* fs.writeFileString(modelsPath, input.modelsOutput);
      const grokPath = path.join(dir, "grok");
      const mockAgentPath = path.resolve(__dirname, "../../../scripts/acp-mock-agent.ts");
      yield* fs.writeFileString(
        grokPath,
        [
          "#!/bin/sh",
          'case "$1" in',
          '  --version) printf "grok 1.0.13\\n"; exit 0;;',
          `  models) cat ${shellQuote(modelsPath)}; exit 0;;`,
          "  inspect) exit 1;;",
          input.acp
            ? `  *) exec ${shellQuote(process.execPath)} ${shellQuote(mockAgentPath)};;`
            : "  *) exit 3;;",
          "esac",
          "exit 1",
          "",
        ].join("\n"),
      );
      yield* fs.chmod(grokPath, 0o755);
      return grokPath;
    });

  it.effect("reports ready with ACP-discovered models when logged in", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const grokPath = yield* writeFakeGrokCli({
            modelsOutput: LOGGED_IN_MODELS_OUTPUT,
            acp: true,
          });
          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
            { ...process.env, XAI_API_KEY: "" },
          );
        }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.0.13");
      expect(snapshot.auth).toEqual({
        status: "authenticated",
        type: "cached_token",
        label: "Grok account",
      });
      // The mock agent advertises grok-4.6 with reasoning options in initialize._meta.
      expect(snapshot.models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-mock-alt"]);
      expect(snapshot.models[0]?.isDefault).toBe(true);
      expect(
        snapshot.models[0]?.capabilities?.optionDescriptors?.map((option) => option.id) ?? [],
      ).toEqual(["reasoningEffort"]);
    }),
  );

  it.effect("reports unauthenticated from `grok models` without starting a session", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const grokPath = yield* writeFakeGrokCli({
            modelsOutput: LOGGED_OUT_MODELS_OUTPUT,
            acp: true,
          });
          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
            { ...process.env, XAI_API_KEY: "" },
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("grok login");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-mock-alt"]);
    }),
  );

  it.effect("falls back to CLI-listed models with a warning when ACP initialize fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const grokPath = yield* writeFakeGrokCli({
            modelsOutput: LOGGED_IN_MODELS_OUTPUT,
            acp: false,
          });
          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
            { ...process.env, XAI_API_KEY: "" },
          );
        }),
      );

      expect(snapshot.status).toBe("warning");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.auth.status).toBe("authenticated");
      expect(snapshot.models.map((model) => [model.slug, model.isDefault ?? false])).toEqual([
        ["grok-4.6", true],
        ["grok-4.5", false],
      ]);
      expect(snapshot.message).toContain("ACP initialize failed");
    }),
  );

  it.effect("treats XAI_API_KEY as authenticated regardless of CLI login state", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const grokPath = yield* writeFakeGrokCli({
            modelsOutput: LOGGED_OUT_MODELS_OUTPUT,
            acp: false,
          });
          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
            { ...process.env, XAI_API_KEY: "xai-test-key" },
          );
        }),
      );

      expect(snapshot.auth).toEqual({
        status: "authenticated",
        type: "api_key",
        label: "xAI API key",
      });
      expect(snapshot.status).toBe("warning");
    }),
  );

  it.effect("includes discovered filesystem skills even when ACP startup fails", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-skills-snap-" });
          const userHome = path.join(dir, "user-home");
          const grokHome = path.join(userHome, ".grok");
          const agentsSkillDir = path.join(userHome, ".agents", "skills", "review");
          const grokSkillDir = path.join(grokHome, "skills", "unslop");
          const grokPath = path.join(dir, "grok");
          yield* fs.makeDirectory(agentsSkillDir, { recursive: true });
          yield* fs.makeDirectory(grokSkillDir, { recursive: true });
          yield* fs.writeFileString(
            path.join(agentsSkillDir, "SKILL.md"),
            ["---", "name: review", "description: Review changes.", "---"].join("\n"),
          );
          yield* fs.writeFileString(
            path.join(grokSkillDir, "SKILL.md"),
            ["---", "name: unslop", "description: Cut AI tells.", "---", "", "# Unslop"].join("\n"),
          );
          yield* fs.writeFileString(
            grokPath,
            ["#!/bin/sh", 'printf "grok-cli 0.0.99\\n"', "exit 0", ""].join("\n"),
          );
          yield* fs.chmod(grokPath, 0o755);

          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
            { ...process.env, HOME: userHome, GROK_HOME: grokHome },
          );
        }),
      );

      expect(snapshot.status).toBe("warning");
      expect(snapshot.message).toContain("ACP initialize failed");
      expect(snapshot.skills).toEqual([
        expect.objectContaining({
          name: "review",
          enabled: true,
          scope: "user",
          description: "Review changes.",
        }),
        expect.objectContaining({
          name: "unslop",
          enabled: true,
          scope: "user",
          description: "Cut AI tells.",
        }),
      ]);
    }),
  );

  it.effect("reports authenticated after successful Grok ACP discovery", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-authenticated-" });
          const grokPath = path.join(dir, "grok");
          const mockAgentPath = path.join(process.cwd(), "apps/server/scripts/acp-mock-agent.ts");
          yield* fs.writeFileString(grokPath, mockGrokWrapperScript(mockAgentPath));
          yield* fs.chmod(grokPath, 0o755);

          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
            { ...process.env, XAI_API_KEY: "" },
          );
        }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.auth).toEqual({
        status: "authenticated",
        type: "cached_token",
        label: "Grok account",
      });
      expect(snapshot.models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-mock-alt"]);
    }),
  );

  it.effect("reports unauthenticated when the Grok CLI reports a logged-out account", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-unauthenticated-" });
          const grokPath = path.join(dir, "grok");
          const mockAgentPath = path.join(process.cwd(), "apps/server/scripts/acp-mock-agent.ts");
          yield* fs.writeFileString(
            grokPath,
            mockGrokWrapperScript(mockAgentPath, { T3_ACP_FAIL_AUTHENTICATION: "1" }),
          );
          yield* fs.chmod(grokPath, 0o755);

          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.auth).toEqual({ status: "unauthenticated" });
    }),
  );
});
