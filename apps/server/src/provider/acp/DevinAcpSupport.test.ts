// @effect-diagnostics nodeBuiltinImport:off - resolves the mock ACP agent script path relative to this test file.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/process";

import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import {
  buildDevinAcpSpawnInput,
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
    expect(buildDevinAcpSpawnInput(undefined, "/repo", undefined, "fusion-opus-swe").args).toEqual([
      "acp",
      "--model",
      "fusion-opus-swe",
    ]);
    expect(buildDevinAcpSpawnInput(undefined, "/repo", undefined, "devin-default").args).toEqual([
      "acp",
    ]);
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
