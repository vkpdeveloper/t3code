import {
  BOT_AVATAR_EYE_COLOR,
  botAvatarLookFor,
  resolveBotAvatar,
} from "@t3tools/client-runtime/bot-avatar";
import type { BotAvatar as BotAvatarValue, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Ellipse, G, Path } from "react-native-svg";

import { type BotLook, registerBotMotion } from "./botMotion";

import { useAssetUrlState } from "../../state/assets";

/** Resting three quarter turn for the picker grid. */
const SIDE_POSE: BotLook = { x: 8, y: -5, tilt: -8 };
const motion = { reduceMotion: ReduceMotion.System };

type ShapeProps = {
  readonly avatar: BotAvatarValue;
  readonly size: number;
  /** "side" rests turned three quarters until selected. */
  readonly pose?: "side" | "front";
  /** Springs in from a side on mount; callers remount it when the avatar changes. */
  readonly enter?: boolean;
};

// The body tilts while the face slides and squashes toward the look, which reads as a
// 3D head turn. Every motion is one-shot; nothing animates while the avatar is idle.
function BotAvatarShapeMotion(props: ShapeProps) {
  const { path, color, eyes } = resolveBotAvatar(props.avatar);
  const side = props.size * 0.64;
  const unit = side / 100;
  const reducedMotion = useReducedMotion();
  const enterLook = botAvatarLookFor(`${props.avatar.shape}:${props.avatar.color}`);
  const posed = props.pose === "side";
  const [closed, setClosed] = useState(false);
  const look = useSharedValue<BotLook>(posed ? SIDE_POSE : enterLook);
  const turn = useSharedValue(posed || (props.enter && !reducedMotion) ? 1 : 0);
  const enter = useSharedValue(props.enter && !reducedMotion ? 0 : 1);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays the one-shot entrance on mount
  useEffect(() => {
    if (!props.enter || reducedMotion) return;
    enter.set(withSpring(1, { damping: 12, stiffness: 170, ...motion }));
    turn.set(withDelay(380, withTiming(0, { duration: 420, ...motion })));
  }, [enter, turn, props.enter, reducedMotion]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- eases between the side pose and facing front
  useEffect(() => {
    if (props.pose === undefined) return;
    look.set(SIDE_POSE);
    turn.set(withTiming(posed ? 1 : 0, { duration: 220, ...motion }));
  }, [look, turn, posed, props.pose]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- joins the shared motion timer
  useEffect(() => {
    if (reducedMotion) return;
    return registerBotMotion((next) => {
      // A posed avatar keeps its pose, so it only blinks.
      if (next._tag === "blink" || props.pose !== undefined) {
        setClosed(true);
        setTimeout(() => setClosed(false), 160);
        return;
      }
      look.set(next.look);
      turn.set(
        withSequence(
          withTiming(1, { duration: 300, ...motion }),
          withDelay(680, withTiming(0, { duration: 420, ...motion })),
        ),
      );
    });
  }, [look, turn, reducedMotion, props.pose]);

  const bodyStyle = useAnimatedStyle(() => {
    const from = 1 - enter.value;
    return {
      opacity: Math.min(1, enter.value * 2.5),
      transform: [
        { translateX: -look.value.x * 2.5 * unit * from },
        { translateY: -look.value.y * 2.5 * unit * from },
        { rotate: `${look.value.tilt * (turn.value - 3 * from)}deg` },
        { scale: 1 - 0.5 * from },
        { scaleX: 1 - 0.05 * turn.value },
      ],
    };
  });
  const faceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: look.value.x * unit * turn.value },
      { translateY: look.value.y * unit * turn.value },
      { skewX: `${-Math.sign(look.value.x) * 10 * turn.value}deg` },
      { scaleX: 1 - 0.2 * turn.value },
    ],
  }));

  return (
    <Animated.View style={[{ width: side, height: side }, bodyStyle]}>
      <Svg width={side} height={side} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <Path d={path} fill={color} fillRule="nonzero" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, faceStyle]}>
        <Svg width={side} height={side} viewBox="0 0 100 100">
          <G fill={BOT_AVATAR_EYE_COLOR}>
            {eyes.map((eye) => (
              <Ellipse
                key={eye.cx}
                cx={eye.cx}
                cy={eye.cy}
                rx={eye.rx}
                ry={closed ? eye.ry * 0.12 : eye.ry}
              />
            ))}
          </G>
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

function BotAvatarShape(props: ShapeProps) {
  // A new key remounts the drawing so a changed avatar springs in again.
  return (
    <BotAvatarShapeMotion
      key={props.enter ? `${props.avatar.shape}:${props.avatar.color}` : undefined}
      {...props}
    />
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
  readonly pose?: ShapeProps["pose"];
  /** Springs in again whenever the shape or color changes. */
  readonly animateChanges?: boolean;
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
        <BotAvatarShape
          avatar={props.avatar}
          size={props.size}
          {...(props.pose ? { pose: props.pose } : {})}
          enter={props.animateChanges ?? false}
        />
      )}
    </View>
  );
}
