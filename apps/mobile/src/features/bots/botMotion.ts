import { BOT_AVATAR_LOOKS } from "@t3tools/client-runtime/bot-avatar";

export type BotLook = { readonly x: number; readonly y: number; readonly tilt: number };
type Motion = { readonly _tag: "blink" } | { readonly _tag: "look"; readonly look: BotLook };

const EVERY_MS = 2200;
const avatars = new Set<(motion: Motion) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

// One shared timer moves a single avatar at a time, so a long list costs one
// small animation every few seconds rather than a running animation per row.
function moveOne() {
  const all = [...avatars];
  const move = all[Math.floor(Math.random() * all.length)];
  const look = BOT_AVATAR_LOOKS[Math.floor(Math.random() * BOT_AVATAR_LOOKS.length)];
  if (!move || !look) return;
  move(Math.random() < 0.5 ? { _tag: "blink" } : { _tag: "look", look });
}

export function registerBotMotion(onMotion: (motion: Motion) => void) {
  avatars.add(onMotion);
  timer ??= setInterval(moveOne, EVERY_MS);
  return () => {
    avatars.delete(onMotion);
    if (avatars.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
