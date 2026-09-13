// @effect-diagnostics nodeBuiltinImport:off - resolves the mock ACP agent script path relative to this test file.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DevinSettings } from "@t3tools/contracts";

import { writeFakeCli } from "../../testUtils/fakeCli.ts";
import { checkDevinProviderStatus, parseDevinAuthStatusOutput } from "./DevinProvider.ts";

const decodeDevinSettings = Schema.decodeSync(DevinSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

// `devin auth status` on devin 3000.10.21.
const LOGGED_IN_OUTPUT = [
  "Logged in (via Devin).",
  "",
  "Credentials:",
  "  File:              /Users/me/.local/share/devin/credentials.toml",
  "",
  "User:",
  "  Name:              Some User",
  "  Email:             someone@example.com",
  "",
  "Account:",
  "  Tier:              Devin Free",
  "  Plan:              Free",
  "",
].join("\n");

describe("parseDevinAuthStatusOutput", () => {
  it("reads the login verdict, email, and tier", () => {
    expect(parseDevinAuthStatusOutput(LOGGED_IN_OUTPUT)).toEqual({
      authenticated: true,
      email: "someone@example.com",
      plan: "Devin Free",
    });
  });

  it("detects a logged-out CLI and unknown output", () => {
    expect(parseDevinAuthStatusOutput("Not logged in. Run `devin auth login`.").authenticated).toBe(
      false,
    );
    expect(parseDevinAuthStatusOutput("devin 3000.10.21\n").authenticated).toBeNull();
  });
});

/**
 * A fake `devin` that answers the CLI probes from environment variables and
 * hands `acp` over to the shared mock ACP agent.
 */
function writeFakeDevin(directory: string, env: Record<string, string>): string {
  return writeFakeCli({
    directory,
    name: "fake-devin",
    env,
    source: [
      'import { pathToFileURL } from "node:url";',
      "const args = process.argv.slice(2);",
      'if (args[0] === "--version") {',
      '  process.stdout.write("devin 3000.10.21 (611c1cba)\\n");',
      "  process.exit(0);",
      "}",
      'if (args[0] === "auth") {',
      '  process.stdout.write(process.env.T3_FAKE_DEVIN_AUTH_OUTPUT ?? "");',
      '  process.exit(Number(process.env.T3_FAKE_DEVIN_AUTH_EXIT ?? "0"));',
      "}",
      `await import(pathToFileURL(${JSON.stringify(mockAgentPath)}).href);`,
    ].join("\n"),
  });
}

describe("checkDevinProviderStatus", () => {
  it.effect("reports a missing binary as not installed", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkDevinProviderStatus(
        decodeDevinSettings({ enabled: true, binaryPath: "/definitely/missing/devin" }),
        process.env,
      );
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["devin-default"]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("stops at a logged-out CLI without opening an ACP session", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-provider-")),
      );
      const binaryPath = writeFakeDevin(dir, {
        T3_FAKE_DEVIN_AUTH_OUTPUT: "Not logged in. Run `devin auth login` to sign in.\n",
        T3_FAKE_DEVIN_AUTH_EXIT: "1",
      });
      const snapshot = yield* checkDevinProviderStatus(
        decodeDevinSettings({ enabled: true, binaryPath }),
        process.env,
        dir,
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBe("3000.10.21");
      expect(snapshot.status).toBe("error");
      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.message).toContain("devin auth login");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reads the model catalog from the ACP session config options", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "devin-provider-")),
      );
      const binaryPath = writeFakeDevin(dir, { T3_FAKE_DEVIN_AUTH_OUTPUT: LOGGED_IN_OUTPUT });
      const snapshot = yield* checkDevinProviderStatus(
        decodeDevinSettings({ enabled: true, binaryPath }),
        process.env,
        dir,
      );
      expect(snapshot.installed).toBe(true);
      expect(snapshot.auth).toEqual({
        status: "authenticated",
        type: "cached_token",
        label: "Devin Free",
        email: "someone@example.com",
      });
      expect(snapshot.status).toBe("ready");
      // Discovered models replace the `devin-default` fallback entirely.
      expect(snapshot.models.length).toBeGreaterThan(0);
      expect(snapshot.models.some((model) => model.slug === "devin-default")).toBe(false);
      expect(snapshot.models.filter((model) => model.isDefault).length).toBe(1);
      expect(snapshot.slashCommands.map((command) => command.name)).toContain("compact");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
