import {
  VibeProxyUsageSnapshot as VibeProxyUsageSnapshotSchema,
  type VibeProxySettings,
  type VibeProxyUsageRefreshProblem,
  type VibeProxyUsageResult,
  type VibeProxyUsageSnapshot,
} from "@t3tools/contracts";
import {
  normalizeVibeProxyAuthFiles,
  resolveVibeProxyAuthFilesUrl,
} from "@t3tools/shared/vibeProxyUsage";
import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";

import { writeFileAtomically } from "../lib/atomic-file";

const STORAGE_KEY = "t3code.vibe-proxy.usage.v1";
const STORAGE_VERSION = 1;
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_DIRECTORY = "vibe-proxy";
const CACHE_FILE = "usage.json";

const StoredSettingsSchema = Schema.Struct({
  enabled: Schema.Boolean,
  baseUrl: Schema.String,
  apiKey: Schema.String,
});

const StoredDocumentSchema = Schema.Struct({
  version: Schema.Literal(STORAGE_VERSION),
  settings: StoredSettingsSchema,
});

type StoredSettingsDocument = typeof StoredDocumentSchema.Type;

interface StoredDocument extends StoredSettingsDocument {
  readonly snapshot: VibeProxyUsageSnapshot | null;
}

const decodeStoredDocument = Schema.decodeUnknownSync(StoredDocumentSchema);
const decodeSnapshot = Schema.decodeUnknownSync(VibeProxyUsageSnapshotSchema);

const DEFAULT_SETTINGS_DOCUMENT: StoredSettingsDocument = {
  version: STORAGE_VERSION,
  settings: { enabled: false, baseUrl: "", apiKey: "" },
};

export type VibeProxySettingsPatch = Partial<
  Pick<VibeProxySettings, "enabled" | "baseUrl" | "apiKey">
>;

export interface MobileVibeProxyUsageState {
  readonly settings: VibeProxySettings;
  readonly result: VibeProxyUsageResult;
}

export interface VibeProxyUsageClientDependencies {
  readonly storage?: Pick<typeof SecureStore, "getItemAsync" | "setItemAsync">;
  readonly cache?: VibeProxyUsageCache;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface VibeProxyUsageCache {
  readonly read: () => Promise<string | null>;
  readonly write: (contents: string) => Promise<void>;
  readonly clear: () => Promise<void>;
}

function publicSettings(settings: StoredDocument["settings"]): VibeProxySettings {
  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    apiKey: "",
    apiKeyRedacted: settings.apiKey.length > 0,
  };
}

function resultForDocument(document: StoredDocument): VibeProxyUsageResult {
  const status = !document.settings.enabled
    ? "disabled"
    : document.settings.baseUrl.length === 0 || document.settings.apiKey.length === 0
      ? "unconfigured"
      : "ready";
  return {
    status,
    snapshot: document.snapshot,
    refreshed: false,
    refreshProblem: null,
  };
}

async function snapshotFile() {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.cache, CACHE_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, CACHE_FILE);
}

const fileCache: VibeProxyUsageCache = {
  read: async () => {
    const file = await snapshotFile();
    return file.exists ? file.text() : null;
  },
  write: async (contents) => writeFileAtomically(await snapshotFile(), contents),
  clear: async () => {
    const file = await snapshotFile();
    if (file.exists) file.delete();
  },
};

async function loadDocument(
  storage: Pick<typeof SecureStore, "getItemAsync">,
  cache: VibeProxyUsageCache,
): Promise<StoredDocument> {
  const [encodedSettings, encodedSnapshot] = await Promise.all([
    storage.getItemAsync(STORAGE_KEY),
    cache.read(),
  ]);
  const stored =
    encodedSettings === null
      ? DEFAULT_SETTINGS_DOCUMENT
      : decodeStoredDocument(JSON.parse(encodedSettings) as unknown);
  let snapshot: StoredDocument["snapshot"] = null;
  if (encodedSnapshot !== null) {
    try {
      snapshot = decodeSnapshot(JSON.parse(encodedSnapshot) as unknown);
    } catch {
      await cache.clear();
    }
  }
  return { ...stored, snapshot };
}

