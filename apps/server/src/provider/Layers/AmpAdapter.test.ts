// @effect-diagnostics nodeBuiltinImport:off - tests the native stream-json boundary.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import {
  AmpSettings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import { makeAmpAdapter } from "./AmpAdapter.ts";

const decodeSettings = Schema.decodeEffect(AmpSettings);
it.effect("completes on EOF, resumes native threads, and interrupts a waiting turn", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.tryPromise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "amp-adapter-test-")),
    );
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
    );
    const binaryPath = NodePath.join(directory, "amp");
    yield* Effect.tryPromise(() =>
      NodeFSP.writeFile(
        binaryPath,
        `#!/usr/bin/env node
const args=process.argv.slice(2);
const session_id=args[0]==='threads'?args[2]:'T-adapter-fixture';
const emit=v=>process.stdout.write(JSON.stringify({session_id,...v})+'\\n');
emit({type:'system',subtype:'init'});
process.stdin.on('data',chunk=>{
 const input=JSON.parse(String(chunk));
 if(input.message.content[0].text.endsWith('wait')) return;
 emit({type:'assistant',message:{content:[{type:'thinking',thinking:'Checking fixture.'},{type:'text',text:args[0]==='threads'?'resumed':'first'}],usage:{input_tokens:3,output_tokens:2,cache_read_input_tokens:1},stop_reason:'end_turn'}});
});
process.stdin.on('end',()=>emit({type:'result',is_error:false}));
`,
        { mode: 0o700 },
      ),
    );
    yield* Effect.gen(function* () {
      const adapter = yield* makeAmpAdapter(
        yield* decodeSettings({ binaryPath }),
        process.env,
        ProviderInstanceId.make("amp"),
      );
      const received = yield* Queue.unbounded<ProviderRuntimeEvent>();
      yield* adapter.streamEvents.pipe(
        Stream.runForEach((event) => Queue.offer(received, event)),
        Effect.forkScoped,
      );
      const threadId = ThreadId.make("amp-test");
      yield* adapter.startSession({ threadId, cwd: directory, runtimeMode: "approval-required" });
      const complete = Effect.gen(function* () {
        const events: ProviderRuntimeEvent[] = [];
        while (true) {
          const event = yield* Queue.take(received);
          events.push(event);
          if (event.type === "turn.completed") return { events, event };
        }
      });
      yield* adapter.sendTurn({ threadId, input: "first" });
      const first = yield* complete;
      expect(first.event.payload.state).toBe("completed");
      expect(first.event.payload.tokenUsage).toMatchObject({
        inputTokens: 4,
        outputTokens: 2,
        cachedInputTokens: 1,
      });
      expect(
        first.events.some(
          (event) =>
            event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
        ),
      ).toBe(true);
      yield* adapter.sendTurn({ threadId, input: "second" });
      const second = yield* complete;
      expect(
        second.events.some(
          (event) => event.type === "content.delta" && event.payload.delta === "resumed",
        ),
      ).toBe(true);
      yield* adapter.sendTurn({ threadId, input: "wait" });
      yield* adapter.interruptTurn(threadId);
      expect((yield* complete).event.payload.state).toBe("interrupted");
      expect((yield* adapter.listSessions())[0]?.resumeCursor).toEqual({
        sessionId: "T-adapter-fixture",
      });
      yield* adapter.stopSession(threadId);
      expect(yield* adapter.hasSession(threadId)).toBe(false);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.layerTest(directory, { prefix: "amp-test-config-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.scoped),
);
