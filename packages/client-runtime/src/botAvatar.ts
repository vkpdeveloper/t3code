import type { BotAvatarColor, BotAvatarShape } from "@t3tools/contracts";

/** SVG path data on a 100x100 view box. Overlapping subpaths fill with the nonzero rule. */
const BOT_AVATAR_SHAPE_PATHS: Record<BotAvatarShape, string> = {
  circle: "M8.0 50.0a42 42 0 1 0 84 0a42 42 0 1 0 -84 0Z",
  cloud:
    "M12.0 58.0a22 22 0 1 0 44 0a22 22 0 1 0 -44 0ZM30.0 44.0a26 26 0 1 0 52 0a26 26 0 1 0 -52 0ZM54.0 62.0a18 18 0 1 0 36 0a18 18 0 1 0 -36 0ZM34 62V80H72V62Z",
  diamond:
    "M62.9 16.9L83.1 37.1Q96 50 83.1 62.9L62.9 83.1Q50 96 37.1 83.1L16.9 62.9Q4 50 16.9 37.1L37.1 16.9Q50 4 62.9 16.9Z",
  star: "M55.9 14L58.2 18.6Q64.1 30.6 77.4 32.5L82.4 33.2Q95.7 35.2 86.1 44.5L82.4 48.1Q72.8 57.4 75.1 70.6L76 75.6Q78.2 88.8 66.4 82.6L61.8 80.2Q50 74 38.2 80.2L33.6 82.6Q21.8 88.8 24 75.6L24.9 70.6Q27.2 57.4 17.6 48.1L13.9 44.5Q4.3 35.2 17.6 33.2L22.6 32.5Q35.9 30.6 41.8 18.6L44.1 14Q50 2 55.9 14Z",
  flower:
    "M52.0 50.0a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM41.0 69.1a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM19.0 69.1a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM8.0 50.0a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM19.0 30.9a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM41.0 30.9a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM28.0 50.0a22 22 0 1 0 44 0a22 22 0 1 0 -44 0Z",
  heart:
    "M44 84C20 66 6 51 6 33C6 20 16 10 29 10C38 10 46 15 50 23C54 15 62 10 71 10C84 10 94 20 94 33C94 51 80 66 56 84C52 87 48 87 44 84Z",
  gear: "M56.5 11.3L56.5 11.3Q63 18.6 72.8 18L72.8 18Q82.5 17.5 82 27.2L82 27.2Q81.4 37 88.7 43.5L88.7 43.5Q96 50 88.7 56.5L88.7 56.5Q81.4 63 82 72.8L82 72.8Q82.5 82.5 72.8 82L72.8 82Q63 81.4 56.5 88.7L56.5 88.7Q50 96 43.5 88.7L43.5 88.7Q37 81.4 27.2 82L27.2 82Q17.5 82.5 18 72.8L18 72.8Q18.6 63 11.3 56.5L11.3 56.5Q4 50 11.3 43.5L11.3 43.5Q18.6 37 18 27.2L18 27.2Q17.5 17.5 27.2 18L27.2 18Q37 18.6 43.5 11.3L43.5 11.3Q50 4 56.5 11.3Z",
  drop: "M45 9C35 21 16 45 16 64C16 82 31 94 50 94C69 94 84 82 84 64C84 45 65 21 55 9C52 5.5 48 5.5 45 9Z",
  pill: "M30 26H70A24 24 0 0 1 70 74H30A24 24 0 0 1 30 26Z",
  triangle: "M62.2 27.3L84.8 66.7Q97 88 72.6 88L27.4 88Q3 88 15.2 66.7L37.8 27.3Q50 6 62.2 27.3Z",
  shield:
    "M62 8.2L78 13.8Q90 18 90 27.6L90 40.4Q90 50 78 63.8L62 82.2Q50 96 38 82.2L22 63.8Q10 50 10 40.4L10 27.6Q10 18 22 13.8L38 8.2Q50 4 62 8.2Z",
  burst:
    "M55.9 11.4L57.2 13.5Q63 23 74 21.7L76.5 21.4Q87.5 20.1 83.8 30.5L83 32.9Q79.2 43.3 87.1 51.1L88.9 52.9Q96.8 60.7 86.3 64.3L84 65.1Q73.5 68.7 72.3 79.7L72 82.2Q70.8 93.2 61.5 87.3L59.4 86Q50 80 40.6 86L38.5 87.3Q29.2 93.2 28 82.2L27.7 79.7Q26.5 68.7 16 65.1L13.7 64.3Q3.2 60.7 11.1 52.9L12.9 51.1Q20.8 43.3 17 32.9L16.2 30.5Q12.5 20.1 23.5 21.4L26 21.7Q37 23 42.8 13.5L44.1 11.4Q50 2 55.9 11.4Z",
  hexagon:
    "M60 9.8L79.9 21.3Q89.8 27 89.8 38.5L89.8 61.5Q89.8 73 79.9 78.8L60 90.3Q50 96 40 90.3L20.1 78.8Q10.2 73 10.2 61.5L10.2 38.5Q10.2 27 20.1 21.2L40 9.8Q50 4 60 9.8Z",
  pumpkin:
    "M10.0 60.0a23 30 0 1 0 46 0a23 30 0 1 0 -46 0ZM44.0 60.0a23 30 0 1 0 46 0a23 30 0 1 0 -46 0ZM28.0 60.0a22 32 0 1 0 44 0a22 32 0 1 0 -44 0ZM46 16a4 4 0 0 1 8 0V30H46Z",
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

/**
 * Ways an avatar can turn its head, in view box units and degrees. The face slides toward
 * (x, y) and squashes while the body tilts, which reads as a 3D turn on a flat drawing.
 */
export const BOT_AVATAR_LOOKS = [
  { x: 9, y: -6, tilt: 9 },
  { x: -9, y: -6, tilt: -9 },
  { x: 10, y: 4, tilt: 6 },
  { x: -10, y: 4, tilt: -6 },
  { x: 2, y: -9, tilt: 3 },
  { x: -3, y: 8, tilt: -4 },
] as const;

/** A stable look for a given avatar, so its entrance direction is the same on every render. */
export function botAvatarLookFor(key: string) {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return BOT_AVATAR_LOOKS[Math.abs(hash) % BOT_AVATAR_LOOKS.length] ?? BOT_AVATAR_LOOKS[0];
}

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
