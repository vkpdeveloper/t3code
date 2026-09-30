import type {
  EnvironmentConnectionPhase,
  EnvironmentPresentation,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";

export type DockMachineStatus = "online" | "connecting" | "offline";

export interface DockMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: DockMachineStatus;
}

/**
 * A dock is read from across the room, so anything short of connected that is
 * not a first attempt reads as offline: a dropped machine retrying in the
 * background is exactly the "something is wrong" case.
 */
export function dockMachineStatus(phase: EnvironmentConnectionPhase): DockMachineStatus {
  switch (phase) {
    case "connected":
      return "online";
    case "connecting":
      return "connecting";
    case "available":
    case "offline":
    case "reconnecting":
    case "error":
    case "unsupported":
      return "offline";
  }
}

/** Enabled paired machines, labelled like the rest of the app, in label order. */
export function dockMachines(
  presentations: ReadonlyMap<EnvironmentId, EnvironmentPresentation>,
): ReadonlyArray<DockMachine> {
  const machines: DockMachine[] = [];
  for (const [environmentId, presentation] of presentations) {
    if (!presentation.entry.enabled) continue;
    const profile = presentation.entry.profile;
    const reported = profile._tag === "Some" ? profile.value.reportedLabel : undefined;
    machines.push({
      environmentId,
      label: presentation.entry.target.label.trim() || reported?.trim() || "Environment",
      status: dockMachineStatus(presentation.connection.phase),
    });
  }
  return machines.sort((left, right) => left.label.localeCompare(right.label));
}
