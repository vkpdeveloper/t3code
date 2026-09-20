# Provider constraints

Orchestration records intent and state without knowing which provider runs a thread. Provider
protocols, account ownership, permissions, and capabilities belong at the adapter boundary. The
V2 adapters live in `apps/server/src/orchestration-v2/Adapters`; shared provider installation,
authentication, and maintenance services live under `apps/server/src/provider`.

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

OpenCode stores persistent approval grants per directory. Automatic full-access replies use `once`
so they cannot widen a supervised thread's permissions on a shared external server.

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
no pending RPC response to send. Blocking questions still use the request-response path. Async
questions can outlive a turn, provider process, or server restart, so their durable runtime request
must remain the source of truth.

Grok's built-in `grok-build` slug is a product label, not an ACP model identifier. Selecting it
keeps the session's current model instead of sending it to `session/set_model`.

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

Attachments live outside the project workspace. The attachment boundary validates and claims
uploads for a thread; adapters choose native input formats for those environment-local files. A
path in the prompt does not grant filesystem access. Keep provider sandbox and approval rules in
force. Copying uploads into the project to bypass them changes that boundary.

Provider-native session files are not orchestration truth. Checkpoints, portable handoffs, runtime
requests, and projected conversation state remain durable T3 records even when a native session can
resume or fork directly.
