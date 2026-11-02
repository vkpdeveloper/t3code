import type { SVGProps } from "react";

/** The Bots glyph: a round face with two pill eyes, drawn in currentColor like a lucide icon. */
export function BotFaceIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20ZM7.4 10a1.6 1.6 0 0 1 3.2 0v3.2a1.6 1.6 0 0 1-3.2 0ZM13.4 10a1.6 1.6 0 0 1 3.2 0v3.2a1.6 1.6 0 0 1-3.2 0Z"
      />
    </svg>
  );
}
