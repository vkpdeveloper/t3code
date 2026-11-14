import * as Schema from "effect/Schema";

import { CommandId, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * A bot is a project rooted at `<T3 home>/bots/<name>` whose single thread is
 * the bot's long-lived session. The `bot` record on the project marks it and
 * carries what the thread itself cannot: avatar and description.
 */
export const BOT_AVATAR_SHAPES = [
  "circle",
  "cloud",
  "diamond",
  "star",
  "flower",
  "heart",
  "gear",
  "drop",
  "pill",
  "triangle",
  "shield",
  "burst",
  "hexagon",
  "pumpkin",
] as const;
export const BotAvatarShape = Schema.Literals(BOT_AVATAR_SHAPES);
export type BotAvatarShape = typeof BotAvatarShape.Type;

export const BOT_AVATAR_COLORS = [
  "white",
  "brown",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "gray",
] as const;
export const BotAvatarColor = Schema.Literals(BOT_AVATAR_COLORS);
export type BotAvatarColor = typeof BotAvatarColor.Type;

/** Generated images live in the bot folder under `avatars/`. */
export const BotAvatarImagePath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^avatars\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp)$/),
);
export type BotAvatarImagePath = typeof BotAvatarImagePath.Type;

// Received as plain strings so a shape or color added later still decodes on
// older clients, which draw their default instead.
export const BotAvatar = Schema.Struct({
  shape: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
  color: TrimmedNonEmptyString.check(Schema.isMaxLength(32)),
  imagePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(128)))),
});
export type BotAvatar = typeof BotAvatar.Type;

export const BOT_NAME_MAX_LENGTH = 48;
export const BotName = TrimmedNonEmptyString.check(Schema.isMaxLength(BOT_NAME_MAX_LENGTH));

export const BOT_DESCRIPTION_MAX_LENGTH = 2000;
export const BotDescription = Schema.String.check(Schema.isMaxLength(BOT_DESCRIPTION_MAX_LENGTH));

export const ProjectBot = Schema.Struct({
  threadId: ThreadId,
  avatar: BotAvatar,
  description: Schema.NullOr(BotDescription),
});
export type ProjectBot = typeof ProjectBot.Type;

const BotAvatarChoice = Schema.Struct({
  shape: BotAvatarShape,
  color: BotAvatarColor,
});

export const BotCreateInput = Schema.Struct({
  commandId: CommandId,
  name: BotName,
  avatar: BotAvatarChoice,
  modelSelection: ModelSelection,
});
export type BotCreateInput = typeof BotCreateInput.Type;

export const BotCreateResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
});
export type BotCreateResult = typeof BotCreateResult.Type;

export const BotUpdateInput = Schema.Struct({
  projectId: ProjectId,
  name: Schema.optional(BotName),
  avatar: Schema.optional(
    Schema.Struct({
      ...BotAvatarChoice.fields,
      /** Null switches back to the drawn shape. */
      imagePath: Schema.optional(Schema.NullOr(BotAvatarImagePath)),
    }),
  ),
  description: Schema.optional(Schema.NullOr(BotDescription)),
});
export type BotUpdateInput = typeof BotUpdateInput.Type;

export const BotDeleteInput = Schema.Struct({ projectId: ProjectId });
export type BotDeleteInput = typeof BotDeleteInput.Type;

export const BotMutationResult = Schema.Struct({ projectId: ProjectId });
export type BotMutationResult = typeof BotMutationResult.Type;

export const BotGenerateAvatarInput = Schema.Struct({
  projectId: ProjectId,
  prompt: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(500))),
});
export type BotGenerateAvatarInput = typeof BotGenerateAvatarInput.Type;

export const BotGenerateAvatarResult = Schema.Struct({
  imagePath: BotAvatarImagePath,
});
export type BotGenerateAvatarResult = typeof BotGenerateAvatarResult.Type;

/** Each bot's latest visible message, for the bots list. Thread shells carry no message text. */
export const BotPreviewsInput = Schema.Struct({});
export type BotPreviewsInput = typeof BotPreviewsInput.Type;

export const BotPreview = Schema.Struct({
  threadId: ThreadId,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  updatedAt: Schema.String,
});
export type BotPreview = typeof BotPreview.Type;

export const BotPreviewsResult = Schema.Struct({ previews: Schema.Array(BotPreview) });
export type BotPreviewsResult = typeof BotPreviewsResult.Type;

export class BotError extends Schema.TaggedError<BotError>()("BotError", {
  message: Schema.String,
  projectId: Schema.optional(ProjectId),
  cause: Schema.optional(Schema.Defect()),
}) {}
