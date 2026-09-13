// @effect-diagnostics nodeBuiltinImport:off - exercises a real subprocess and HTTP delegate.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";

import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { AmpSettings } from "@t3tools/contracts";
import { startAmpProcess } from "./AmpProcess.ts";
import { decodeAmpMessage } from "./AmpProtocol.ts";
import { ampRoutingArgs } from "./AmpRouting.ts";

const decodeSettings = Schema.decodeSync(AmpSettings);
const fake = `#!/usr/bin/env node
const {readFileSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
const settings=JSON.parse(readFileSync(args[args.indexOf('--settings-file')+1],'utf8'));
const session_id=args[0]==='threads'?args[2]:'T-fixture';
const emit=v=>process.stdout.write(JSON.stringify({session_id,...v})+'\\n');
emit({type:'system',subtype:'init'});
let body='';
process.stdin.on('data',chunk=>{body+=chunk;let newline;while((newline=body.indexOf('\\n'))>=0){
 const input=JSON.parse(body.slice(0,newline));body=body.slice(newline+1);
 if(input.message.content[0].text==='approval'){
  const rule=settings['amp.permissions'].find(r=>r.action==='delegate');
  const result=spawnSync(rule.to,{input:JSON.stringify({command:'echo fixture'}),env:{...process.env,AGENT_TOOL_NAME:'shell_command'}});
  emit({type:'assistant',message:{content:[{type:'text',text:result.status===0?'ALLOWED':'DENIED'}],stop_reason:'end_turn'}});
 } else emit({type:'assistant',message:{content:[{type:'text',text:input.message.content[0].text}],stop_reason:'end_turn'}});
}});
process.stdin.on('end',()=>{emit({type:'result',subtype:'success',is_error:false});});
`;

describe("Amp stream-json process", () => {
  it.each([true, false])("round-trips a delegate decision: %s", async (allowed) => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-amp-test-"));
    const binaryPath = NodePath.join(directory, "amp");
    await NodeFSP.writeFile(binaryPath, fake);
    await NodeFSP.chmod(binaryPath, 0o700);
    const originalPath = NodePath.join(directory, "original.json");
    const original = '{"amp.showCosts":false}';
    await NodeFSP.writeFile(originalPath, original);
    const output: string[] = [];
    const done = Promise.withResolvers<void>();
    let process: Awaited<ReturnType<typeof startAmpProcess>>;
    try {
      process = await startAmpProcess({
        settings: decodeSettings({ binaryPath, settingsFile: originalPath }),
        environment: globalThis.process.env,
        cwd: directory,
        mode: "medium",
        runtimeMode: "approval-required",
        onApproval: (id, tool, args) => {
          expect(tool).toBe("shell_command");
          expect(args).toEqual({ command: "echo fixture" });
          process.approve(id, allowed);
        },
        onMessage: (message) => {
          for (const block of message.message?.content ?? [])
            if (block.type === "text") output.push(block.text);
          if (message.message?.stop_reason === "end_turn") process.endInput();
          if (message.type === "result") done.resolve();
        },
        onExit: (error) => {
          if (error) done.reject(new Error(error));
        },
      });
      process.send([{ type: "text", text: "approval" }]);
      await done.promise;
      await process.exited;
      await process.close();
      expect(output).toEqual([allowed ? "ALLOWED" : "DENIED"]);
      expect(await NodeFSP.readFile(originalPath, "utf8")).toBe(original);
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects malformed protocol messages", () => {
    expect(() =>
      decodeAmpMessage(
        '{"type":"assistant","session_id":"T-x","message":{"content":[{"type":"text","text":3}]}}',
      ),
    ).toThrow();
  });
  it("preserves model mapping on rename and clears only when requested", () => {
    expect(ampRoutingArgs(false, { action: "edit", id: "key-1", name: "Renamed" })).toEqual([
      "config",
      "model-providers",
      "edit-key",
      "key-1",
      "--name",
      "Renamed",
    ]);
    expect(
      ampRoutingArgs(false, { action: "edit", id: "key-1", name: "Renamed", modelMapping: "" }),
    ).toContain("--clear-model-mapping");
  });
  it("places scope and credentials in explicit CLI arguments", () => {
    expect(
      ampRoutingArgs(true, {
        action: "add-router",
        router: "openrouter",
        name: "Work",
        modelMapping: "openai/*",
        apiKeyEnvironmentVariable: "WORK_KEY",
        active: false,
      }),
    ).toEqual([
      "config",
      "model-providers",
      "add-router",
      "openrouter",
      "--workspace",
      "--name",
      "Work",
      "--model-mapping",
      "openai/*",
      "--api-key-env",
      "WORK_KEY",
      "--no-active",
    ]);
  });
});
