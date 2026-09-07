import { CheckIcon, ImagePlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BACKGROUND_PRESETS } from "../../backgroundPresets";
import {
  DEFAULT_WORKSPACE_BACKGROUND,
  prepareBackgroundImage,
  type WorkspaceBackground,
} from "../../workspaceBackground";
import {
  BackgroundImage,
  useBackgroundImage,
  useWorkspaceBackground,
} from "../WorkspaceBackground";
import { Button } from "../ui/button";
import { SettingsSection } from "./settingsLayout";

function BackgroundEditor({ initial }: { initial: WorkspaceBackground }) {
  const { save, error: storageError } = useWorkspaceBackground();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const image = useBackgroundImage(draft);
  const preset = BACKGROUND_PRESETS.find((item) => item.id === draft.selection);
  function change(patch: Partial<WorkspaceBackground>) {
    setDraft((value) => ({ ...value, ...patch }));
    setSaved(false);
    setError(null);
  }
  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const customImage = await prepareBackgroundImage(file);
      if (mounted.current) change({ customImage, selection: "custom" });
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : "Could not open this image.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await save(draft);
      if (mounted.current) setSaved(true);
    } catch (error) {
      if (mounted.current)
        setError(error instanceof Error ? error.message : "Could not save the background.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 px-3 pb-4 sm:px-4 xl:grid-cols-2">
      <div
        aria-label="Workspace background preview"
        className="relative isolate aspect-video self-start overflow-hidden rounded-lg border border-border bg-background xl:sticky xl:top-6"
      >
        {image && image !== failedImage ? (
          <BackgroundImage
            image={image}
            background={draft}
            alt={preset?.name ?? "Custom background"}
            onError={() => setFailedImage(image)}
          />
        ) : null}
        <div className="relative flex h-full text-foreground">
          <div className="w-1/4 space-y-3 border-r border-white/10 bg-background/40 p-3 sm:p-5">
            <div className="text-xs font-medium">T3 Code</div>
            <div className="h-1.5 w-4/5 rounded bg-foreground/20" />
            <div className="h-1.5 w-3/5 rounded bg-foreground/15" />
            <div className="h-1.5 w-2/3 rounded bg-foreground/15" />
          </div>
          <div className="flex flex-1 flex-col justify-between p-4 sm:p-6">
            <span className="text-xs font-medium">New thread</span>
            <div className="space-y-2">
              <p className="text-sm font-medium">What would you like to build?</p>
              <div className="rounded-lg border border-border bg-background/80 p-3 text-xs text-muted-foreground">
                Ask anything...
              </div>
            </div>
          </div>
        </div>
      </div>
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <legend className="sr-only">Background image</legend>
        <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto p-1">
          <button
            type="button"
            aria-pressed={draft.selection === null}
            onClick={() => change({ selection: null })}
            className="background-preset"
          >
            <span className="flex aspect-video items-center justify-center bg-background text-muted-foreground">
              <XIcon className="size-5" />
            </span>
            <span className="background-preset-label">None</span>
          </button>
          {BACKGROUND_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={draft.selection === item.id}
              onClick={() => change({ selection: item.id })}
              className="background-preset"
            >
              <img
                src={item.thumbnail}
                alt=""
                loading="lazy"
                className="aspect-video w-full object-cover"
              />
              <span className="background-preset-label">{item.name}</span>
              {draft.selection === item.id ? (
                <CheckIcon className="absolute right-2 top-2 size-4 rounded-full bg-black/70 text-white" />
              ) : null}
            </button>
          ))}
          {draft.customImage ? (
            <button
              type="button"
              aria-pressed={draft.selection === "custom"}
              onClick={() => change({ selection: "custom" })}
              className="background-preset"
            >
              <span className="flex aspect-video items-center justify-center bg-background">
                <ImagePlusIcon className="size-5" />
              </span>
              <span className="background-preset-label">Your image</span>
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
            <ImagePlusIcon className="size-4" />
            Upload image
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Upload background image"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void upload(file);
            }}
          />
          {draft.customImage ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                change({
                  customImage: null,
                  selection: draft.selection === "custom" ? null : draft.selection,
                })
              }
            >
              Remove upload
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            JPEG, PNG, WebP · Up to 20 MB · Saved on this device
          </span>
        </div>
        {draft.selection ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-3 text-sm">
              Brightness
              <input
                type="range"
                min={10}
                max={80}
                value={draft.brightness}
                onChange={(event) => change({ brightness: Number(event.currentTarget.value) })}
                className="w-28 accent-primary"
              />
              <output className="w-9 text-xs tabular-nums text-muted-foreground">
                {draft.brightness}%
              </output>
            </label>
            <label className="flex items-center gap-3 text-sm">
              Blur
              <input
                type="range"
                min={0}
                max={24}
                value={draft.blur}
                onChange={(event) => change({ blur: Number(event.currentTarget.value) })}
                className="w-28 accent-primary"
              />
              <output className="w-9 text-xs tabular-nums text-muted-foreground">
                {draft.blur}px
              </output>
            </label>
            <label className="flex items-center gap-3 text-sm">
              Gradient
              <input
                type="range"
                min={0}
                max={100}
                value={draft.gradient}
                onChange={(event) => change({ gradient: Number(event.currentTarget.value) })}
                className="w-28 accent-primary"
              />
              <output className="w-9 text-xs tabular-nums text-muted-foreground">
                {draft.gradient}%
              </output>
            </label>
            <label className="flex items-center gap-3 text-sm">
              Fit
              <select
                value={draft.fit}
                onChange={(event) =>
                  change({ fit: event.currentTarget.value === "contain" ? "contain" : "cover" })
                }
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="cover">Fill screen</option>
                <option value="contain">Fit image</option>
              </select>
            </label>
          </div>
        ) : null}
        {preset ? (
          <p className="text-xs text-muted-foreground">
            <a
              href={preset.source}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {preset.credit}
            </a>{" "}
            · {preset.width} × {preset.height}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void apply()}
            disabled={Boolean(image && image === failedImage)}
          >
            Apply background
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(initial);
              setSaved(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(DEFAULT_WORKSPACE_BACKGROUND);
              setSaved(false);
            }}
          >
            Reset
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            {saved ? "Background saved" : ""}
          </span>
        </div>
      </fieldset>
      {busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Saving image...
        </p>
      ) : null}
      {error || storageError || (image && image === failedImage) ? (
        <p role="alert" className="text-sm text-destructive">
          {error ?? storageError ?? "This background could not be loaded. Choose another image."}
        </p>
      ) : null}
    </div>
  );
}

export function WorkspaceBackgroundSection() {
  const { background, ready } = useWorkspaceBackground();
  return (
    <SettingsSection id="workspace-background" title="Background">
      {ready ? (
        <BackgroundEditor initial={background} />
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">Loading background...</p>
      )}
    </SettingsSection>
  );
}
