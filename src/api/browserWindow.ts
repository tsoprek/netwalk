let nextBrowserWindowId = 1;

function assertLoopbackBrowserUrl(raw: string): URL {
  const url = new URL(raw);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "http:" || !loopback) {
    throw new Error("External ConnCat browser windows require a local ConnCat proxy URL.");
  }
  return url;
}

/** Open a broker-backed Browse URL in its own ConnCat-owned native window. */
export async function openConnCatBrowserWindow(rawUrl: string, title: string): Promise<void> {
  const url = assertLoopbackBrowserUrl(rawUrl).toString();
  const windowTitle = title.trim() || "ConnCat Browser";
  const isTauri = typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `catwalk-browser-${Date.now()}-${nextBrowserWindowId++}`;
  const browser = new WebviewWindow(label, {
    url,
    title: windowTitle,
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    center: true,
    focus: true,
    resizable: true,
    dragDropEnabled: false,
    javascriptDisabled: false,
  });

  await new Promise<void>((resolve, reject) => {
    void browser.once("tauri://created", () => resolve());
    void browser.once("tauri://error", (event) => {
      reject(new Error(String(event.payload || "Failed to open ConnCat browser window.")));
    });
  });
}
