const BLINK_EVERY_MS = 2600;
const BLINK_MS = 160;

const blinkers = new Set<(closed: boolean) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

// One shared timer blinks a single avatar at a time, so a long list costs one
// small re-render every few seconds rather than a running animation per row.
function blinkOne() {
  const all = [...blinkers];
  const blink = all[Math.floor(Math.random() * all.length)];
  if (!blink) return;
  blink(true);
  setTimeout(() => blink(false), BLINK_MS);
}

export function registerBotBlink(setClosed: (closed: boolean) => void) {
  blinkers.add(setClosed);
  timer ??= setInterval(blinkOne, BLINK_EVERY_MS);
  return () => {
    blinkers.delete(setClosed);
    if (blinkers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
