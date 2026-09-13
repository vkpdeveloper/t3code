// @effect-diagnostics nodeBuiltinImport:off - temporary native CLI helper workspace.
// @effect-diagnostics globalTimers:off - native Promise helper deadline.
// @effect-diagnostics globalTimersInEffect:off - native Promise helper deadline.
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type AmpSettings, type ModelSelection, TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";
import { startAmpProcess } from "../provider/amp/AmpProcess.ts";

export function makeAmpTextGeneration(settings: AmpSettings, environment: NodeJS.ProcessEnv) {
  const runAmpJson = <S extends Schema.Top>(input: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }) =>
    Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: async (signal) => {
          const cwd = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-amp-text-"));
          const done = Promise.withResolvers<string>();
          void done.promise.catch(() => {});
          let text = "";
          let runtime: Awaited<ReturnType<typeof startAmpProcess>> | undefined;
          const abort = () => {
            done.reject(new Error("Amp text generation cancelled"));
          };
          signal.addEventListener("abort", abort, { once: true });
          const timeout = setTimeout(
            () => done.reject(new Error("Amp text generation timed out")),
            120_000,
          );
          try {
            runtime = await startAmpProcess({
              settings,
              environment,
              cwd,
              mode: input.modelSelection.model,
              runtimeMode: "approval-required",
              thinking: false,
              onApproval: (id) => {
                runtime?.approve(id, false);
              },
              onMessage: (message) => {
                if (!message.parent_tool_use_id && message.type === "assistant")
                  for (const block of message.message?.content ?? [])
                    if (block.type === "text") text += block.text;
                if (text.length > 100_000)
                  done.reject(new Error("Amp text generation output exceeded the limit"));
                if (
                  !message.parent_tool_use_id &&
                  message.message?.stop_reason &&
                  message.message.stop_reason !== "tool_use"
                )
                  runtime?.endInput();
                if (message.type === "result") {
                  if (message.is_error) done.reject(new Error("Amp text generation failed"));
                  else done.resolve(text);
                }
              },
              onExit: (error) => {
                done.reject(new Error(error || "Amp exited before returning a result"));
              },
            });
            if (signal.aborted) throw new Error("Amp text generation cancelled");
            runtime.send([
              {
                type: "text",
                text: `Do not use tools. Return only the requested JSON.\n\n${input.prompt}`,
              },
            ]);
            return await done.promise;
          } finally {
            clearTimeout(timeout);
            signal.removeEventListener("abort", abort);
            await runtime?.close();
            await NodeFSP.rm(cwd, { recursive: true, force: true });
          }
        },
        catch: (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail: "Amp text generation failed.",
            cause,
          }),
      });
      return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson))(
        extractJsonObject(text),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: "Amp returned invalid structured output.",
              cause,
            }),
        ),
      );
    });
  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("AmpTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runAmpJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("AmpTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runAmpJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("AmpTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runAmpJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("AmpTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runAmpJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
}
