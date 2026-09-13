// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  DevinSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { DevinAdapterShape } from "../Services/DevinAdapter.ts";
import { makeDevinAdapter } from "./DevinAdapter.ts";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);

class DevinAdapter extends Context.Service<DevinAdapter, DevinAdapterShape>()(
  "t3/provider/Layers/DevinAdapter.test/DevinAdapter",
) {}

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeMockDevin(requestLogPath?: string) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-acp-mock-"));
  return writeFakeCli({
    directory: dir,
    name: "fake-devin",
    env: requestLogPath ? { T3_ACP_REQUEST_LOG_PATH: requestLogPath } : {},
    source: execScriptSource({ scriptPath: mockAgentPath, expectedArgs: ["acp"] }),
  });
}

async function readRequestLog(filePath: string) {
  const raw = await NodeFSP.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { method: string; params?: Record<string, unknown> });
}

function findModeRequests(requests: Awaited<ReturnType<typeof readRequestLog>>) {
  return requests
    .filter(
      (entry) =>
        entry.method === "session/set_mode" ||
        (entry.method === "session/set_config_option" && entry.params?.configId === "mode"),
    )
    .map((entry) => String(entry.params?.modeId ?? entry.params?.value));
}

const devinAdapterTestLayer = it.layer(
  Layer.effect(
    DevinAdapter,
    Effect.gen(function* () {
      const binaryPath = yield* Effect.promise(() => makeMockDevin());
      return yield* makeDevinAdapter(decodeDevinSettings({ enabled: true, binaryPath }));
    }),
  ).pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3code-devin-adapter-test-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

devinAdapterTestLayer("DevinAdapterLive", (it) => {
  it.effect("starts a session and maps the mock ACP prompt flow to runtime events", () =>
    Effect.gen(function* () {
      const adapter = yield* DevinAdapter;
      const threadId = ThreadId.make("devin-mock-thread");

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 9).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("devin"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: ProviderInstanceId.make("devin"), model: "devin-default" },
      });
      assert.equal(session.provider, "devin");
      assert.deepStrictEqual(session.resumeCursor, {
        schemaVersion: 1,
        sessionId: "mock-session-1",
      });

      const turn = yield* adapter.sendTurn({ threadId, input: "hello mock", attachments: [] });
      assert.equal(turn.threadId, threadId);

      const types = Array.from(yield* Fiber.join(runtimeEventsFiber)).map((event) => event.type);
      for (const expected of [
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "item.started",
        "content.delta",
        "item.completed",
        "turn.completed",
      ] as const) {
        assert.include(types, expected);
      }

      yield* adapter.stopSession(threadId);
      assert.isFalse(yield* adapter.hasSession(threadId));
    }),
  );

  it.effect("rejects a session start for another provider", () =>
    Effect.gen(function* () {
      const adapter = yield* DevinAdapter;
      const exit = yield* Effect.exit(
        adapter.startSession({
          threadId: ThreadId.make("devin-wrong-provider"),
          provider: ProviderDriverKind.make("cursor"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        }),
      );
      assert.isTrue(exit._tag === "Failure");
    }),
  );
});

it.effect("selects a code mode for Approval Required and the plan mode for planning", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-adapter-modes-")),
    );
    const requestLogPath = NodePath.join(dir, "requests.ndjson");
    yield* Effect.promise(() => NodeFSP.writeFile(requestLogPath, "", "utf8"));
    const binaryPath = yield* Effect.promise(() => makeMockDevin(requestLogPath));
    const adapter = yield* makeDevinAdapter(decodeDevinSettings({ enabled: true, binaryPath }));
    const threadId = ThreadId.make("devin-mode-thread");

    // The mock advertises ask / architect / code. Approval Required must land on
    // "code", never on the read-only "ask" the generic resolver would choose.
    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("devin"),
      cwd: dir,
      runtimeMode: "approval-required",
    });
    yield* adapter.sendTurn({ threadId, input: "implement", attachments: [] });
    yield* adapter.sendTurn({
      threadId,
      input: "plan it",
      attachments: [],
      interactionMode: "plan",
    });
    yield* adapter.stopSession(threadId);

    const modeIds = findModeRequests(yield* Effect.promise(() => readRequestLog(requestLogPath)));
    assert.include(modeIds, "code");
    assert.include(modeIds, "architect");
    assert.notInclude(modeIds, "ask");
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        ServerSettingsService.layerTest(),
        ServerConfig.layerTest(process.cwd(), { prefix: "t3code-devin-adapter-modes-" }),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  ),
);
