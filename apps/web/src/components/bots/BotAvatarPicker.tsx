import { BOT_AVATAR_COLOR_HEX } from "@t3tools/client-runtime/bot-avatar";
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_SHAPES,
  type BotAvatarColor,
  type BotAvatarShape,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { BotAvatarShape as BotAvatarShapeGlyph } from "./BotAvatar";

export function BotAvatarPicker({
  shape,
  color,
  disabled = false,
  onChange,
}: {
  shape: BotAvatarShape;
  color: BotAvatarColor;
  disabled?: boolean;
  onChange: (next: { shape: BotAvatarShape; color: BotAvatarColor }) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Shape" className="grid grid-cols-7 gap-1.5">
        {BOT_AVATAR_SHAPES.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === shape}
            aria-label={option}
            disabled={disabled}
            onClick={() => onChange({ shape: option, color })}
            className={cn(
              "group/bot flex aspect-square cursor-pointer items-center justify-center rounded-lg bg-muted/60 outline-hidden ring-ring hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-default disabled:opacity-60",
              option === shape && "bg-muted ring-2 ring-foreground/70 ring-inset",
            )}
          >
            <BotAvatarShapeGlyph shape={option} color={color} pose="side" className="size-[62%]" />
          </button>
        ))}
      </div>
      <div role="group" aria-label="Color" className="flex flex-wrap gap-2">
        {BOT_AVATAR_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={option === color}
            aria-label={option}
            disabled={disabled}
            onClick={() => onChange({ shape, color: option })}
            className={cn(
              "size-6 cursor-pointer rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:opacity-60",
              option === color && "ring-2 ring-foreground/70 ring-inset",
            )}
            style={{ backgroundColor: BOT_AVATAR_COLOR_HEX[option] }}
          />
        ))}
      </div>
    </div>
  );
}