async function saveSettings(
  storage: Pick<typeof SecureStore, "setItemAsync">,
  document: StoredSettingsDocument,
): Promise<void> {
  await storage.setItemAsync(STORAGE_KEY, JSON.stringify(document));
}

function refreshFailure(
  document: StoredDocument,
  reason: VibeProxyUsageRefreshProblem["reason"],
  message: string,
): MobileVibeProxyUsageState {
  return {
    settings: publicSettings(document.settings),
    result: {
      status: "ready",
      snapshot: document.snapshot,
      refreshed: false,
      refreshProblem: { reason, message },
    },
  };
}

export async function readMobileVibeProxyUsage(
  dependencies: VibeProxyUsageClientDependencies = {},
): Promise<MobileVibeProxyUsageState> {
  const document = await loadDocument(
    dependencies.storage ?? SecureStore,
    dependencies.cache ?? fileCache,
  );
  return { settings: publicSettings(document.settings), result: resultForDocument(document) };
}

export async function updateMobileVibeProxySettings(
  patch: VibeProxySettingsPatch,
  dependencies: VibeProxyUsageClientDependencies = {},
): Promise<MobileVibeProxyUsageState> {
  const storage = dependencies.storage ?? SecureStore;
  const cache = dependencies.cache ?? fileCache;
  const current = await loadDocument(storage, cache);
  const settings = {
    enabled: patch.enabled ?? current.settings.enabled,
    baseUrl: patch.baseUrl?.trim() ?? current.settings.baseUrl,
    apiKey: patch.apiKey === undefined ? current.settings.apiKey : patch.apiKey.trim(),
  };
  const configurationChanged =
    settings.baseUrl !== current.settings.baseUrl || settings.apiKey !== current.settings.apiKey;
  const next: StoredDocument = {
    version: STORAGE_VERSION,
    settings,
    snapshot: configurationChanged ? null : current.snapshot,
  };
  await saveSettings(storage, { version: next.version, settings: next.settings });
  if (configurationChanged) await cache.clear();
  return { settings: publicSettings(next.settings), result: resultForDocument(next) };
}

export async function refreshMobileVibeProxyUsage(
  dependencies: VibeProxyUsageClientDependencies = {},
): Promise<MobileVibeProxyUsageState> {
  const storage = dependencies.storage ?? SecureStore;
  const cache = dependencies.cache ?? fileCache;
  const document = await loadDocument(storage, cache);
  const currentResult = resultForDocument(document);
  if (currentResult.status !== "ready") {
    return { settings: publicSettings(document.settings), result: currentResult };
  }

  const requestUrl = resolveVibeProxyAuthFilesUrl(document.settings.baseUrl);
  if (requestUrl === null) {
    return refreshFailure(
      document,
      "invalidConfiguration",
      "Enter a valid HTTP or HTTPS usage API base URL.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(requestUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${document.settings.apiKey}`,
      },
      signal: controller.signal,
    });
  } catch {
    return refreshFailure(document, "unreachable", "Could not reach the usage endpoint.");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    return refreshFailure(document, "unauthorized", "The usage endpoint rejected the API key.");
  }
  if (!response.ok) {
    return refreshFailure(
      document,
      "requestFailed",
      `The usage endpoint returned HTTP ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return refreshFailure(document, "invalidResponse", "The usage endpoint returned invalid JSON.");
  }
  const snapshot = normalizeVibeProxyAuthFiles(
    body,
    (dependencies.now ?? (() => new Date()))().toISOString(),
  );
  if (snapshot === null) {
    return refreshFailure(
      document,
      "invalidResponse",
      "The usage endpoint returned an unsupported response.",
    );
  }

  const next: StoredDocument = { ...document, snapshot };
  await cache.write(JSON.stringify(snapshot));
  return {
    settings: publicSettings(next.settings),
    result: { status: "ready", snapshot, refreshed: true, refreshProblem: null },
  };
}
