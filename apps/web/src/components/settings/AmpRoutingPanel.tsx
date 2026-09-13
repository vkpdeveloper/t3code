import { useEffect, useRef, useState } from "react";
import type {
  AmpRoutingAction,
  AmpRoutingConnection,
  AmpRoutingSnapshot,
  EnvironmentId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ensureLocalApi } from "../../localApi";
import { AmpIcon, OpenAI, GrokIcon } from "../Icons";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { Switch } from "../ui/switch";

const modes = [
  { id: "low", label: "Low", color: "#eab308" },
  { id: "medium", label: "Medium", color: "#34d399" },
  { id: "high", label: "High", color: "#38bdf8" },
  { id: "ultra", label: "Ultra", color: "#c084fc" },
];
function connectionLabel(connection: AmpRoutingConnection) {
  if (connection.type === "model_provider_openai_chatgpt") return "ChatGPT subscription";
  if (connection.type === "model_provider_xai_grok") return "Grok subscription";
  return connection.type.replace(/^model_provider_/, "").replaceAll("_", " ");
}
function ConnectionIcon({ connection }: { connection: AmpRoutingConnection }) {
  const Icon = connection.type.includes("openai")
    ? OpenAI
    : connection.type.includes("xai")
      ? GrokIcon
      : AmpIcon;
  return <Icon className="size-5 shrink-0" />;
}

