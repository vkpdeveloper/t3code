// @effect-diagnostics nodeBuiltinImport:off - owns the native JSONL process and HTTP permission delegate.
// @effect-diagnostics globalTimers:off - bounded native process termination after SIGTERM.
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeHttp from "node:http";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";

import * as Schema from "effect/Schema";
import type { AmpSettings, RuntimeMode } from "@t3tools/contracts";
import { decodeAmpMessage, type AmpMessage } from "./AmpProtocol.ts";

const Settings = Schema.Record(Schema.String, Schema.Unknown);
const Approval = Schema.Struct({ tool: Schema.String, input: Schema.Unknown });
const decodeApproval = Schema.decodeUnknownSync(Schema.fromJsonString(Approval));
const decodeSettings = Schema.decodeUnknownSync(Schema.fromJsonString(Settings));
const quote = (value: string) =>
  HostProcessPlatform.defaultValue() === "win32"
    ? `"${value.replaceAll('"', '\\"')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;

export interface AmpProcess {
  send: (content: ReadonlyArray<unknown>, steer?: boolean) => void;
  endInput: () => void;
  approve: (id: string, allowed: boolean) => boolean;
  close: () => Promise<void>;
  readonly exited: Promise<void>;
}

/** Owns one CLI process and its delegate listener. No live Amp settings are modified. */
export async function startAmpProcess(input: {
  settings: AmpSettings;
  environment: NodeJS.ProcessEnv;
  cwd: string;
  mode: string;
  runtimeMode: RuntimeMode;
  resumeId?: string;
  title?: string;
  fast?: boolean | undefined;
  pro?: boolean | undefined;
  thinking?: boolean | undefined;
  visibility?: string | undefined;
  mcpConfig?: unknown;
  onMessage: (message: AmpMessage) => void;
  onApproval: (id: string, tool: string, args: unknown) => void;
  onExit: (error?: string) => void;
}): Promise<AmpProcess> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-amp-"));
  const token = NodeCrypto.randomBytes(32).toString("hex");
  const pending = new Map<string, NodeHttp.ServerResponse>();
  let child: NodeChildProcess.ChildProcessWithoutNullStreams | undefined;
  let closing = false;
  const server = NodeHttp.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== `/${token}`) {
      response.writeHead(404).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 1024 * 1024) throw new Error("Approval input too large");
      }
      const approval = decodeApproval(body);
      const id = NodeCrypto.randomUUID();
      pending.set(id, response);
      response.on("close", () => pending.delete(id));
      input.onApproval(id, approval.tool, approval.input);
    } catch {
      response.writeHead(400).end();
    }
  });
  const cleanup = async () => {
    for (const response of pending.values()) response.writeHead(403).end();
    pending.clear();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await NodeFSP.rm(directory, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No approval listener");
    const bridge = NodePath.join(directory, "approve.cjs");
    await NodeFSP.writeFile(
      bridge,
      `const http = require('node:http');\nlet input='';\nprocess.stdin.on('data', c => input += c);\nprocess.stdin.on('end', () => {\n const req=http.request(${JSON.stringify(`http://127.0.0.1:${address.port}/${token}`)}, {method:'POST'}, res => {res.resume(); res.on('end',()=>process.exit(res.statusCode===200?0:1));});\n req.on('error',()=>process.exit(1));\n try {req.end(JSON.stringify({tool:process.env.AGENT_TOOL_NAME,input:JSON.parse(input)}));} catch {process.exit(1);}\n});\n`,
      { mode: 0o600 },
    );
    const baseSettingsPath =
      input.settings.settingsFile ||
      input.environment.AMP_SETTINGS_FILE ||
      NodePath.join(
        input.environment.XDG_CONFIG_HOME ||
          NodePath.join(input.environment.HOME || NodeOS.homedir(), ".config"),
        "amp/settings.json",
      );
    let baseSettings: Record<string, unknown> = {};
    try {
      baseSettings = decodeSettings(await NodeFSP.readFile(baseSettingsPath, "utf8"));
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT" &&
          !input.settings.settingsFile
        )
      )
        throw error;
    }
    const settingsPath = NodePath.join(directory, "settings.json");
    const delegate = NodePath.join(
      directory,
      HostProcessPlatform.defaultValue() === "win32" ? "approve.cmd" : "approve",
    );
    await NodeFSP.writeFile(
      delegate,
      HostProcessPlatform.defaultValue() === "win32"
        ? `@echo off\r\n${quote(process.execPath)} ${quote(bridge)}\r\nexit /b %errorlevel%\r\n`
        : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(bridge)}\n`,
      { mode: 0o700 },
    );
    const rules =
      input.runtimeMode === "auto-accept-edits"
        ? [
            { tool: "apply_patch", action: "allow" },
            { tool: "edit_file", action: "allow" },
            { tool: "create_file", action: "allow" },
            { tool: "*", action: "delegate", to: delegate },
          ]
        : [{ tool: "*", action: "delegate", to: delegate }];
    await NodeFSP.writeFile(
      settingsPath,
      JSON.stringify({
        ...baseSettings,
        "amp.dangerouslyAllowAll": input.runtimeMode === "full-access",
        "amp.permissions": rules,
        "amp.git.commit.coauthor.enabled": false,
        "amp.updates.mode": "disabled",
      }),
      { mode: 0o600 },
    );
    const args = [
      ...(input.resumeId ? ["threads", "continue", input.resumeId] : []),
      "-x",
      "--stream-json",
      "--stream-json-input",
      "--no-archive-after-execute",
      "--no-ide",
      "--no-notifications",
      "--no-color",
      "--settings-file",
      settingsPath,
      "--mode",
      input.mode,
      "--label",
      "t3code",
      ...(input.thinking ? ["--stream-json-thinking"] : []),
      ...(input.fast ? ["--features", "fast"] : []),
      ...(input.pro ? ["--features", "pro"] : []),
      ...(input.visibility ? ["--visibility", input.visibility] : []),
      ...(!input.resumeId && input.title ? ["--title", input.title] : []),
      ...(input.mcpConfig ? ["--mcp-config", JSON.stringify(input.mcpConfig)] : []),
    ];
    child = NodeChildProcess.spawn(input.settings.binaryPath || "amp", args, {
      cwd: input.cwd,
      env: { ...input.environment, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "pipe",
      detached: HostProcessPlatform.defaultValue() !== "win32",
    });
    const ownedChild = child;
    const signalOwnedProcess = (signal: NodeJS.Signals) => {
      if (HostProcessPlatform.defaultValue() === "win32") {
        ownedChild.kill(signal);
        return;
      }
      if (!ownedChild.pid) return;
      try {
        process.kill(-ownedChild.pid, signal);
      } catch {
        /* The owned process group already exited. */
      }
    };
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      signalOwnedProcess("SIGTERM");
      terminationTimer ??= setTimeout(() => signalOwnedProcess("SIGKILL"), 3000);
    };
    let buffer = "";
    let protocolError: string | undefined;
    ownedChild.stdout.setEncoding("utf8");
    ownedChild.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 16 * 1024 * 1024) {
        protocolError = "Amp output exceeded the JSON message limit.";
        terminate();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          input.onMessage(decodeAmpMessage(line));
        } catch {
          protocolError = "Amp returned an invalid stream-json message.";
          terminate();
          break;
        }
      }
    });
    // Native stderr can contain account details. Drain it without logging it.
    ownedChild.stderr.resume();
    ownedChild.stdin.on("error", () => {});
    const exited = new Promise<void>((resolve) => {
      ownedChild.once("error", () => {
        protocolError = "Unable to start Amp CLI.";
      });
      ownedChild.once("close", (code) => {
        input.onExit(
          closing
            ? undefined
            : protocolError || (code !== 0 ? `Amp exited with code ${code}.` : undefined),
        );
        if (terminationTimer) clearTimeout(terminationTimer);
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      ownedChild.once("spawn", resolve);
      ownedChild.once("error", reject);
    });
    return {
      send: (content, steer = false) => {
        ownedChild.stdin.write(
          JSON.stringify({ type: "user", steer, message: { role: "user", content } }) + "\n",
        );
      },
      endInput: () => ownedChild.stdin.end(),
      approve: (id, allowed) => {
        const response = pending.get(id);
        if (!response) return false;
        pending.delete(id);
        response.writeHead(allowed ? 200 : 403).end();
        return true;
      },
      exited,
      close: async () => {
        closing = true;
        terminate();
        await exited;
        if (terminationTimer) clearTimeout(terminationTimer);
        signalOwnedProcess("SIGKILL");
        await cleanup();
      },
    };
  } catch (error) {
    child?.kill("SIGTERM");
    await cleanup();
    throw error;
  }
}
