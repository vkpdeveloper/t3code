import { resolveBotAvatar } from "@t3tools/client-runtime/bot-avatar";
import { assetUrlStateFromResult } from "@t3tools/client-runtime/state/assets";
import type { BotAvatar as BotAvatarValue, ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { memo } from "react";

import { cn } from "../../lib/utils";
import { assetEnvironment } from "../../state/assets";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";

export function BotAvatarShape({
  shape,
  color,
  className,
}: {
  shape: string;
  color: string;
  className?: string;
}) {
  const resolved = resolveBotAvatar({ shape, color });
  return (
    <svg aria-hidden viewBox="0 0 100 100" className={className}>
      <path d={resolved.path} fill={resolved.color} />
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
}: {
  avatar: BotAvatarValue;
  threadRef: ScopedThreadRef;
  className?: string;
}) {
  const shape = <BotAvatarShape shape={avatar.shape} color={avatar.color} className="size-[68%]" />;
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
