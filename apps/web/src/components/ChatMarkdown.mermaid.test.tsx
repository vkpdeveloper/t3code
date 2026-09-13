import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useSettings")>();
  const settings = actual.getClientSettings();
  return {
    ...actual,
    useClientSettings: (select?: (value: typeof settings) => unknown) =>
      select ? select(settings) : settings,
  };
});
vi.mock("./ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("./ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Loading" }),
}));
vi.mock("../state/entities", () => ({
  readThreadShell: () => null,
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("../remoteOpen", () => ({
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", () => ({
  useOpenInPreferredEditor: () => vi.fn(),
  usePreferredEditor: () => [null, vi.fn()],
}));
vi.mock("~/lib/openPullRequestLink", () => ({
  findProjectOnChangeRequestHost: () => undefined,
  parseChangeRequestUrl: () => null,
  useOpenChangeRequestLink: () => vi.fn(),
}));

vi.mock("./MarkdownMermaid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./MarkdownMermaid")>()),
  useMermaidSvg: (code: string) => mermaidState(code),
}));

import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import type { useMermaidSvg } from "./MarkdownMermaid";

let mermaidState: (code: string) => ReturnType<typeof useMermaidSvg> = () => ({
  status: "loading",
});

const FENCE = "```mermaid\nflowchart TD\n  A --> B\n```";

function codeButton(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType(Button)
    .find((instance) => instance.props["aria-label"] === label)?.props as
    | ComponentProps<typeof Button>
    | undefined;
}

function diagrams(renderer: ReactTestRenderer) {
  return renderer.root.findAll(
    (instance) =>
      typeof instance.props.className === "string" &&
      instance.props.className.split(" ").includes("chat-markdown-mermaid"),
  );
}

describe("ChatMarkdown mermaid", () => {
  it("shows source while streaming and swaps to the diagram once complete", async () => {
    const rendered = vi.fn((code: string) => ({
      status: "ready" as const,
      svg: `<svg>${code.length}</svg>`,
    }));
    mermaidState = rendered;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<ChatMarkdown cwd="/tmp/project" text={FENCE} isStreaming />);
      });
      expect(rendered).not.toHaveBeenCalled();
      expect(diagrams(renderer!)).toHaveLength(0);
      expect(renderer!.root.findAllByProps({ className: "chat-markdown-shiki" })).toHaveLength(1);
      expect(codeButton(renderer!, "Show source")).toBeUndefined();

      await act(async () => {
        renderer!.update(<ChatMarkdown cwd="/tmp/project" text={FENCE} />);
      });
      expect(rendered).toHaveBeenCalledWith("flowchart TD\n  A --> B\n");
      expect(diagrams(renderer!)).toHaveLength(1);
      expect(renderer!.root.findAllByProps({ className: "chat-markdown-shiki" })).toHaveLength(0);
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("toggles between diagram and source", async () => {
    mermaidState = () => ({ status: "ready", svg: "<svg></svg>" });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<ChatMarkdown cwd="/tmp/project" text={FENCE} />);
      });
      const toggle = codeButton(renderer!, "Show source");
      if (!toggle) throw new Error("Missing diagram toggle");
      await act(async () => {
        toggle.onClick?.({} as Parameters<NonNullable<typeof toggle.onClick>>[0]);
      });
      expect(diagrams(renderer!)).toHaveLength(0);
      expect(renderer!.root.findAllByProps({ className: "chat-markdown-shiki" })).toHaveLength(1);
      expect(codeButton(renderer!, "Show diagram")).toBeDefined();
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });

  it("falls back to source with the parse error when rendering fails", async () => {
    mermaidState = () => ({ status: "error", message: "Parse error on line 2" });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = create(<ChatMarkdown cwd="/tmp/project" text={FENCE} />);
      });
      expect(diagrams(renderer!)).toHaveLength(0);
      expect(renderer!.root.findAllByProps({ className: "chat-markdown-shiki" })).toHaveLength(1);
      expect(codeButton(renderer!, "Show source")).toBeUndefined();
      expect(JSON.stringify(renderer!.toJSON())).toContain("Parse error on line 2");
    } finally {
      await act(async () => renderer?.unmount());
      vi.unstubAllGlobals();
    }
  });
});
