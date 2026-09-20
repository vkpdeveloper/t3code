# Provider constraints

Orchestration records intent and state without knowing which provider runs a thread. Provider
protocols, account ownership, permissions, and capabilities belong at the
[adapter boundary](../../apps/server/src/orchestration-v2/ProviderAdapter.ts). Normalize there
instead of spreading provider checks through reactors and clients.

A driver kind identifies an integration. An instance identifies one configuration and account
lifecycle. Route work by instance so two accounts using the same driver do not share mutable
session or catalog state.

## Built-in drivers

The fork supports Codex, Claude Agent, Cursor, Grok, Devin, Amp, OpenCode, and Antigravity. A new
driver needs an adapter and registry entry. Provider-specific behavior stays at that boundary so
the orchestration model and clients do not grow provider checks for the common path.

## Process and account isolation

T3-managed OpenCode chat uses one server per thread. Its MCP registrations are directory-scoped,
while T3's MCP connection is thread-scoped. Sharing a chat server between threads in one directory
would let them replace each other's connection. Catalog and text-generation work can share the
instance-owned helper, which closes after an idle period. External OpenCode servers remain
externally owned and can require an external restart to pick up configuration changes.

OpenCode also stores persistent approval grants per directory. Automatic full-access replies use
`once` so they cannot widen a supervised thread's permissions on a shared external server.
See the [adapter](../../apps/server/src/orchestration-v2/Adapters/OpenCodeAdapterV2.ts).

Pi runs the user's own `pi` install in RPC mode and owns native extension, package, and project
trust discovery. T3 injects only its namespaced MCP bridge, so a Pi session behaves as it does in
the Pi TUI. Pi session files back native resume, rollback, and same-instance thread forks.
Forks use Pi's CLI in the destination directory because RPC session switching retains the source
session's cwd. Provider switches still use portable handoff summaries.
See the [adapter](../../apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts).

Antigravity separates account profiles per instance while sharing installed executables across the
environment. It uses file-based credential storage because the native macOS keychain entry would
otherwise be shared across profiles. The isolated profile links user-global skills back to the
real Gemini home without importing user MCP servers, hooks, or rules into the profile.

The Antigravity installer outlives client connections and provider-instance rebuilds. Releases are
immutable, with an atomic pointer selecting the version for new processes. Running processes hold
leases on their version. Updates and removal must respect those leases instead of replacing
executables under a running agent.

## Setup must not happen as a health-check side effect

Opening a provider session can start MCP servers, run hooks, or launch a login browser. Grok probes
therefore use version, model, and initialization checks without authenticating or creating a
session. A failed initialization can degrade to a warning when the installed CLI and model catalog
are still usable.

Antigravity reserves authenticated catalog sessions for explicit setup or model refresh.
Background checks use initialization only. Sign-in belongs to the initiating T3 auth session. The
client carries the return URL back to the environment because the provider's loopback listener may
be on another machine. A successful callback HTTP request is not proof that authentication
finished. The native process owns token exchange and storage.

Sign-out closes admission to new processes and stops existing processes before clearing account
metadata. Cached model lists do not establish current access, and an authoritative empty catalog
must clear the old list.

Text-generation helpers deny tool requests, but native hooks and MCP configuration can run before
the prompt. They reject profiles with such configuration before launch. Prompt instructions and
tool denial do not create a native sandbox.

## Provider updates run only through the owning installer

A one-click update is offered only when the resolved executable path proves which installer owns
it. Homebrew and npm ownership use real paths, including versioned kegs and global package roots.
Native installer layouts and the global bin directories of pnpm, Bun, and Vite+ may match the
resolved path or its real target. Anything unproven stays manual-only but can still report a
version gap.

Ownership is cached per instance and re-read immediately before an update. The runner refuses when
the lock key changed since the advisory and reports success only when the refreshed provider is
still installed with a readable, current version.

## Protocol traps

Codex async questions arrive as notifications and are answered with a new user message. There is
no pending RPC response to send. The
[adapter](../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts) persists them as
`user_input_request` turn items and runtime requests with `responseCapability: { type: "message" }`.
Their execution nodes do not block the run. Web, desktop, and mobile use their normal question
panels, and requests remain pending after a turn finishes, a provider exits, or the server restarts.

`runtime-request.respond` reads the persisted request and question item, validates required
answers, and commits the resolution and a user message in one transaction. Repeating the same
command returns its receipt without posting the answer twice. The normal message path starts or
resumes a run, queues behind active work, or steers when the adapter supports it. Blocking questions
retain the provider's live response path. Do not infer that a request has disappeared merely because
it is outside the recent history window.

Devin runs as an ACP agent but should not receive ACP `authenticate` during ordinary session
startup because its browser method starts a new PKCE flow on every call. Sessions use existing CLI
credentials. Mode mapping is explicit: Devin has no ask-before-edit mode, and its session model
option is authoritative because the CLI catalog can include models unavailable to the account.

Amp emits complete content blocks rather than token deltas. Its adapter normalizes those blocks at
the provider boundary so orchestration and clients keep the same streaming model.

Capabilities must describe what a provider can actually do. Antigravity can capture workspace
checkpoints but cannot roll back its conversation, so revert is rejected before touching files.
Native permission and question option IDs must survive normalization because a display label is not
necessarily a valid reply.

## Attachments and stored history

Attachments live outside the project workspace. The
[attachment boundary](../../apps/server/src/orchestration-v2/AttachmentClaims.ts) validates and claims
uploads for a thread; adapters choose native input formats for those environment-local files.
A path in the prompt does not grant filesystem access. Keep provider sandbox and approval rules
in force; copying uploads into the project to bypass them changes that boundary.

File attachments introduced a replay compatibility limit. Image-only clients cannot decode
file-bearing messages, and an image-only server can fail the entire environment's startup when
replaying one such event. Rollouts and downgrades must account for persisted history as well as
current client support.

## Provider diagnostics

Native event logs retain lifecycle events, responses, and failures. Token deltas and duplicate raw
frames are filtered before adapters copy or redact payloads. The filter accepts both legacy native
events and v2 protocol envelopes; decode failures remain visible through diagnostic frames.

Log payloads have a 64 KiB encoded budget. Large or deeply nested payloads become structural
summaries that retain routing identifiers, methods, status, and error fields. Traversal is bounded
before redaction and serialization, so logging a large response does not require several full
copies. These limits apply to diagnostics; provider event handling is unchanged.

Codex resumes with metadata-only reads when it needs a thread's identity and update time. Its
initialization capabilities opt out of `turn/diff/updated`: T3 derives diffs from checkpoints.
The logger filters those notifications before traversal when an older provider still sends them.

Model classification has its own [manifest constraints](./model-manifest.md). Assistant-reference
handling is documented under [citations](./assistant-citations.md).
