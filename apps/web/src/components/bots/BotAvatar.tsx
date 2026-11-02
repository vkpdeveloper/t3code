import {
  BOT_AVATAR_EYE_COLOR,
  botAvatarLookFor,
  resolveBotAvatar,
} from "@t3tools/client-runtime/bot-avatar";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import type { BotAvatar as BotAvatarValue, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { memo } from "react";

import { cn } from "../../lib/utils";
import { assetEnvironment } from "../../state/assets";
import { botLookStyle, registerBotAvatar } from "./botMotion";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";

export function BotAvatarShape({
  shape,
  color,
  className,
  pose,
  animateChanges = false,
}: {
  shape: string;
  color: string;
  className?: string;
  /** "side" rests turned three quarters and faces front on hover. */
  pose?: "side";
  /** Springs in again whenever the shape or color changes. */
  animateChanges?: boolean;
}) {
  const resolved = resolveBotAvatar({ shape, color });
  const changeKey = `${shape}:${color}`;
  return (
    <svg
      key={animateChanges ? changeKey : undefined}
      ref={registerBotAvatar}
      aria-hidden
      viewBox="0 0 100 100"
      data-pose={pose}
      data-enter={animateChanges ? "" : undefined}
      style={animateChanges ? botLookStyle(botAvatarLookFor(changeKey)) : undefined}
      className={cn("bot-avatar overflow-visible", className)}
    >
      <g className="bot-body">
        <path d={resolved.path} fill={resolved.color} />
        <g className="bot-face">
          <g className="bot-eyes" fill={BOT_AVATAR_EYE_COLOR}>
            {resolved.eyes.map((eye) => (
              <ellipse key={eye.cx} cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={eye.ry} />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}

function BotAvatarImage({
  threadRef,
  path,
  fallback,
}: {
  threadRef: ScopedThreadRef;
  path: string;
  fallback: React.ReactNode;
}) {
  const result = useAtomValue(
    assetEnvironment.createUrl({
      environmentId: threadRef.environmentId,
      input: { resource: { _tag: "workspace-file", threadId: threadRef.threadId, path } },
    }),
  );
  const state = assetUrlStateFromResult(result, useEnvironmentHttpBaseUrl(threadRef.environmentId));
  if (state._tag !== "Success") return fallback;
  return <img alt="" src={state.url} className="size-full object-cover" draggable={false} />;
}

/** A generated image when the bot has one, otherwise its drawn shape. */
export const BotAvatar = memo(function BotAvatar({
  avatar,
  threadRef,
  className,
  animateChanges = false,
}: {
  avatar: BotAvatarValue;
  threadRef: ScopedThreadRef;
  className?: string;
  animateChanges?: boolean;
}) {
  const shape = (
    <BotAvatarShape
      shape={avatar.shape}
      color={avatar.color}
      animateChanges={animateChanges}
      className="size-[68%]"
    />
  );
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      {avatar.imagePath ? (
        <BotAvatarImage threadRef={threadRef} path={avatar.imagePath} fallback={shape} />
      ) : (
        shape
      )}
    </span>
  );
});
