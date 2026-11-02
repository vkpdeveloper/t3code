// One shared clock blinks a random avatar now and then. Idle avatars run no animation,
// so nothing repaints between blinks.
const eyes = new Set<SVGGElement>();
let timer: number | null = null;
const reducedMotion =
  typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");

function blinkOne() {
  if (document.hidden || reducedMotion?.matches || eyes.size === 0) return;
  const pick = [...eyes][Math.floor(Math.random() * eyes.size)];
  pick?.setAttribute("data-blink", "");
}

function stopBlink(event: Event) {
  (event.currentTarget as SVGGElement).removeAttribute("data-blink");
}

/** A ref callback for an avatar's eye group. */
export function registerBotEyes(element: SVGGElement) {
  eyes.add(element);
  element.addEventListener("animationend", stopBlink);
  timer ??= window.setInterval(blinkOne, 2600);
  return () => {
    eyes.delete(element);
    element.removeEventListener("animationend", stopBlink);
    if (eyes.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
