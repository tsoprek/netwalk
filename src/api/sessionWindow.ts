import { diagnosticEvent } from "./diagnostics";

export type SessionWindowLaunch =
  | { kind: "terminal"; options: Record<string, unknown>; ptyId?: number }
  | { kind: "terminal_group"; options: Record<string, unknown>[]; ptyIds?: number[] }
  | { kind: "browser"; url: string; title: string; webviewLabel?: string }
  | { kind: "vm"; vmId: string; title: string; username?: string; password?: string; webviewLabel?: string }
  | { kind: "cml"; labId: number; nodeId: string; title: string; username?: string; password?: string; webviewLabel?: string }
  | { kind: "rdp"; deviceId: string; title: string; username?: string; password?: string; webviewLabel?: string };

const STORAGE_PREFIX = "catwalk.sessionWindow.";
const ADOPTED_PREFIX = "catwalk.sessionWindowAdopted.";
const ADOPTION_EVENT = "catwalk:session-window-adoption";
export const MAIN_WINDOW_NAVIGATE_EVENT = "catwalk:main-window-navigate";
let nextSessionWindowId = 1;

export function isConnCatSessionWindow(): boolean {
  return typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("catwalkSessionWindow") === "1";
}

/** Keep app-level navigation out of focused session windows. */
export async function openInMainConnCat(path: string): Promise<void> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isTauri = typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  if (!isTauri) {
    window.open(normalizedPath, "catwalk-main", "noopener,noreferrer");
    return;
  }

  const [{ emitTo }, { WebviewWindow }] = await Promise.all([
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/webviewWindow"),
  ]);
  const main = await WebviewWindow.getByLabel("main");
  if (!main) throw new Error("The main ConnCat window is unavailable.");

  await emitTo("main", MAIN_WINDOW_NAVIGATE_EVENT, { path: normalizedPath });
  await main.show();
  await main.setFocus();
}

export function storeSessionWindowLaunch(launch: SessionWindowLaunch): string {
  const token = `${Date.now()}-${nextSessionWindowId++}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  localStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify(launch));
  return token;
}

export function takeSessionWindowLaunch(token: string): SessionWindowLaunch | null {
  const key = `${STORAGE_PREFIX}${token}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionWindowLaunch;
  } catch {
    return null;
  }
}

export function clearSessionWindowLaunch(token: string): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${token}`);
}

export async function markSessionWindowAdopted(token: string): Promise<void> {
  localStorage.setItem(`${ADOPTED_PREFIX}${token}`, "1");
  const isTauri = typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  if (!isTauri) return;
  const { emit } = await import("@tauri-apps/api/event");
  await emit(ADOPTION_EVENT, { token, success: true });
  diagnosticEvent("core_ui", "info", "conncat.session-window", "Live session adopted by child window", {
    transfer_token: token,
  });
}

export async function reportSessionWindowAdoptionFailure(token: string, reason: unknown): Promise<void> {
  const isTauri = typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  if (!isTauri) return;
  const message = reason instanceof Error ? reason.message : String(reason);
  const { emit } = await import("@tauri-apps/api/event");
  await emit(ADOPTION_EVENT, { token, success: false, message });
  diagnosticEvent("core_ui", "error", "conncat.session-window", "Child window failed to adopt live session", {
    transfer_token: token,
    error: message,
  });
}

async function waitForStoredSessionWindowAdoption(token: string): Promise<void> {
  const key = `${ADOPTED_PREFIX}${token}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (localStorage.getItem(key) === "1") {
      localStorage.removeItem(key);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  throw new Error("The new ConnCat window did not adopt the live session in time.");
}

/** Creates a trusted ConnCat child window and transfers/reconstructs a session. */
export async function openConnCatSessionWindow(
  launch: SessionWindowLaunch,
  title: string,
): Promise<void> {
  const token = storeSessionWindowLaunch(launch);
  const requiresAdoption = (launch.kind === "browser" && !!launch.webviewLabel)
    || (launch.kind === "terminal" && launch.ptyId != null)
    || (launch.kind === "terminal_group" && !!launch.ptyIds?.length)
    || ((launch.kind === "vm" || launch.kind === "cml" || launch.kind === "rdp") && !!launch.webviewLabel);
  diagnosticEvent("core_ui", "info", "conncat.session-window", "Opening ConnCat session window", {
    transfer_token: token,
    session_kind: launch.kind,
    requires_adoption: requiresAdoption,
  });

  const isTauri = typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  if (!isTauri) {
    window.open(`/?catwalkSessionWindow=1&launch=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
    return;
  }

  const [{ WebviewWindow }, { listen }] = await Promise.all([
    import("@tauri-apps/api/webviewWindow"),
    import("@tauri-apps/api/event"),
  ]);
  let resolveAdoption!: () => void;
  let rejectAdoption!: (reason: Error) => void;
  const nativeAdoption = new Promise<void>((resolve, reject) => {
    resolveAdoption = resolve;
    rejectAdoption = reject;
  });
  const unlistenAdoption = requiresAdoption
    ? await listen<{ token?: string; success?: boolean; message?: string }>(ADOPTION_EVENT, (event) => {
        if (event.payload.token !== token) return;
        if (event.payload.success === false) {
          rejectAdoption(new Error(event.payload.message || "The new ConnCat window could not adopt the live session."));
        } else {
          localStorage.removeItem(`${ADOPTED_PREFIX}${token}`);
          resolveAdoption();
        }
      })
    : undefined;
  const label = `session-${Date.now()}-${nextSessionWindowId++}`;
  const child = new WebviewWindow(label, {
    url: `/?catwalkSessionWindow=1&launch=${encodeURIComponent(token)}`,
    title: title.trim() || "ConnCat Session",
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    center: true,
    focus: true,
    resizable: true,
    dragDropEnabled: false,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      void child.once("tauri://created", () => resolve());
      void child.once("tauri://error", (event) => {
        localStorage.removeItem(`${STORAGE_PREFIX}${token}`);
        reject(new Error(String(event.payload || "Failed to open ConnCat session window.")));
      });
    });
    diagnosticEvent("core_ui", "debug", "conncat.session-window", "ConnCat session window created", {
      transfer_token: token,
      window_label: label,
    });
    if (requiresAdoption) {
      await Promise.race([nativeAdoption, waitForStoredSessionWindowAdoption(token)]);
      diagnosticEvent("core_ui", "info", "conncat.session-window", "Parent confirmed live session adoption", {
        transfer_token: token,
        window_label: label,
      });
    }
  } catch (error) {
    localStorage.removeItem(`${STORAGE_PREFIX}${token}`);
    localStorage.removeItem(`${ADOPTED_PREFIX}${token}`);
    try { await child.close(); } catch { /* best effort cleanup */ }
    diagnosticEvent("core_ui", "error", "conncat.session-window", "ConnCat session window handoff failed", {
      transfer_token: token,
      window_label: label,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    unlistenAdoption?.();
  }
}
