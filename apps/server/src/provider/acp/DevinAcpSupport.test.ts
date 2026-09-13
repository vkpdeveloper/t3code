// @effect-diagnostics nodeBuiltinImport:off - resolves the mock ACP agent script path relative to this test file.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/schema";

import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import {
  applyDevinAcpModelSelection,
  buildDevinAcpSpawnInput,
  buildDevinModelsFromConfigOptions,
  DEVIN_DEFAULT_MODEL_SLUG,
  makeDevinAcpRuntime,
  resolveDevinAcpModeId,
  resolveDevinAcpReadOnlyModeId,
} from "./DevinAcpSupport.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

// Modes exactly as devin 3000.10.21 advertises them over ACP.
const DEVIN_MODES = {
  currentModeId: "accept-edits",
  availableModes: [
    { id: "accept-edits", name: "Code" },
    { id: "smart", name: "Smart" },
    { id: "ask", name: "Ask" },
    { id: "plan", name: "Plan" },
    { id: "bypass", name: "Bypass Permissions" },
  ],
};

describe("buildDevinAcpSpawnInput", () => {
  it("runs `devin acp` and honors a custom binary path", () => {
    expect(buildDevinAcpSpawnInput(undefined, "/repo")).toEqual({
      command: "devin",
      args: ["acp"],
      cwd: "/repo",
    });
    expect(buildDevinAcpSpawnInput({ binaryPath: "/opt/devin" }, "/repo").command).toBe(
      "/opt/devin",
    );
  });
});

describe("resolveDevinAcpModeId", () => {
  const resolve = (
    runtimeMode: Parameters<typeof resolveDevinAcpModeId>[0]["runtimeMode"],
    interactionMode?: "plan",
  ) => resolveDevinAcpModeId({ runtimeMode, interactionMode, modeState: DEVIN_MODES });

  it("maps T3 permission modes onto Devin's modes", () => {
    expect(resolve("full-access")).toBe("bypass");
    expect(resolve("auto")).toBe("smart");
    expect(resolve("auto-accept-edits")).toBe("accept-edits");
  });

  it("never selects the read-only Ask mode for Approval Required", () => {
    // The generic ACP resolver would pick "ask" here, which drops all code changes.
    expect(resolve("approval-required")).toBe("accept-edits");
  });

  it("maps the plan interaction mode onto Devin's Plan mode", () => {
    expect(resolve("full-access", "plan")).toBe("plan");
  });

  it("falls back to generic mode names for other ACP agents", () => {
    const genericModes = {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "architect", name: "Architect" },
        { id: "code", name: "Code" },
      ],
    };
    expect(
      resolveDevinAcpModeId({
        runtimeMode: "approval-required",
        interactionMode: undefined,
        modeState: genericModes,
      }),
    ).toBe("code");
    expect(
      resolveDevinAcpModeId({
        runtimeMode: "full-access",
        interactionMode: "plan",
        modeState: genericModes,
      }),
    ).toBe("architect");
  });

  it("returns undefined without a usable mode", () => {
    expect(
      resolveDevinAcpModeId({
        runtimeMode: "full-access",
        interactionMode: undefined,
        modeState: undefined,
      }),
    ).toBeUndefined();
    expect(resolveDevinAcpReadOnlyModeId(DEVIN_MODES)).toBe("ask");
  });
});

describe("buildDevinModelsFromConfigOptions", () => {
  it("reads the model select option and marks the current value default", () => {
    const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
      {
        id: "mode",
        name: "Session Mode",
        category: "mode",
        type: "select",
        currentValue: "accept-edits",
        options: [{ value: "accept-edits", name: "Code" }],
      },
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "swe-1-6-slow",
        options: [
          { value: "swe-1-6-slow", name: "SWE-1.6 Slow" },
          { value: " claude-opus-5-medium ", name: "Claude Opus 5 Medium" },
          { value: "swe-1-6-slow", name: "Duplicate" },
        ],
      },
    ];
    expect(
      buildDevinModelsFromConfigOptions(configOptions).map((model) => [
        model.slug,
        model.name,
        model.isDefault ?? false,
      ]),
    ).toEqual([
      ["swe-1-6-slow", "SWE-1.6 Slow", true],
      ["claude-opus-5-medium", "Claude Opus 5 Medium", false],
    ]);
  });

  it("flattens grouped model options", () => {
    const models = buildDevinModelsFromConfigOptions([
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: "gpt-6-astra-high",
        options: [
          {
            group: "OpenAI",
            name: "OpenAI",
            options: [{ value: "gpt-6-astra-high", name: "GPT-6 Astra High" }],
          },
          { group: "Cognition", name: "Cognition", options: [{ value: "swe-2", name: "SWE-2" }] },
        ],
      },
    ]);
    expect(models.map((model) => model.slug)).toEqual(["gpt-6-astra-high", "swe-2"]);
    expect(models[0]?.isDefault).toBe(true);
  });

  it("returns no models without a model option", () => {
    expect(buildDevinModelsFromConfigOptions(undefined)).toEqual([]);
    expect(buildDevinModelsFromConfigOptions([])).toEqual([]);
  });
});

describe("applyDevinAcpModelSelection", () => {
  it.effect("keeps the session model for the default slug and empty input", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const runtime = {
        setModel: (model: string) => Effect.sync(() => void calls.push(model)),
      };
      for (const model of [DEVIN_DEFAULT_MODEL_SLUG, "", "  ", undefined, null]) {
        yield* applyDevinAcpModelSelection({ runtime, model, mapError: (cause) => cause });
      }
      expect(calls).toEqual([]);
      yield* applyDevinAcpModelSelection({
        runtime,
        model: " claude-opus-5-medium ",
        mapError: (cause) => cause,
      });
      expect(calls).toEqual(["claude-opus-5-medium"]);
    }),
  );
});

describe("makeDevinAcpRuntime", () => {
  it.effect("starts a session without sending ACP authenticate", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-acp-support-")),
      );
      const requestLogPath = NodePath.join(dir, "requests.ndjson");
      yield* Effect.promise(() => NodeFSP.writeFile(requestLogPath, "", "utf8"));
      // The mock rejects `authenticate`, so a start that succeeds proves the
      // runtime skipped it, mirroring Devin's browser login on every call.
      const binaryPath = writeFakeCli({
        directory: dir,
        name: "fake-devin",
        env: { T3_ACP_REQUEST_LOG_PATH: requestLogPath, T3_ACP_FAIL_AUTHENTICATION: "1" },
        source: execScriptSource({ scriptPath: mockAgentPath, expectedArgs: ["acp"] }),
      });
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const runtime = yield* makeDevinAcpRuntime({
        devinSettings: { binaryPath },
        childProcessSpawner,
        cwd: dir,
        clientInfo: { name: "t3-devin-test", version: "0.0.0" },
      });
      const started = yield* runtime.start();
      expect(started.sessionId).toBe("mock-session-1");

      const raw = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
      const methods = raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => (JSON.parse(line) as { method: string }).method);
      expect(methods).toContain("initialize");
      expect(methods).toContain("session/new");
      expect(methods).not.toContain("authenticate");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
