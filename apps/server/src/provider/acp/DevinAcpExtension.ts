/**
 * Devin sends its ask-user-question tool as an ACP form elicitation, but under
 * `elicitation/create` first and `_session/elicitation` as a fallback rather than
 * the spec's `session/elicitation`. Both carry the same form payload, so this
 * module decodes the form leniently and maps it onto T3 user-input questions.
 *
 * Observed request (devin 3000.10.21):
 *
 *     { mode: "form", sessionId, message: "Which color do you prefer?",
 *       requestedSchema: { type: "object", required: ["q0"], properties: {
 *         q0: { type: "string", title: "Color preference", description: "...",
 *               oneOf: [{ const: "Red", title: "The color red" }, ...] } } },
 *       _meta: { "cognition.ai/allowOther": true } }
 */
import type {
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  UserInputQuestion,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";

export const DEVIN_ELICITATION_METHODS = ["elicitation/create", "_session/elicitation"] as const;

const DevinElicitationChoice = Schema.Struct({
  const: Schema.Unknown,
  title: Schema.optional(Schema.NullOr(Schema.String)),
});

const DevinElicitationProperty = Schema.Struct({
  type: Schema.optional(Schema.Unknown),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  oneOf: Schema.optional(Schema.Array(DevinElicitationChoice)),
  enum: Schema.optional(Schema.Array(Schema.Unknown)),
});

export const DevinElicitationRequest = Schema.Struct({
  sessionId: Schema.String,
  mode: Schema.optional(Schema.String),
  message: Schema.optional(Schema.NullOr(Schema.String)),
  requestedSchema: Schema.optional(
    Schema.Struct({
      properties: Schema.optional(Schema.Record(Schema.String, DevinElicitationProperty)),
    }),
  ),
  _meta: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))),
});
export type DevinElicitationRequest = typeof DevinElicitationRequest.Type;

function choiceLabel(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function extractDevinElicitationQuestions(
  request: DevinElicitationRequest,
): ReadonlyArray<UserInputQuestion> {
  const message = request.message?.trim() || "Devin needs your input.";
  const allowOther = request._meta?.["cognition.ai/allowOther"] === true;
  const properties = Object.entries(request.requestedSchema?.properties ?? {});
  if (properties.length === 0) {
    return [
      {
        id: "answer",
        header: "Question",
        question: message,
        options: [],
        allowCustomAnswer: true,
        multiSelect: false,
      },
    ];
  }
  return properties.map(([id, property]): UserInputQuestion => {
    const options = (
      property.oneOf?.map((choice) => ({
        label: choiceLabel(choice.const),
        description: choice.title?.trim() || undefined,
      })) ??
      property.enum?.map((value) => ({ label: choiceLabel(value), description: undefined })) ??
      []
    ).flatMap((option) =>
      option.label
        ? [
            {
              label: option.label,
              description: option.description ?? option.label,
              value: option.label,
            },
          ]
        : [],
    );
    return {
      id,
      header: property.title?.trim() || "Question",
      question: property.description?.trim() || message,
      options,
      allowCustomAnswer: allowOther || options.length === 0,
      multiSelect: property.type === "array",
    };
  });
}

/** Builds the `accept` elicitation response Devin expects from T3's answers. */
export function buildDevinElicitationAcceptResponse(
  questions: ReadonlyArray<UserInputQuestion>,
  answers: ProviderUserInputAnswers,
): { readonly action: "accept"; readonly content: Record<string, unknown> } {
  const content: Record<string, unknown> = {};
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer === undefined || answer === null) {
      continue;
    }
    if (Array.isArray(answer)) {
      content[question.id] = answer.map((value) => String(value));
    } else {
      content[question.id] = typeof answer === "string" ? answer : String(answer);
    }
  }
  return { action: "accept", content };
}

export const DEVIN_ELICITATION_CANCELLED_RESPONSE = { action: "cancel" } as const;

/**
 * Devin names its permission options `allow_once`, `switch_bypass` (kind
 * `allow_always`), and `reject_once`, so the reply must pick an option by ACP
 * `kind` from the request instead of assuming Cursor-style ids.
 */
export function selectDevinPermissionOptionId(
  request: Pick<EffectAcpSchema.RequestPermissionRequest, "options">,
  decision: Exclude<ProviderApprovalDecision, "cancel">,
): string | undefined {
  const preferredKinds =
    decision === "acceptForSession"
      ? ["allow_always", "allow_once"]
      : decision === "accept"
        ? ["allow_once", "allow_always"]
        : ["reject_once", "reject_always"];
  for (const kind of preferredKinds) {
    const option = request.options.find((candidate) => candidate.kind === kind);
    if (option?.optionId.trim()) {
      return option.optionId.trim();
    }
  }
  return undefined;
}

/**
 * Devin's `session/request_permission` carries only the tool call id plus the
 * shell command under `cognition.ai/editableCommand`; the title and command
 * arrived earlier on the `tool_call` notification.
 */
export function extractDevinPermissionCommand(
  request: Pick<EffectAcpSchema.RequestPermissionRequest, "toolCall">,
): string | undefined {
  const meta = request.toolCall._meta;
  const command =
    meta && typeof meta === "object" ? meta["cognition.ai/editableCommand"] : undefined;
  return typeof command === "string" && command.trim().length > 0 ? command.trim() : undefined;
}
