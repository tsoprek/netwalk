import { describe, expect, it, vi } from "vitest";
import type { WebglAddon } from "@xterm/addon-webgl";
import {
  captureCanvasBackingStores,
  canvasBackingStorePixels,
  disposeWebglAddonAndContext,
  prepareWebglContextRelease,
  releaseCanvasBackingStores,
} from "./webglCleanup";

function fakeAddon() {
  const loseContext = vi.fn();
  const dispose = vi.fn();
  const addon = {
    dispose,
    _renderer: {
      _gl: { getExtension: vi.fn(() => ({ loseContext })) },
    },
  } as unknown as WebglAddon;
  return { addon, dispose, loseContext };
}

describe("webglCleanup", () => {
  it("disposes xterm before explicitly losing the WebGL context", () => {
    const { addon, dispose, loseContext } = fakeAddon();
    disposeWebglAddonAndContext(addon);
    expect(dispose).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce();
    expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(loseContext.mock.invocationCallOrder[0]);
  });

  it("captures a release handle that remains usable after terminal disposal", () => {
    const { addon, loseContext } = fakeAddon();
    const release = prepareWebglContextRelease(addon);
    release();
    release();
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("collapses canvas buffers captured before renderer disposal", () => {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 3840;
    canvas.height = 2160;
    root.appendChild(canvas);

    const captured = captureCanvasBackingStores(root);
    expect(canvasBackingStorePixels(captured)).toBe(3840 * 2160);
    canvas.remove();

    expect(releaseCanvasBackingStores(captured, true)).toBe(1);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(canvas.isConnected).toBe(false);
  });

  it("does not collapse canvases created after the snapshot", () => {
    const root = document.createElement("div");
    const oldCanvas = document.createElement("canvas");
    root.appendChild(oldCanvas);
    const captured = captureCanvasBackingStores(root);
    const replacement = document.createElement("canvas");
    replacement.width = 800;
    replacement.height = 600;
    root.appendChild(replacement);

    releaseCanvasBackingStores(captured);

    expect(replacement.width).toBe(800);
    expect(replacement.height).toBe(600);
  });
});
