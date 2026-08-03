import type { WebglAddon } from "@xterm/addon-webgl";

type LoseContextExtension = { loseContext: () => void };
type WebglAddonInternals = {
  _renderer?: {
    _gl?: WebGL2RenderingContext;
  };
};

/**
 * Snapshot canvas elements before a renderer tears down its DOM. WebKit can
 * retain the IOSurface behind a detached canvas even after the owning
 * library has removed the element, so the elements must be captured while
 * they are still reachable.
 */
export function captureCanvasBackingStores(root: ParentNode): HTMLCanvasElement[] {
  return Array.from(root.querySelectorAll("canvas"));
}

export function canvasBackingStorePixels(canvases: readonly HTMLCanvasElement[]): number {
  return canvases.reduce(
    (total, canvas) => total + Math.max(0, canvas.width) * Math.max(0, canvas.height),
    0,
  );
}

/**
 * Collapse captured canvas buffers after the renderer has released its own
 * references. Setting the bitmap to 1x1 is the portable signal that releases
 * the large graphics backing store; removing the node is appropriate when
 * the whole renderer/session is being destroyed.
 */
export function releaseCanvasBackingStores(
  canvases: readonly HTMLCanvasElement[],
  remove = false,
): number {
  let released = 0;
  for (const canvas of canvases) {
    try {
      canvas.width = 1;
      canvas.height = 1;
      released += 1;
    } catch {
      // A renderer may already have invalidated its canvas during disposal.
    }
    if (remove) {
      try { canvas.remove(); } catch { /* already detached */ }
    }
  }
  return released;
}

/**
 * Capture the WebGL context before xterm disposes its private renderer.
 *
 * xterm removes the canvas and releases its buffers, but it does not invoke
 * WEBGL_lose_context. WebKit can consequently retain the IOSurface backing
 * store for every renderer that has existed. Explicitly losing the context
 * after xterm's normal disposal lets macOS reclaim those surfaces promptly.
 */
export function prepareWebglContextRelease(addon: WebglAddon | null | undefined): () => void {
  let extension: LoseContextExtension | null = null;
  try {
    const renderer = (addon as unknown as WebglAddonInternals | undefined)?._renderer;
    extension = renderer?._gl?.getExtension("WEBGL_lose_context") ?? null;
  } catch {
    extension = null;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { extension?.loseContext(); } catch { /* WebGL context already gone */ }
    extension = null;
  };
}

export function disposeWebglAddonAndContext(addon: WebglAddon | null | undefined): void {
  if (!addon) return;
  const releaseContext = prepareWebglContextRelease(addon);
  try { addon.dispose(); } catch { /* fallback renderer remains available */ }
  finally { releaseContext(); }
}
