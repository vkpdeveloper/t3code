import type { BotAvatarColor, BotAvatarShape } from "@t3tools/contracts";

/** SVG path data on a 100x100 view box. Overlapping subpaths fill with the nonzero rule. */
const BOT_AVATAR_SHAPE_PATHS: Record<BotAvatarShape, string> = {
  circle: "M8.0 50.0a42 42 0 1 0 84 0a42 42 0 1 0 -84 0Z",
  cloud:
    "M12.0 58.0a22 22 0 1 0 44 0a22 22 0 1 0 -44 0ZM30.0 44.0a26 26 0 1 0 52 0a26 26 0 1 0 -52 0ZM54.0 62.0a18 18 0 1 0 36 0a18 18 0 1 0 -36 0ZM34 62V80H72V62Z",
  diamond: "M50 6L92 50L50 94L8 50Z",
  star: "M50.0 8.0 L61.8 37.8 L93.7 39.8 L69.0 60.2 L77.0 91.2 L50.0 74.0 L23.0 91.2 L31.0 60.2 L6.3 39.8 L38.2 37.8Z",
  flower:
    "M52.0 50.0a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM41.0 69.1a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM19.0 69.1a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM8.0 50.0a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM19.0 30.9a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM41.0 30.9a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM28.0 50.0a22 22 0 1 0 44 0a22 22 0 1 0 -44 0Z",
  heart:
    "M50 88C22 68 6 52 6 33C6 20 16 10 29 10C38 10 46 15 50 23C54 15 62 10 71 10C84 10 94 20 94 33C94 52 78 68 50 88Z",
  gear: "M45.7 6.2 L54.3 6.2 L59.6 18.4 L65.6 20.9 L77.9 16.0 L84.0 22.1 L79.1 34.4 L81.6 40.4 L93.8 45.7 L93.8 54.3 L81.6 59.6 L79.1 65.6 L84.0 77.9 L77.9 84.0 L65.6 79.1 L59.6 81.6 L54.3 93.8 L45.7 93.8 L40.4 81.6 L34.4 79.1 L22.1 84.0 L16.0 77.9 L20.9 65.6 L18.4 59.6 L6.2 54.3 L6.2 45.7 L18.4 40.4 L20.9 34.4 L16.0 22.1 L22.1 16.0 L34.4 20.9 L40.4 18.4Z",
  drop: "M50 6C50 6 16 44 16 64C16 82 31 94 50 94C69 94 84 82 84 64C84 44 50 6 50 6Z",
  pill: "M30 26H70A24 24 0 0 1 70 74H30A24 24 0 0 1 30 26Z",
  triangle: "M50 10L93 86H7Z",
  shield: "M50 6L88 20V46C88 70 72 86 50 94C28 86 12 70 12 46V20Z",
  burst:
    "M50.0 4.0 L58.8 17.2 L73.0 10.2 L74.0 26.0 L89.8 27.0 L82.8 41.2 L96.0 50.0 L82.8 58.8 L89.8 73.0 L74.0 74.0 L73.0 89.8 L58.8 82.8 L50.0 96.0 L41.2 82.8 L27.0 89.8 L26.0 74.0 L10.2 73.0 L17.2 58.8 L4.0 50.0 L17.2 41.2 L10.2 27.0 L26.0 26.0 L27.0 10.2 L41.2 17.2Z",
  hexagon: "M50.0 6.0 L88.1 28.0 L88.1 72.0 L50.0 94.0 L11.9 72.0 L11.9 28.0Z",
  pumpkin:
    "M10.0 60.0a23 30 0 1 0 46 0a23 30 0 1 0 -46 0ZM44.0 60.0a23 30 0 1 0 46 0a23 30 0 1 0 -46 0ZM28.0 60.0a22 32 0 1 0 44 0a22 32 0 1 0 -44 0ZM46 12V30H54V12Z",
};

/** Where each shape's face sits: eye center line and half the distance between the eyes. */
const BOT_AVATAR_FACES: Record<BotAvatarShape, { x: number; y: number; gap: number }> = {
  circle: { x: 50, y: 48, gap: 13 },
  cloud: { x: 52, y: 56, gap: 10 },
  diamond: { x: 50, y: 48, gap: 10 },
  star: { x: 50, y: 56, gap: 8 },
  flower: { x: 50, y: 50, gap: 9 },
  heart: { x: 50, y: 42, gap: 12 },
  gear: { x: 50, y: 50, gap: 11 },
  drop: { x: 50, y: 64, gap: 11 },
  pill: { x: 50, y: 50, gap: 14 },
  triangle: { x: 50, y: 66, gap: 10 },
  shield: { x: 50, y: 44, gap: 11 },
  burst: { x: 50, y: 50, gap: 10 },
  hexagon: { x: 50, y: 50, gap: 13 },
  pumpkin: { x: 50, y: 62, gap: 11 },
};

export const BOT_AVATAR_EYE_COLOR = "#18181B";
const EYE_RX = 5.5;
const EYE_RY = 9;

export const BOT_AVATAR_COLOR_HEX: Record<BotAvatarColor, string> = {
  white: "#F4F4F5",
  brown: "#92643F",
  red: "#EF4444",
  orange: "#F97316",
  amber: "#F5B014",
  green: "#22C55E",
  teal: "#14B8A6",
  blue: "#3B82F6",
  purple: "#8B5CF6",
  pink: "#EC4899",
  gray: "#9CA3AF",
};

/** Unknown values from newer servers draw the default rather than nothing. */
export function resolveBotAvatar(avatar: { readonly shape: string; readonly color: string }) {
  const path = (BOT_AVATAR_SHAPE_PATHS as Record<string, string | undefined>)[avatar.shape];
  const color = (BOT_AVATAR_COLOR_HEX as Record<string, string | undefined>)[avatar.color];
  const face =
    (BOT_AVATAR_FACES as Record<string, (typeof BOT_AVATAR_FACES)[BotAvatarShape] | undefined>)[
      avatar.shape
    ] ?? BOT_AVATAR_FACES.circle;
  return {
    path: path ?? BOT_AVATAR_SHAPE_PATHS.circle,
    color: color ?? BOT_AVATAR_COLOR_HEX.gray,
    eyes: [
      { cx: face.x - face.gap, cy: face.y, rx: EYE_RX, ry: EYE_RY },
      { cx: face.x + face.gap, cy: face.y, rx: EYE_RX, ry: EYE_RY },
    ] as const,
  };
}
