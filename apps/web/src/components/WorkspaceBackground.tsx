import {
  createContext,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BACKGROUND_PRESETS } from "../backgroundPresets";
import {
  backgroundStorage,
  DEFAULT_WORKSPACE_BACKGROUND,
  type WorkspaceBackground,
} from "../workspaceBackground";

const BackgroundContext = createContext<{
  background: WorkspaceBackground;
  ready: boolean;
  error: string | null;
  save: (background: WorkspaceBackground) => Promise<void>;
} | null>(null);

export function WorkspaceBackgroundProvider({ children }: { children: ReactNode }) {
  const [background, setBackground] = useState(DEFAULT_WORKSPACE_BACKGROUND);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void backgroundStorage("read")
      .then((value) => {
        if (active) setBackground(value);
      })
      .catch((error: unknown) => {
        if (active)
          setError(error instanceof Error ? error.message : "Could not load the background.");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const save = useCallback(async (value: WorkspaceBackground) => {
    const pending = queue.current.then(async () => {
      await backgroundStorage("write", value);
      setBackground(value);
      setError(null);
    });
    queue.current = pending.catch(() => undefined);
    return pending;
  }, []);
  const value = useMemo(
    () => ({ background, ready, error, save }),
    [background, ready, error, save],
  );
  return <BackgroundContext value={value}>{children}</BackgroundContext>;
}

export function useWorkspaceBackground() {
  const value = useContext(BackgroundContext);
  if (!value) throw new Error("Workspace background provider is missing.");
  return value;
}

export function useBackgroundImage(background: WorkspaceBackground) {
  const [customUrl, setCustomUrl] = useState<{ image: Blob; url: string } | null>(null);
  const image = background.selection === "custom" ? background.customImage : null;
  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(image);
    // The URL owns a browser resource, so create and revoke it in the same effect.
    // oxlint-disable-next-line react/set-state-in-effect
    setCustomUrl({ image, url });
    return () => URL.revokeObjectURL(url);
  }, [image]);
  return background.selection === "custom"
    ? customUrl?.image === image
      ? customUrl.url
      : null
    : (BACKGROUND_PRESETS.find((preset) => preset.id === background.selection)?.src ?? null);
}

export function WorkspaceBackgroundLayer() {
  const { background } = useWorkspaceBackground();
  const image = useBackgroundImage(background);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const visible = image !== null && failedImage !== image;
  useEffect(() => {
    if (visible) document.documentElement.dataset.workspaceBackground = "true";
    else delete document.documentElement.dataset.workspaceBackground;
    return () => {
      delete document.documentElement.dataset.workspaceBackground;
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <div aria-hidden="true" className="workspace-background-layer">
      <BackgroundImage
        image={image}
        background={background}
        onError={() => setFailedImage(image)}
      />
    </div>
  );
}

/** Preview and workspace share the same static image effects. */
export function BackgroundImage({
  image,
  background,
  onError,
  alt = "",
}: {
  image: string;
  background: WorkspaceBackground;
  onError: () => void;
  alt?: string;
}) {
  return (
    <>
      <img
        src={image}
        alt={alt}
        onError={onError}
        className="absolute inset-0 size-full"
        style={{
          objectFit: background.fit,
          opacity: background.brightness / 100,
          filter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
        }}
      />
      {background.gradient > 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, transparent 10%, color-mix(in srgb, var(--background) ${background.gradient}%, transparent))`,
          }}
        />
      ) : null}
    </>
  );
}
