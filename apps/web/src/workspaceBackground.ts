import { BACKGROUND_PRESETS } from "./backgroundPresets";

export interface WorkspaceBackground {
  selection: string | null;
  brightness: number;
  blur: number;
  gradient: number;
  fit: "cover" | "contain";
  customImage: Blob | null;
}

export const DEFAULT_WORKSPACE_BACKGROUND: WorkspaceBackground = {
  selection: null,
  brightness: 35,
  blur: 0,
  gradient: 0,
  fit: "cover",
  customImage: null,
};

export function decodeWorkspaceBackground(value: unknown): WorkspaceBackground {
  if (!value || typeof value !== "object") return DEFAULT_WORKSPACE_BACKGROUND;
  const customImage =
    "customImage" in value && value.customImage instanceof Blob ? value.customImage : null;
  const selection =
    "selection" in value &&
    typeof value.selection === "string" &&
    (value.selection === "custom"
      ? customImage !== null
      : BACKGROUND_PRESETS.some((preset) => preset.id === value.selection))
      ? value.selection
      : null;
  return {
    selection,
    brightness:
      "brightness" in value &&
      typeof value.brightness === "number" &&
      Number.isFinite(value.brightness)
        ? Math.max(10, Math.min(80, value.brightness))
        : 35,
    blur:
      "blur" in value && typeof value.blur === "number" && Number.isFinite(value.blur)
        ? Math.max(0, Math.min(24, value.blur))
        : 0,
    gradient:
      "gradient" in value && typeof value.gradient === "number" && Number.isFinite(value.gradient)
        ? Math.max(0, Math.min(100, value.gradient))
        : 0,
    fit: "fit" in value && value.fit === "contain" ? "contain" : "cover",
    customImage,
  };
}

export function backgroundImageDimensions(width: number, height: number) {
  const scale = Math.min(1, 3840 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Decode and flatten uploads once, keeping animation and oversized textures out of the shell. */
export async function prepareBackgroundImage(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("This image could not be read. Try another file.");
  });
  try {
    const { width, height } = backgroundImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("This image could not be saved."))),
        "image/webp",
        0.88,
      );
    });
  } finally {
    bitmap.close();
  }
}

/** Store the image and its selection atomically, outside the small localStorage quota. */
export async function backgroundStorage(
  action: "read" | "write",
  value?: WorkspaceBackground,
): Promise<WorkspaceBackground> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("t3code:workspace-background", 1);
    request.addEventListener("upgradeneeded", () => request.result.createObjectStore("background"));
    request.addEventListener("success", () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    });
    request.addEventListener("error", () =>
      reject(new Error("Background storage is unavailable.")),
    );
    request.addEventListener("blocked", () => {
      blocked = true;
      reject(new Error("Close other T3 tabs and try again."));
    });
  });
  try {
    return await new Promise<WorkspaceBackground>((resolve, reject) => {
      const transaction = database.transaction(
        "background",
        action === "read" ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("background");
      let result = DEFAULT_WORKSPACE_BACKGROUND;
      if (action === "read") {
        const request = store.get("current");
        request.addEventListener("success", () => {
          result = decodeWorkspaceBackground(request.result);
        });
      } else if (value) {
        store.put(value, "current");
        result = value;
      }
      transaction.addEventListener("complete", () => resolve(result));
      transaction.addEventListener("error", () =>
        reject(new Error("Could not save the background. Check available device storage.")),
      );
      transaction.addEventListener("abort", () =>
        reject(new Error("Background storage was interrupted. Try again.")),
      );
    });
  } finally {
    database.close();
  }
}
