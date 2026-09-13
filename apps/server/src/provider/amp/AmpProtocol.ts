import * as Schema from "effect/Schema";

const Usage = Schema.Struct({
  input_tokens: Schema.Finite,
  output_tokens: Schema.Finite,
  cache_read_input_tokens: Schema.optional(Schema.Finite),
  cache_creation_input_tokens: Schema.optional(Schema.Finite),
});
const Block = Schema.Union([
  Schema.Struct({ type: Schema.Literal("image"), source: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal("thinking"), thinking: Schema.String }),
  Schema.Struct({ type: Schema.Literal("redacted_thinking"), data: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool_use"),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("tool_result"),
    tool_use_id: Schema.String,
    content: Schema.Unknown,
    is_error: Schema.optional(Schema.Boolean),
  }),
]);
export const AmpMessage = Schema.Struct({
  type: Schema.Literals(["system", "assistant", "user", "result"]),
  subtype: Schema.optional(Schema.String),
  session_id: Schema.String,
  parent_tool_use_id: Schema.optional(Schema.NullOr(Schema.String)),
  message: Schema.optional(
    Schema.Struct({
      content: Schema.Array(Block),
      stop_reason: Schema.optional(Schema.NullOr(Schema.String)),
      usage: Schema.optional(Usage),
    }),
  ),
  is_error: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
  result: Schema.optional(Schema.String),
  usage: Schema.optional(Usage),
});
export type AmpMessage = typeof AmpMessage.Type;
export const decodeAmpMessage = Schema.decodeUnknownSync(Schema.fromJsonString(AmpMessage));

/** Amp's JSON switch belongs to the parent command; `list --json` prints text. */
export const AMP_ROUTING_LIST_ARGS = ["config", "model-providers", "--json"] as const;
