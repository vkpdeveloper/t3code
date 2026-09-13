import * as NodeCrypto from "node:crypto";

import * as FileSystem from "effect/FileSystem";
import * as DateTime from "effect/DateTime";
import { stableStringify } from "@t3tools/shared/relaySigning";
import {
  type AmpSettings,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  type ProviderSession,
  type ProviderRuntimeEvent,
  type ProviderSessionStartInput,
  type ThreadId,
  TurnId,
  type ModelSelection,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import { ServerConfig } from "../../config.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import { ProviderAdapterRequestError, ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { startAmpProcess, type AmpProcess } from "../amp/AmpProcess.ts";
import type { AmpMessage } from "../amp/AmpProtocol.ts";

const PROVIDER = ProviderDriverKind.make("amp");
const Resume = Schema.Struct({ sessionId: Schema.String });
const isResume = Schema.is(Resume);
interface Session {
  session: ProviderSession;
  start: ProviderSessionStartInput;
  process?: AmpProcess | undefined;
  selection?: ModelSelection | undefined;
  signature?: string | undefined;
  active?: TurnId | undefined;
  resumeId?: string;
  turns: Array<{ id: TurnId; items: unknown[] }>;
  tools: Map<string, { name: string; input: unknown }>;
  approvals: Map<string, string>;
  usage: {
    input: number;
    output: number;
    cached: number;
    created: number;
    seen: boolean;
    subagents: boolean;
  };
}
const isAgentTool = (name: string) =>
  ["Task", "oracle", "librarian", "finder", "read_thread"].includes(name);
const emptyUsage = () => ({
  input: 0,
  output: 0,
  cached: 0,
  created: 0,
  seen: false,
  subagents: false,
});

export const makeAmpAdapter = Effect.fn("makeAmpAdapter")(function* (
  settings: AmpSettings,
  environment: NodeJS.ProcessEnv,
  instanceId: ProviderInstanceId,
) {
  const config = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const clockContext = yield* Effect.context<never>();
  const nowIso = () =>
    Effect.runSyncWith(clockContext)(Effect.map(DateTime.now, DateTime.formatIso));
  const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const lifecycle = yield* Semaphore.make(1);
  const sessions = new Map<ThreadId, Session>();
  const stamp = (context: Session) => ({
    eventId: EventId.make(NodeCrypto.randomUUID()),
    createdAt: nowIso(),
    provider: PROVIDER,
    threadId: context.session.threadId,
    ...(context.active ? { turnId: context.active } : {}),
  });
  const emit = (event: ProviderRuntimeEvent) => {
    Effect.runSyncWith(clockContext)(PubSub.publish(events, event));
  };
  const error = (method: string, detail: string) =>
    new ProviderAdapterRequestError({ provider: PROVIDER, method, detail });
  const get = (threadId: ThreadId) => {
    const context = sessions.get(threadId);
    return context
      ? Effect.succeed(context)
      : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
  };
  const finish = (
    context: Session,
    state: "completed" | "failed" | "interrupted",
    message?: string,
  ) => {
    if (!context.active) return;
    const usage = context.usage;
    const tokenUsage: TurnTokenUsage = usage.seen
      ? {
          usageScope: "main_agent",
          usageStatus: "complete",
          inputTokens: usage.input,
          outputTokens: usage.output,
          cachedInputTokens: usage.cached,
          cacheCreationTokens: usage.created,
          hasSubagents: usage.subagents,
        }
      : { usageScope: "main_agent", usageStatus: "unavailable", hasSubagents: usage.subagents };
    for (const id of context.approvals.keys()) {
      context.process?.approve(id, false);
      emit({
        ...stamp(context),
        type: "request.resolved",
        requestId: RuntimeRequestId.make(id),
        payload: { requestType: "dynamic_tool_call", decision: "cancel" },
      });
    }
    context.approvals.clear();
    for (const [id, tool] of context.tools) {
      emit({
        ...stamp(context),
        type: "item.completed",
        itemId: RuntimeItemId.make(id),
        payload: { itemType: "dynamic_tool_call", title: tool.name, status: "failed" },
      });
      if (isAgentTool(tool.name))
        emit({
          ...stamp(context),
          type: "task.completed",
          payload: {
            taskId: RuntimeTaskId.make(id),
            taskType: "subagent",
            toolUseId: id,
            status: "failed",
          },
        });
    }
    context.tools.clear();
    emit({
      ...stamp(context),
      type: "turn.completed",
      payload: { state, tokenUsage, ...(message ? { errorMessage: message } : {}) },
    });
    context.active = undefined;
    context.session = {
      ...context.session,
      status: "ready",
      activeTurnId: undefined,
      updatedAt: nowIso(),
    };
  };
  const onMessage = (context: Session, message: AmpMessage) => {
    if (message.session_id !== context.resumeId) {
      context.resumeId = message.session_id;
      context.session = { ...context.session, resumeCursor: { sessionId: message.session_id } };
      emit({
        ...stamp(context),
        type: "session.started",
        payload: { resume: { sessionId: message.session_id } },
      });
      emit({
        ...stamp(context),
        type: "thread.started",
        payload: { providerThreadId: message.session_id },
      });
    }
    if (!context.active) return;
    context.turns.at(-1)?.items.push(message);
    const parent = message.parent_tool_use_id;
    if (parent) context.usage.subagents = true;
    const usage = message.message?.usage;
    if (usage && !parent) {
      context.usage.seen = true;
      context.usage.cached += usage.cache_read_input_tokens ?? 0;
      context.usage.created += usage.cache_creation_input_tokens ?? 0;
      context.usage.input +=
        usage.input_tokens +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      context.usage.output += usage.output_tokens;
    }
    for (const block of message.message?.content ?? []) {
      const attribution = parent ? { parentToolUseId: parent, agentId: parent } : {};
      if (message.type === "assistant" && (block.type === "text" || block.type === "thinking")) {
        const itemId = RuntimeItemId.make(NodeCrypto.randomUUID());
        const thinking = block.type === "thinking";
        const text = thinking ? block.thinking : block.text;
        const payload = {
          itemType: thinking ? ("reasoning" as const) : ("assistant_message" as const),
          ...attribution,
        };
        emit({ ...stamp(context), type: "item.started", itemId, payload });
        emit({
          ...stamp(context),
          type: "content.delta",
          itemId,
          payload: { streamKind: thinking ? "reasoning_text" : "assistant_text", delta: text },
        });
        emit({
          ...stamp(context),
          type: "item.completed",
          itemId,
          payload: { ...payload, status: "completed" },
        });
      } else if (block.type === "tool_use") {
        context.tools.set(block.id, { name: block.name, input: block.input });
        if (isAgentTool(block.name)) {
          context.usage.subagents = true;
          emit({
            ...stamp(context),
            type: "task.started",
            payload: {
              taskId: RuntimeTaskId.make(block.id),
              taskType: "subagent",
              description: block.name,
              toolUseId: block.id,
              ...(parent ? { agentId: parent } : {}),
            },
          });
        }
        emit({
          ...stamp(context),
          type: "item.started",
          itemId: RuntimeItemId.make(block.id),
          payload: {
            itemType: "dynamic_tool_call",
            title: block.name,
            status: "inProgress",
            data: { toolName: block.name, input: block.input },
            ...attribution,
          },
        });
      } else if (block.type === "tool_result") {
        const tool = context.tools.get(block.tool_use_id);
        context.tools.delete(block.tool_use_id);
        if (tool && isAgentTool(tool.name))
          emit({
            ...stamp(context),
            type: "task.completed",
            payload: {
              taskId: RuntimeTaskId.make(block.tool_use_id),
              taskType: "subagent",
              toolUseId: block.tool_use_id,
              status: block.is_error ? "failed" : "completed",
              ...(parent ? { agentId: parent } : {}),
            },
          });
        emit({
          ...stamp(context),
          type: "item.completed",
          itemId: RuntimeItemId.make(block.tool_use_id),
          payload: {
            itemType: "dynamic_tool_call",
            title: tool?.name || "Amp tool",
            status: block.is_error ? "failed" : "completed",
            data: { toolName: tool?.name, input: tool?.input, output: block.content },
            ...attribution,
          },
        });
      }
    }
    if (
      !parent &&
      message.type === "assistant" &&
      message.message?.stop_reason &&
      message.message.stop_reason !== "tool_use"
    )
      context.process?.endInput();
    if (message.type === "result")
      finish(context, message.is_error ? "failed" : "completed", message.error);
    if (message.type === "system" && message.subtype !== "init" && message.error)
      finish(context, "failed", message.error);
  };
  const close = async (context: Session) => {
    finish(context, "interrupted");
    const process = context.process;
    context.process = undefined;
    if (process) await process.close();
  };
  const adapter: ProviderAdapterShape<
    ProviderAdapterRequestError | ProviderAdapterSessionNotFoundError
  > = {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    startSession: (input) =>
      Effect.sync(() => {
        if (sessions.has(input.threadId)) return sessions.get(input.threadId)!.session;
        const now = nowIso();
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: instanceId,
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
          cwd: input.cwd || config.cwd,
          status: "ready",
          createdAt: now,
          updatedAt: now,
          model: input.modelSelection?.model || "medium",
          ...(input.resumeCursor ? { resumeCursor: input.resumeCursor } : {}),
        };
        const context: Session = {
          session,
          start: input,
          selection: input.modelSelection,
          ...(isResume(input.resumeCursor) ? { resumeId: input.resumeCursor.sessionId } : {}),
          turns: [],
          tools: new Map(),
          approvals: new Map(),
          usage: emptyUsage(),
        };
        sessions.set(input.threadId, context);
        emit({ ...stamp(context), type: "session.state.changed", payload: { state: "ready" } });
        return session;
      }),
    sendTurn: (input) =>
      Effect.gen(function* () {
        const context = yield* get(input.threadId);
        return yield* Effect.tryPromise({
          try: async () => {
            const selection = input.modelSelection || context.selection;
            const signature = stableStringify(selection);
            if (context.process && (!context.active || signature !== context.signature))
              await close(context);
            const steering = Boolean(context.active);
            if (!context.active) {
              context.active = TurnId.make(NodeCrypto.randomUUID());
              context.usage = emptyUsage();
              context.tools.clear();
              context.turns.push({ id: context.active, items: [] });
              emit({
                ...stamp(context),
                type: "turn.started",
                payload: { model: selection?.model || "medium" },
              });
            }
            const turnId = context.active;
            context.session = { ...context.session, status: "running", activeTurnId: turnId };
            if (!context.process) {
              const mcp = McpProviderSession.readMcpProviderSession(input.threadId);
              context.process = await startAmpProcess({
                settings,
                environment: McpProviderSession.withAgentDeviceEnvironment(environment, mcp),
                cwd: context.session.cwd || config.cwd,
                mode: selection?.model || "medium",
                runtimeMode: context.session.runtimeMode,
                ...(context.resumeId ? { resumeId: context.resumeId } : {}),
                ...(context.start.title ? { title: context.start.title } : {}),
                fast: getModelSelectionBooleanOptionValue(selection, "fast"),
                pro: getModelSelectionBooleanOptionValue(selection, "pro"),
                thinking: getModelSelectionBooleanOptionValue(selection, "thinking") ?? true,
                visibility: getModelSelectionStringOptionValue(selection, "visibility"),
                ...(mcp
                  ? {
                      mcpConfig: {
                        "t3-code": {
                          url: mcp.endpoint,
                          headers: { Authorization: mcp.authorizationHeader },
                        },
                      },
                    }
                  : {}),
                onMessage: (message) => onMessage(context, message),
                onApproval: (id, tool, args) => {
                  context.approvals.set(id, tool);
                  emit({
                    ...stamp(context),
                    type: "request.opened",
                    requestId: RuntimeRequestId.make(id),
                    payload: {
                      requestType: "dynamic_tool_call",
                      detail: `${tool}\n${typeof args === "string" ? args : JSON.stringify(args, null, 2)}`,
                      args,
                      options: [
                        { decision: "accept", label: "Allow once" },
                        { decision: "decline", label: "Deny" },
                      ],
                    },
                  });
                },
                onExit: (message) => {
                  const process = context.process;
                  context.process = undefined;
                  if (process) {
                    finish(context, "failed", message || "Amp exited before completing the turn.");
                    context.signature = undefined;
                    void process.close();
                  }
                },
              });
              context.signature = signature;
            }
            context.selection = selection;
            const content: unknown[] = [
              {
                type: "text",
                text: `${buildRuntimeInstructions({ harness: "Amp" })}\n\n${input.input || "Continue."}`,
              },
            ];
            for (const attachment of input.attachments ?? []) {
              const path = resolveAttachmentPath({
                attachmentsDir: config.attachmentsDir,
                attachment,
              });
              if (!path) throw new Error("Attachment is unavailable");
              if (
                ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(attachment.mimeType)
              ) {
                const bytes = await Effect.runPromiseWith(clockContext)(fs.readFile(path));
                if (bytes.byteLength > 20 * 1024 * 1024)
                  throw new Error("Amp image exceeds 20 MiB");
                content.push({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: attachment.mimeType,
                    data: Buffer.from(bytes).toString("base64"),
                  },
                });
              } else content.push({ type: "text", text: `Attached file: ${path}` });
            }
            context.process.send(content, steering);
            return {
              threadId: input.threadId,
              turnId,
              ...(context.resumeId ? { resumeCursor: { sessionId: context.resumeId } } : {}),
            };
          },
          catch: (cause) => {
            finish(context, "failed", "Failed to send the turn to Amp.");
            return error("sendTurn", cause instanceof Error ? cause.message : "Amp failed");
          },
        });
      }).pipe(lifecycle.withPermit),
    interruptTurn: (threadId) =>
      Effect.gen(function* () {
        const context = yield* get(threadId);
        yield* Effect.tryPromise({
          try: () => close(context),
          catch: () => error("interrupt", "Could not stop Amp"),
        });
      }),
    respondToRequest: (threadId, requestId, decision) =>
      Effect.gen(function* () {
        const context = yield* get(threadId);
        if (
          !context.process?.approve(
            requestId,
            decision === "accept" || decision === "acceptForSession" || decision === "acceptAlways",
          )
        )
          return yield* error("approval", "Approval is no longer pending");
        context.approvals.delete(requestId);
        emit({
          ...stamp(context),
          type: "request.resolved",
          requestId: RuntimeRequestId.make(requestId),
          payload: { requestType: "dynamic_tool_call", decision },
        });
      }),
    respondToUserInput: () =>
      Effect.fail(error("userInput", "Amp stream-json does not expose interactive questions.")),
    stopSession: (threadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        yield* Effect.tryPromise({
          try: () => close(context),
          catch: () => error("stopSession", "Could not stop Amp"),
        });
        sessions.delete(threadId);
        emit({ ...stamp(context), type: "session.exited", payload: { exitKind: "graceful" } });
      }),
    listSessions: () => Effect.sync(() => [...sessions.values()].map((context) => context.session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread: (threadId) =>
      Effect.gen(function* () {
        const context = yield* get(threadId);
        return { threadId, turns: context.turns };
      }),
    rollbackThread: () =>
      Effect.fail(error("rollback", "Amp does not support conversation rollback.")),
    stopAll: () =>
      Effect.forEach([...sessions.keys()], (threadId) => adapter.stopSession(threadId), {
        discard: true,
      }),
    streamEvents: Stream.fromPubSub(events),
  };
  yield* Effect.addFinalizer(() => adapter.stopAll().pipe(Effect.orDie));
  return adapter;
});
