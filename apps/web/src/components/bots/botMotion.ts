import { BOT_AVATAR_LOOKS } from "@t3tools/client-runtime/bot-avatar";

// One shared clock picks a random avatar now and then to blink or glance around. Each
// motion plays once, so idle avatars run no animation and nothing repaints between picks.
const avatars = new Set<SVGSVGElement>();
let timer: number | null = null;
const reducedMotion =
  typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");

/** Sets the CSS variables the look and entrance keyframes read. */
export function botLookStyle(look: (typeof BOT_AVATAR_LOOKS)[number]) {
  return {
    "--bot-look-x": `${look.x}px`,
    "--bot-look-y": `${look.y}px`,
    "--bot-look-skew": `${-Math.sign(look.x) * 10}deg`,
    "--bot-tilt": `${look.tilt}deg`,
  } as React.CSSProperties;
}

function moveOne() {
  if (document.hidden || reducedMotion?.matches || avatars.size === 0) return;
  const pick = [...avatars][Math.floor(Math.random() * avatars.size)];
  if (!pick || pick.hasAttribute("data-motion") || pick.hasAttribute("data-enter")) return;
  const look = BOT_AVATAR_LOOKS[Math.floor(Math.random() * BOT_AVATAR_LOOKS.length)];
  const motion = Math.random() < 0.5 || !look ? "blink" : "look";
  if (motion === "look" && look) {
    for (const [name, value] of Object.entries(botLookStyle(look))) {
      pick.style.setProperty(name, String(value));
    }
  }
  pick.setAttribute("data-motion", motion);
  // Cleared on a timer, not animationend: a blink set while hover already runs the same
  // animation never restarts, so it would never end. Durations match index.css.
  window.setTimeout(() => pick.removeAttribute("data-motion"), motion === "blink" ? 220 : 1420);
}

// Clearing the entrance keeps a later look from restarting it.
function endMotion(event: AnimationEvent) {
  if (event.animationName === "bot-enter-face") {
    (event.currentTarget as SVGSVGElement).removeAttribute("data-enter");
  }
}

/** A ref callback for an avatar's svg. */
export function registerBotAvatar(element: SVGSVGElement) {
  avatars.add(element);
  element.addEventListener("animationend", endMotion);
  timer ??= window.setInterval(moveOne, 2200);
  return () => {
    avatars.delete(element);
    element.removeEventListener("animationend", endMotion);
    if (avatars.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