export function AmpRoutingPanel({
  environmentId,
  instanceId,
  readOnly,
  enabled,
}: {
  environmentId: EnvironmentId;
  instanceId: ProviderInstanceId;
  readOnly: boolean;
  enabled: boolean;
}) {
  const read = useAtomCommand(serverEnvironment.ampRoutingRead, { reportFailure: false });
  const act = useAtomCommand(serverEnvironment.ampRoutingAction, { reportFailure: false });
  const [workspace, setWorkspace] = useState(false);
  const [snapshot, setSnapshot] = useState<AmpRoutingSnapshot>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [selected, setSelected] = useState<AmpRoutingConnection>();
  const [adding, setAdding] = useState(false);
  const [deleteId, setDeleteId] = useState<string>();
  const [name, setName] = useState("");
  const [mapping, setMapping] = useState("");
  const [mappingChanged, setMappingChanged] = useState(false);
  const [cloudflareAccountId, setCloudflareAccountId] = useState("");
  const [cloudflareGatewayId, setCloudflareGatewayId] = useState("");
  const [apiFormat, setApiFormat] = useState<
    "chat-completions" | "responses" | "anthropic-messages"
  >("chat-completions");
  const [keyEnv, setKeyEnv] = useState("");
  const [router, setRouter] =
    useState<Extract<AmpRoutingAction, { action: "add-router" }>["router"]>("openrouter");
  const [baseUrl, setBaseUrl] = useState("");
  const generation = useRef(0);
  const locked = useRef(false);
  useEffect(() => {
    const epoch = ++generation.current;
    setSnapshot(undefined);
    setSelected(undefined);
    setAdding(false);
    if (!enabled) return;
    setPending(true);
    void read({ environmentId, input: { instanceId, workspace } }).then((result) => {
      if (generation.current !== epoch) return;
      if (result._tag === "Success") {
        setSnapshot(result.value);
        setError(undefined);
      } else setError(String(squashAtomCommandFailure(result)));
      setPending(false);
    });
    return () => {
      generation.current++;
    };
  }, [environmentId, instanceId, workspace, enabled, read]);
  async function run(operation?: AmpRoutingAction) {
    if (locked.current) return;
    locked.current = true;
    const epoch = generation.current;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = operation
        ? await act({ environmentId, input: { instanceId, workspace, operation } })
        : await read({ environmentId, input: { instanceId, workspace } });
      if (generation.current !== epoch) return;
      if (result._tag === "Success") {
        setSnapshot(result.value);
        setSelected(undefined);
        setAdding(false);
        setDeleteId(undefined);
        if (operation?.action === "test") setNotice("Connection test passed.");
      } else setError(String(squashAtomCommandFailure(result)));
    } finally {
      locked.current = false;
      if (generation.current === epoch) setPending(false);
    }
  }
  function edit(connection: AmpRoutingConnection) {
    setMappingChanged(false);
    setSelected(connection);
    setAdding(false);
    setName(connection.name);
    setMapping(
      typeof connection.config.modelMapping === "string" ? connection.config.modelMapping : "",
    );
  }
  const disabled = readOnly || pending || !enabled;
  return (
    <section className="space-y-5 border-t border-border pt-5" aria-label="Amp model routing">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Model routing</h3>
        <div className="flex items-center gap-2">
          <select
            aria-label="Routing scope"
            className="rounded border border-input bg-background px-2 py-1 text-xs"
            value={workspace ? "workspace" : "personal"}
            disabled={pending}
            onChange={(event) => setWorkspace(event.target.value === "workspace")}
          >
            <option value="personal">Personal</option>
            <option value="workspace">Workspace</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !enabled}
            onClick={() => void run()}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              setAdding(true);
              setSelected(undefined);
              setName("");
              setMapping("*/*");
            }}
          >
            Add router
          </Button>
        </div>
      </div>
      {!enabled && (
        <p className="text-xs text-muted-foreground">Enable Amp to manage its connections.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <div className="divide-y divide-border rounded-lg border border-border">
        {snapshot?.connections.map((connection) => (
          <div key={connection.id} className="flex flex-wrap items-center gap-3 p-3">
            <ConnectionIcon connection={connection} />
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => edit(connection)}
              disabled={disabled}
            >
              <span className="block truncate text-sm">
                {connection.config.accountEmail ? connectionLabel(connection) : connection.name}
              </span>
              {!connection.config.accountEmail && (
                <span className="text-xs text-muted-foreground">{connectionLabel(connection)}</span>
              )}
            </button>
            {connection.config.accountEmail && (
              <RedactedSensitiveText
                value={connection.config.accountEmail}
                ariaLabel="Account email"
                revealTooltip="Reveal email"
                hideTooltip="Hide email"
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void run({ action: "test", id: connection.id })}
            >
              Test
            </Button>
            <Switch
              aria-label={`Enable ${connectionLabel(connection)}`}
              checked={connection.active}
              disabled={disabled}
              onCheckedChange={(active) =>
                void run({ action: active ? "activate" : "deactivate", id: connection.id })
              }
            />
          </div>
        ))}
        <div className="flex items-center gap-3 p-3 text-sm">
          <AmpIcon className="size-5" />
          <span>Amp</span>
          <span className="ml-auto text-xs text-muted-foreground">Default routing</span>
        </div>
      </div>
      {(adding || selected) && (
        <form
          className="space-y-3 rounded-lg border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected)
              void run({
                action: "edit",
                id: selected.id,
                name,
                ...(mappingChanged ? { modelMapping: mapping } : {}),
              });
            else
              void run({
                action: "add-router",
                router,
                name,
                modelMapping: mapping,
                apiKeyEnvironmentVariable: keyEnv,
                active: false,
                ...(router === "custom-url" ? { baseUrl, apiFormat } : {}),
                ...(router === "cloudflare" ? { cloudflareAccountId, cloudflareGatewayId } : {}),
              });
          }}
        >
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">{adding ? "Add router" : "Edit connection"}</h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setSelected(undefined);
              }}
            >
              Close
            </Button>
          </div>
          <label className="block text-xs">
            Name
            <Input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {adding && (
            <label className="block text-xs">
              Router
              <select
                className="mt-1 block w-full rounded border border-input bg-background p-2"
                value={router}
                onChange={(event) => setRouter(event.target.value as typeof router)}
              >
                {[
                  "openrouter",
                  "ollama-cloud",
                  "vercel",
                  "cloudflare",
                  "opencode-go",
                  "custom-url",
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-xs">
            Model mapping
            <Input
              value={mapping}
              placeholder="openai/*,anthropic/*"
              onChange={(event) => {
                setMappingChanged(true);
                setMapping(event.target.value);
              }}
            />
          </label>
          {adding && (
            <label className="block text-xs">
              API key environment variable
              <Input
                required
                pattern="[A-Za-z_][A-Za-z0-9_]*"
                value={keyEnv}
                placeholder="OPENROUTER_API_KEY"
                onChange={(event) => setKeyEnv(event.target.value)}
              />
            </label>
          )}
          {adding && router === "custom-url" && (
            <label className="block text-xs">
              Base URL
              <Input
                type="url"
                required
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
          )}
          {adding && router === "custom-url" && (
            <label className="block text-xs">
              API format
              <select
                className="mt-1 block w-full rounded border border-input bg-background p-2"
                value={apiFormat}
                onChange={(event) => setApiFormat(event.target.value as typeof apiFormat)}
              >
                {["chat-completions", "responses", "anthropic-messages"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )}
          {adding && router === "cloudflare" && (
            <>
              <label className="block text-xs">
                Cloudflare account ID
                <Input
                  required
                  value={cloudflareAccountId}
                  onChange={(event) => setCloudflareAccountId(event.target.value)}
                />
              </label>
              <label className="block text-xs">
                Gateway ID
                <Input
                  required
                  value={cloudflareGatewayId}
                  onChange={(event) => setCloudflareGatewayId(event.target.value)}
                />
              </label>
            </>
          )}
          <div className="flex justify-between gap-2">
            {selected && (
              <Button
                type="button"
                variant="destructive"
                disabled={disabled}
                onClick={() => setDeleteId(selected.id)}
              >
                Delete connection
              </Button>
            )}
            <Button type="submit" disabled={disabled}>
              {adding ? "Add inactive router" : "Save"}
            </Button>
          </div>
          {deleteId && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-t border-border pt-3 text-xs"
            >
              <span>Delete this connection from Amp?</span>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled}
                onClick={() => void run({ action: "delete", id: deleteId })}
              >
                Confirm delete
              </Button>
            </div>
          )}
        </form>
      )}
      <div
        className="relative grid grid-cols-[1fr_0.4fr_1fr] items-center gap-y-3 py-2"
        aria-label="Amp mode routing"
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 600 300"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {modes.map((mode, index) => (
            <path
              key={mode.id}
              d={`M 235 ${38 + index * 75} C 285 ${38 + index * 75}, 315 150, 365 150`}
              stroke={mode.color}
              strokeWidth="1.5"
              opacity="0.65"
              fill="none"
            />
          ))}
        </svg>
        <div className="relative col-start-1 space-y-3">
          {modes.map((mode) => (
            <div
              key={mode.id}
              className="rounded-md border bg-background px-3 py-2"
              style={{ borderColor: mode.color }}
            >
              <span className="text-sm font-medium" style={{ color: mode.color }}>
                {mode.label}
              </span>
              <div className="mt-1 text-xs text-muted-foreground">Agent · Oracle · Subagents</div>
            </div>
          ))}
        </div>
        <div className="relative col-start-3 rounded-md border border-border bg-background p-4">
          <AmpIcon className="mb-2 h-6 w-12" />
          <p className="text-xs text-muted-foreground">
            Amp resolves models and connections using your saved account settings.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void ensureLocalApi().shell.openExternal("https://ampcode.com/settings/dial")
          }
        >
          Tune modes in Amp
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void ensureLocalApi().shell.openExternal("https://ampcode.com/settings/model-routing")
          }
        >
          Link a subscription
        </Button>
      </div>
    </section>
  );
}
