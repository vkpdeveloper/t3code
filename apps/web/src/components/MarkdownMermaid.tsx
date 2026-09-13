import { useEffect, useState } from "react";
import { fnv1a32 } from "../lib/diffRendering";
import { LRUCache } from "../lib/lruCache";

type MermaidTheme = "light" | "dark";

/**
 * Rendered diagrams are cached by content and theme so re-mounting a message
 * (virtualized lists, thread switches) never re-runs the layout engine.
 */
const MAX_MERMAID_CACHE_ENTRIES = 200;
const MAX_MERMAID_CACHE_MEMORY_BYTES = 20 * 1024 * 1024;
const mermaidSvgCache = new LRUCache<string>(
  MAX_MERMAID_CACHE_ENTRIES,
  MAX_MERMAID_CACHE_MEMORY_BYTES,
);
const inflightRenders = new Map<string, Promise<string>>();

let mermaidModulePromise: Promise<(typeof import("mermaid"))["default"]> | null = null;
let initializedTheme: MermaidTheme | null = null;
let renderSequence = 0;

/** Mermaid is ~2MB, so it only loads the first time a diagram is rendered. */
function loadMermaid() {
  mermaidModulePromise ??= import("mermaid").then((module) => module.default);
  return mermaidModulePromise;
}

function mermaidCacheKey(code: string, theme: MermaidTheme): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${theme}`;
}

export function renderMermaidSvg(code: string, theme: MermaidTheme): Promise<string> {
  const cacheKey = mermaidCacheKey(code, theme);
  const cached = mermaidSvgCache.get(cacheKey);
  if (cached !== null) {
    return Promise.resolve(cached);
  }
  const inflight = inflightRenders.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const renderPromise = loadMermaid()
    .then(async (mermaid) => {
      // `initialize` is global, so theme changes re-run it for every later render.
      if (initializedTheme !== theme) {
        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        initializedTheme = theme;
      }
      renderSequence += 1;
      const renderId = `chat-mermaid-${renderSequence}`;
      try {
        const { svg } = await mermaid.render(renderId, code);
        mermaidSvgCache.set(cacheKey, svg, svg.length * 2);
        return svg;
      } finally {
        // Mermaid parks a scratch element in the body when parsing fails.
        document.getElementById(`d${renderId}`)?.remove();
      }
    })
    .finally(() => {
      inflightRenders.delete(cacheKey);
    });
  inflightRenders.set(cacheKey, renderPromise);
  return renderPromise;
}

type MermaidRenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export function useMermaidSvg(code: string, theme: MermaidTheme): MermaidRenderState {
  const cacheKey = mermaidCacheKey(code, theme);
  const [state, setState] = useState<MermaidRenderState & { cacheKey: string }>(() => {
    const cached = mermaidSvgCache.get(cacheKey);
    return cached !== null
      ? { status: "ready", svg: cached, cacheKey }
      : { status: "loading", cacheKey };
  });

  useEffect(() => {
    let cancelled = false;
    renderMermaidSvg(code, theme)
      .then((svg) => {
        if (!cancelled) setState({ status: "ready", svg, cacheKey });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Mermaid parse errors span many lines of token expectations; the first line is enough.
        const message =
          (cause instanceof Error ? cause.message : String(cause)).split("\n")[0] ?? "";
        setState({ status: "error", message, cacheKey });
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, theme]);

  // A stale result from a previous code/theme must not flash before the effect runs.
  if (state.cacheKey !== cacheKey) {
    const cached = mermaidSvgCache.get(cacheKey);
    return cached !== null ? { status: "ready", svg: cached } : { status: "loading" };
  }
  return state;
}

export function MermaidDiagram({ svg }: { svg: string }) {
  return (
    <div
      className="chat-markdown-mermaid overflow-x-auto px-3 py-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
