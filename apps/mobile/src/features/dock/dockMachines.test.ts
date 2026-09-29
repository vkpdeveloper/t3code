import { describe, expect, it } from "@effect/vitest";
import type {
  EnvironmentConnectionPhase,
  EnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { dockMachines } from "./dockMachines";

function presentation(input: {
  readonly label: string;
  readonly reportedLabel?: string;
  readonly phase: EnvironmentConnectionPhase;
  readonly enabled?: boolean;
}): EnvironmentPresentation {
  return {
    entry: {
      enabled: input.enabled ?? true,
      target: { label: input.label },
      profile:
        input.reportedLabel === undefined
          ? Option.none()
          : Option.some({ reportedLabel: input.reportedLabel }),
    },
    connection: { phase: input.phase, error: null, traceId: null },
    serverConfig: null,
  } as unknown as EnvironmentPresentation;
}

describe("dockMachines", () => {
  it("lists enabled machines by label and flags anything not connected", () => {
    const machines = dockMachines(
      new Map([
        ["env-3" as EnvironmentId, presentation({ label: "msi", phase: "reconnecting" })],
        ["env-1" as EnvironmentId, presentation({ label: "macair", phase: "connected" })],
        ["env-2" as EnvironmentId, presentation({ label: "dell", phase: "connecting" })],
        ["env-4" as EnvironmentId, presentation({ label: "nord", phase: "error" })],
        [
          "env-5" as EnvironmentId,
          presentation({ label: "paused", phase: "available", enabled: false }),
        ],
      ]),
    );

    expect(machines.map((machine) => [machine.label, machine.status])).toEqual([
      ["dell", "connecting"],
      ["macair", "online"],
      ["msi", "offline"],
      ["nord", "offline"],
    ]);
  });

  it("falls back to the server's reported name", () => {
    const [machine] = dockMachines(
      new Map([
        [
          "env-1" as EnvironmentId,
          presentation({ label: " ", reportedLabel: "archv", phase: "offline" }),
        ],
      ]),
    );
    expect(machine).toMatchObject({ label: "archv", status: "offline" });
  });
});
