import { makeAmpTextGeneration } from "../../textGeneration/AmpTextGeneration.ts";
import { makeAmpRouting } from "../amp/AmpRouting.ts";
import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AmpSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeAmpAdapter } from "../Layers/AmpAdapter.ts";
import {
  buildInitialAmpProviderSnapshot,
  checkAmpProviderStatus,
  discoverAmpSkills,
} from "../Layers/AmpProvider.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { defaultProviderContinuationIdentity, type ProviderDriver } from "../ProviderDriver.ts";
import { withInstanceIdentity } from "./instanceIdentity.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import { ProviderDriverError } from "../Errors.ts";

const decodeSettings = Schema.decodeSync(AmpSettings);
const driverKind = ProviderDriverKind.make("amp");
export type AmpDriverEnv =
  | ServerConfig
  | ServerSettingsService
  | BackgroundPolicy.BackgroundPolicy
  | Path.Path
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner;
export const AmpDriver: ProviderDriver<AmpSettings, AmpDriverEnv> = {
  driverKind,
  metadata: { displayName: "Amp", supportsMultipleInstances: true },
  configSchema: AmpSettings,
  defaultConfig: () => decodeSettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const effectiveConfig = { ...config, enabled };
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({ driverKind, instanceId });
      const stamp = withInstanceIdentity({
        instanceId,
        driverKind,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const routing = makeAmpRouting(effectiveConfig, processEnv);
      const ampRouting = {
        read: (workspace: boolean) =>
          routing
            .read(workspace)
            .pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        act: (workspace: boolean, operation: import("@t3tools/contracts").AmpRoutingAction) =>
          routing
            .act(workspace, operation)
            .pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
      };
      const adapter = yield* makeAmpAdapter(effectiveConfig, processEnv, instanceId);
      const snapshot = yield* makeManagedServerProvider({
        resolveMaintenance: () =>
          Effect.succeed(
            makeManualOnlyProviderMaintenanceCapabilities({
              provider: driverKind,
              packageName: null,
            }),
          ),
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.empty,
        haveSettingsChanged: () => false,
        initialSnapshot: () =>
          buildInitialAmpProviderSnapshot(effectiveConfig).pipe(Effect.map(stamp)),
        checkProvider: checkAmpProviderStatus(effectiveConfig, processEnv).pipe(
          Effect.map(stamp),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: driverKind,
              instanceId,
              detail: "Could not initialize Amp",
              cause,
            }),
        ),
      );
      const snapshotForCwd = (cwd: string) =>
        !enabled
          ? snapshot.getSnapshot
          : Effect.all([
              snapshot.getSnapshot,
              discoverAmpSkills(effectiveConfig, processEnv, cwd).pipe(
                Effect.provideService(Path.Path, path),
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
              ),
            ]).pipe(
              Effect.map(([current, skills]) => ({ ...current, skills })),
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: driverKind,
                    instanceId,
                    detail: "Could not discover Amp skills",
                    cause,
                  }),
              ),
            );
      return {
        instanceId,
        driverKind,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        snapshotForCwd,
        adapter,
        ampRouting,
        textGeneration: makeAmpTextGeneration(effectiveConfig, processEnv),
      };
    }),
};
