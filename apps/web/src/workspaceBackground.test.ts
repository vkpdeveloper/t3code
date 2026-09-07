import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  backgroundImageDimensions,
  backgroundStorage,
  decodeWorkspaceBackground,
  DEFAULT_WORKSPACE_BACKGROUND,
  prepareBackgroundImage,
} from "./workspaceBackground";

afterEach(() => vi.unstubAllGlobals());

describe("workspace backgrounds", () => {
  it("ignores unknown presets and unavailable uploads when restoring storage", () => {
    expect(decodeWorkspaceBackground(null)).toEqual(DEFAULT_WORKSPACE_BACKGROUND);
    expect(decodeWorkspaceBackground({ selection: "deleted-preset" }).selection).toBeNull();
    expect(
      decodeWorkspaceBackground({ selection: "custom", customImage: "blob:expired" }).selection,
    ).toBeNull();
  });
  it("restores a saved custom image and bounds malformed display settings", () => {
    const customImage = new Blob(["image"], { type: "image/webp" });
    expect(
      decodeWorkspaceBackground({
        selection: "custom",
        customImage,
        brightness: 500,
        fit: "contain",
      }),
    ).toEqual({
      ...DEFAULT_WORKSPACE_BACKGROUND,
      selection: "custom",
      customImage,
      brightness: 80,
      fit: "contain",
    });
    expect(
      decodeWorkspaceBackground({ selection: "loki", brightness: NaN, fit: "stretch" }),
    ).toMatchObject({ selection: "loki", brightness: 35, fit: "cover" });
  });
  it("restores blur and gradient and rejects invalid values", () => {
    expect(decodeWorkspaceBackground({ blur: 12, gradient: 75 })).toMatchObject({
      blur: 12,
      gradient: 75,
    });
    expect(decodeWorkspaceBackground({ blur: -2, gradient: 150 })).toMatchObject({
      blur: 0,
      gradient: 100,
    });
    expect(decodeWorkspaceBackground({ blur: Infinity, gradient: NaN })).toMatchObject({
      blur: 0,
      gradient: 0,
    });
  });
  it("keeps portrait and ultrawide proportions without upscaling", () => {
    expect(backgroundImageDimensions(8000, 4500)).toEqual({ width: 3840, height: 2160 });
    expect(backgroundImageDimensions(2000, 8000)).toEqual({ width: 960, height: 3840 });
    expect(backgroundImageDimensions(7680, 2160)).toEqual({ width: 3840, height: 1080 });
    expect(backgroundImageDimensions(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it("rejects unsupported and oversized uploads before decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(
      prepareBackgroundImage(new File(["<svg/>"], "test.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("JPEG, PNG, or WebP");
    const large = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await expect(prepareBackgroundImage(large)).rejects.toThrow("20 MB");
    expect(decode).not.toHaveBeenCalled();
  });
  it("reports corrupt images and releases decoded pixels when encoding fails", async () => {
    const file = new File(["invalid"], "image.png", { type: "image/png" });
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));
    await expect(prepareBackgroundImage(file)).rejects.toThrow("could not be read");
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 8000, height: 4500, close }),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (callback: BlobCallback) => callback(null),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    await expect(prepareBackgroundImage(file)).rejects.toThrow("could not be saved");
    expect(canvas.width).toBe(3840);
    expect(canvas.height).toBe(2160);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("background persistence", () => {
  function setupStorage() {
    const transaction = new EventTarget();
    const put = vi.fn();
    const close = vi.fn();
    const readRequest = new (class extends EventTarget {
      result: unknown = undefined;
    })();
    const database = {
      transaction: () => {
        return {
          addEventListener: transaction.addEventListener.bind(transaction),
          objectStore: () => ({ put, get: () => readRequest }),
        };
      },
      close,
    };
    const openRequest = new (class extends EventTarget {
      result = database;
    })();
    vi.stubGlobal("indexedDB", { open: () => openRequest });
    return { transaction, put, close, openRequest, readRequest };
  }

  it("does not report a saved selection until the image transaction commits", async () => {
    const storage = setupStorage();
    const value = { ...DEFAULT_WORKSPACE_BACKGROUND, selection: "loki" };
    let saved = false;
    const pending = backgroundStorage("write", value).then((result) => {
      saved = true;
      return result;
    });
    storage.openRequest.dispatchEvent(new Event("success"));
    await Promise.resolve();
    expect(storage.put).toHaveBeenCalledWith(value, "current");
    expect(saved).toBe(false);
    storage.transaction.dispatchEvent(new Event("complete"));
    await expect(pending).resolves.toEqual(value);
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it("rejects aborted writes and closes the database", async () => {
    const storage = setupStorage();
    const pending = backgroundStorage("write", DEFAULT_WORKSPACE_BACKGROUND);
    storage.openRequest.dispatchEvent(new Event("success"));
    await Promise.resolve();
    storage.transaction.dispatchEvent(new Event("abort"));
    await expect(pending).rejects.toThrow("interrupted");
    expect(storage.close).toHaveBeenCalledOnce();
  });

  it("restores stored settings through the validation boundary", async () => {
    const storage = setupStorage();
    const pending = backgroundStorage("read");
    storage.openRequest.dispatchEvent(new Event("success"));
    await Promise.resolve();
    storage.readRequest.result = { selection: "missing", brightness: -10 };
    storage.readRequest.dispatchEvent(new Event("success"));
    storage.transaction.dispatchEvent(new Event("complete"));
    await expect(pending).resolves.toMatchObject({ selection: null, brightness: 10 });
    expect(storage.close).toHaveBeenCalledOnce();
  });
});
