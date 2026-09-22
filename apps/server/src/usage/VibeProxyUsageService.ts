/**
 * Server-side Vibe-Proxy quota integration.
 *
 * The management key stays in the server secret store. Upstream auth-file
 * responses are reduced to the routing selection, quota, and request-health
 * fields defined by the wire contract before they are cached or sent to a
 * client.
 *
 * @module VibeProxyUsageService
 */
import {
  type ServerSettingsError,
  VibeProxyUsageReadError,
  VibeProxyUsageSnapshot,
  type VibeProxyUsageRefreshProblem,
  type VibeProxyUsageResult,
} from "@t3tools/contracts";
import {
  normalizeVibeProxyAuthFiles,
  resolveVibeProxyAuthFilesUrl,
} from "@t3tools/shared/vibeProxyUsage";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const SnapshotJson = Schema.fromJsonString(
  VibeProxyUsageSnapshot as unknown as Schema.Codec<VibeProxyUsageSnapshot>,
);
const decodeSnapshot = Schema.decodeUnknownEffect(SnapshotJson);
const encodeSnapshot = Schema.encodeEffect(SnapshotJson);

type FetchAttempt =
  | { readonly _tag: "Success"; readonly snapshot: VibeProxyUsageSnapshot }
  | { readonly _tag: "Failure"; readonly problem: VibeProxyUsageRefreshProblem };

const fetchFailure = (
  reason: VibeProxyUsageRefreshProblem["reason"],
  message: string,
): FetchAttempt => ({ _tag: "Failure", problem: { reason, message } });

export { normalizeVibeProxyAuthFiles } from "@t3tools/shared/vibeProxyUsage";

const result = (input: {
  readonly status: VibeProxyUsageResult["status"];
  readonly snapshot: VibeProxyUsageSnapshot | null;
  readonly refreshed?: boolean;
  readonly refreshProblem?: VibeProxyUsageRefreshProblem | null;
}): VibeProxyUsageResult => ({
  status: input.status,
  snapshot: input.snapshot,
  refreshed: input.refreshed ?? false,
  refreshProblem: input.refreshProblem ?? null,
});

export class VibeProxyUsageService extends Context.Service<
  VibeProxyUsageService,
  {
    readonly readCached: Effect.Effect<
      VibeProxyUsageResult,
      VibeProxyUsageReadError | ServerSettingsError
    >;
    readonly refresh: Effect.Effect<
      VibeProxyUsageResult,
      VibeProxyUsageReadError | ServerSettingsError
    >;
  }
>()("t3/usage/VibeProxyUsageService") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettingsService;
  const httpClient = yield* HttpClient.HttpClient;
  const cachePath = path.join(config.stateDir, "vibe-proxy-usage.json");

  const readSnapshot = fileSystem.exists(cachePath).pipe(
    Effect.mapError((cause) => new VibeProxyUsageReadError({ operation: "read-cache", cause })),
    Effect.flatMap((exists) =>
      exists
        ? fileSystem.readFileString(cachePath).pipe(
            Effect.mapError(
              (cause) => new VibeProxyUsageReadError({ operation: "read-cache", cause }),
            ),
            Effect.flatMap((raw) =>
              decodeSnapshot(raw).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("ignored invalid Vibe-Proxy usage cache", {
                    cause,
                  }).pipe(Effect.as(null)),
                ),
              ),
            ),
          )
        : Effect.succeed(null),
    ),
  );

  const writeSnapshot = (snapshot: VibeProxyUsageSnapshot) =>
    encodeSnapshot(snapshot).pipe(
      Effect.flatMap((contents) => writeFileStringAtomically({ filePath: cachePath, contents })),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new VibeProxyUsageReadError({ operation: "write-cache", cause })),
    );

  const currentStatus = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings;
    const snapshot = yield* readSnapshot;
    if (!settings.vibeProxy.enabled) {
      return { status: "disabled" as const, settings, snapshot };
    }
    if (settings.vibeProxy.baseUrl.length === 0 || settings.vibeProxy.apiKey.length === 0) {
      return { status: "unconfigured" as const, settings, snapshot };
    }
    return { status: "ready" as const, settings, snapshot };
  });

  const readCached = currentStatus.pipe(
    Effect.map(({ status, snapshot }) => result({ status, snapshot })),
  );

  const refresh = Effect.gen(function* () {
    const current = yield* currentStatus;
    if (current.status !== "ready") {
      return result({ status: current.status, snapshot: current.snapshot });
    }

    const requestUrl = resolveVibeProxyAuthFilesUrl(current.settings.vibeProxy.baseUrl);
    if (!requestUrl) {
      return result({
        status: "ready",
        snapshot: current.snapshot,
        refreshProblem: {
          reason: "invalidConfiguration",
          message: "Enter a valid HTTP or HTTPS usage API base URL.",
        },
      });
    }

    const fetchedAt = DateTime.formatIso(yield* DateTime.now);
    const attempt: FetchAttempt = yield* httpClient
      .execute(
        HttpClientRequest.get(requestUrl).pipe(
          HttpClientRequest.bearerToken(current.settings.vibeProxy.apiKey),
          HttpClientRequest.setHeader("accept", "application/json"),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT_MS),
        Effect.flatMap((response): Effect.Effect<FetchAttempt> => {
          if (response.status === 401 || response.status === 403) {
            return Effect.succeed(
              fetchFailure("unauthorized", "The usage endpoint rejected the API key."),
            );
          }
          if (response.status < 200 || response.status >= 300) {
            return Effect.succeed(
              fetchFailure("requestFailed", `The usage endpoint returned HTTP ${response.status}.`),
            );
          }
          return response.json.pipe(
            Effect.map((body) => {
              const snapshot = normalizeVibeProxyAuthFiles(body, fetchedAt);
              return snapshot
                ? ({ _tag: "Success", snapshot } satisfies FetchAttempt)
                : fetchFailure(
                    "invalidResponse",
                    "The usage endpoint returned an unsupported response.",
                  );
            }),
            Effect.catchCause(() =>
              Effect.succeed(
                fetchFailure("invalidResponse", "The usage endpoint returned invalid JSON."),
              ),
            ),
          );
        }),
        Effect.catchCause(() =>
          Effect.succeed(fetchFailure("unreachable", "Could not reach the usage endpoint.")),
        ),
      );

    if (attempt._tag === "Failure") {
      return result({
        status: "ready",
        snapshot: current.snapshot,
        refreshProblem: attempt.problem,
      });
    }

    yield* writeSnapshot(attempt.snapshot);
    return result({ status: "ready", snapshot: attempt.snapshot, refreshed: true });
  });

  return VibeProxyUsageService.of({ readCached, refresh });
});

export const layer = Layer.effect(VibeProxyUsageService, make);

export const layerTest = (
  result: VibeProxyUsageResult = {
    status: "disabled",
    snapshot: null,
    refreshed: false,
    refreshProblem: null,
  },
) =>
  Layer.succeed(
    VibeProxyUsageService,
    VibeProxyUsageService.of({
      readCached: Effect.succeed(result),
      refresh: Effect.succeed(result),
    }),
  );
