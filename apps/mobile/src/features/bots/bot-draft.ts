import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  type BotAvatarColor,
  type BotAvatarShape,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";

/** Null machine and model mean "use the default" until the user picks one. */
export type BotDraft = {
  readonly name: string;
  readonly shape: BotAvatarShape;
  readonly color: BotAvatarColor;
  readonly environmentId: EnvironmentId | null;
  readonly modelSelection: ModelSelection | null;
};

function pick<T>(values: ReadonlyArray<T>): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function freshBotDraft(): BotDraft {
  return {
    name: "",
    shape: pick(BOT_AVATAR_SHAPES),
    color: pick(BOT_AVATAR_COLORS),
    environmentId: null,
    modelSelection: null,
  };
}

// Shared by the form and its model picker route.
export const botDraftAtom = Atom.make<BotDraft>(freshBotDraft()).pipe(Atom.keepAlive);

export function startBotDraft() {
  appAtomRegistry.set(botDraftAtom, freshBotDraft());
}

export function updateBotDraft(patch: Partial<BotDraft>) {
  appAtomRegistry.set(botDraftAtom, { ...appAtomRegistry.get(botDraftAtom), ...patch });
}
