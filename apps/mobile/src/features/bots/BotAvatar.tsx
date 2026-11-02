import { resolveBotAvatar } from "@t3tools/client-runtime/bot-avatar";
import type { BotAvatar as BotAvatarValue, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAssetUrlState } from "../../state/assets";

function BotAvatarShape(props: { readonly avatar: BotAvatarValue; readonly size: number }) {
  const { path, color } = resolveBotAvatar(props.avatar);
  const inset = props.size * 0.18;
  return (
    <Svg width={props.size - inset * 2} height={props.size - inset * 2} viewBox="0 0 100 100">
      <Path d={path} fill={color} fillRule="nonzero" />
    </Svg>
  );
}

function BotAvatarImage(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly avatar: BotAvatarValue;
  readonly imagePath: string;
  readonly size: number;
}) {
  const resource = useMemo(
    () => ({ _tag: "workspace-file" as const, threadId: props.threadId, path: props.imagePath }),
    [props.threadId, props.imagePath],
  );
  const asset = useAssetUrlState(props.environmentId, resource);
  // The drawn shape stands in while the image loads or when it can't be read.
  if (asset._tag !== "Success") return <BotAvatarShape avatar={props.avatar} size={props.size} />;
  return (
    <Image
      source={{ uri: asset.url }}
      style={{ width: props.size, height: props.size }}
      contentFit="cover"
      accessibilityIgnoresInvertColors
    />
  );
}

/** A bot's drawn shape on a neutral tile, or its generated image when it has one. */
export function BotAvatar(props: {
  readonly avatar: BotAvatarValue;
  readonly size: number;
  /** Needed to load a generated image; without it the shape is drawn. */
  readonly source?: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
}) {
  const imagePath = props.avatar.imagePath ?? null;
  return (
    <View
      className="items-center justify-center overflow-hidden border-continuous bg-subtle"
      style={{ width: props.size, height: props.size, borderRadius: props.size * 0.28 }}
    >
      {imagePath !== null && props.source ? (
        <BotAvatarImage
          environmentId={props.source.environmentId}
          threadId={props.source.threadId}
          avatar={props.avatar}
          imagePath={imagePath}
          size={props.size}
        />
      ) : (
        <BotAvatarShape avatar={props.avatar} size={props.size} />
      )}
    </View>
  );
}
