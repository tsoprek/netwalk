import { invoke } from "@tauri-apps/api/core";

export const RENDERER_HANDOFF_KEY = "catwalk.rendererReset.handoff.v1";
export const RENDERER_AUTO_KEY = "catwalk.rendererReset.auto.v1";
export const RENDERER_LAST_AUTO_KEY = "catwalk.rendererReset.lastAuto.v1";
export const RENDERER_CHURN_KEY = "catwalk.rendererReset.churn.v1";
export const RENDERER_HANDOFF_TTL_MS = 60_000;
export const RENDERER_AUTO_RATE_LIMIT_MS = 60 * 60_000;

export interface RendererBlocker {
  code: string;
  count: number;
  message: string;
}

export interface RendererLifecycleStatus {
  supported: boolean;
  resetInProgress: boolean;
  ptyCount: number;
  sftpSessionCount: number;
  sftpTransferCount: number;
  directRdpCount: number;
  blockers: RendererBlocker[];
}

export interface RendererResetResponse {
  accepted: boolean;
  resetId: string;
  blockers: RendererBlocker[];
  message?: string | null;
}

export interface RendererHandoff {
  version: 1;
  resetId: string;
  timestamp: number;
  route: string;
  scrollX: number;
  scrollY: number;
}

let restoredHandoff: RendererHandoff | null = null;

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined"
    && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
}

export function validRendererRoute(route: string): boolean {
  return route.length > 0
    && route.length <= 2_048
    && route.startsWith("/")
    && !route.startsWith("//")
    && !route.includes("://")
    && !/[\r\n]/.test(route);
}

export function parseRendererHandoff(raw: string | null, now = Date.now()): RendererHandoff | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RendererHandoff>;
    if (value.version !== 1
      || typeof value.resetId !== "string"
      || typeof value.timestamp !== "number"
      || typeof value.route !== "string"
      || typeof value.scrollX !== "number"
      || typeof value.scrollY !== "number"
      || now - value.timestamp < 0
      || now - value.timestamp > RENDERER_HANDOFF_TTL_MS
      || !validRendererRoute(value.route)) return null;
    return value as RendererHandoff;
  } catch {
    return null;
  }
}

/** Runs before React/BrowserRouter so the replacement renderer opens in place. */
export function restoreRendererResetHandoff(now = Date.now()): RendererHandoff | null {
  if (typeof window === "undefined") return null;
  const handoff = parseRendererHandoff(localStorage.getItem(RENDERER_HANDOFF_KEY), now);
  localStorage.removeItem(RENDERER_HANDOFF_KEY);
  if (!handoff) return null;
  restoredHandoff = handoff;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (current !== handoff.route) history.replaceState(history.state, "", handoff.route);
  return handoff;
}

export function consumeRestoredRendererHandoff(): RendererHandoff | null {
  const value = restoredHandoff;
  restoredHandoff = null;
  return value;
}

export function createRendererHandoff(resetId: string, now = Date.now()): RendererHandoff {
  const content = document.querySelector<HTMLElement>(".app > main");
  return {
    version: 1,
    resetId,
    timestamp: now,
    route: `${location.pathname}${location.search}${location.hash}`,
    // ConneCat's route viewport is the shell's <main>, not the browser window.
    scrollX: content?.scrollLeft ?? window.scrollX,
    scrollY: content?.scrollTop ?? window.scrollY,
  };
}

export function storeRendererHandoff(handoff: RendererHandoff): void {
  localStorage.setItem(RENDERER_HANDOFF_KEY, JSON.stringify(handoff));
}

export function clearRendererHandoff(): void {
  localStorage.removeItem(RENDERER_HANDOFF_KEY);
}

export function rendererAutoRecoveryEnabled(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
  tauriRuntime = isTauriRuntime(),
): boolean {
  const stored = localStorage.getItem(RENDERER_AUTO_KEY);
  if (stored !== null) return stored === "1";
  // WKWebView graphics retention is macOS-specific. New macOS installations
  // get the guarded recovery by default; every other platform remains off.
  return tauriRuntime && /^Mac/i.test(platform);
}

export function setRendererAutoRecoveryEnabled(enabled: boolean): void {
  localStorage.setItem(RENDERER_AUTO_KEY, enabled ? "1" : "0");
}

export function rendererChurnScore(): number {
  const parsed = Number.parseInt(localStorage.getItem(RENDERER_CHURN_KEY) || "0", 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function setRendererChurnScore(score: number): void {
  localStorage.setItem(RENDERER_CHURN_KEY, String(Math.max(0, Math.min(100, Math.floor(score)))));
}

export function rendererAutoRateLimited(now = Date.now()): boolean {
  const last = Number.parseInt(localStorage.getItem(RENDERER_LAST_AUTO_KEY) || "0", 10);
  return Number.isFinite(last) && last > 0 && now - last < RENDERER_AUTO_RATE_LIMIT_MS;
}

export function markRendererAutoReset(now = Date.now()): void {
  localStorage.setItem(RENDERER_LAST_AUTO_KEY, String(now));
}

export async function getRendererLifecycleStatus(): Promise<RendererLifecycleStatus> {
  if (!isTauriRuntime()) {
    return {
      supported: false,
      resetInProgress: false,
      ptyCount: 0,
      sftpSessionCount: 0,
      sftpTransferCount: 0,
      directRdpCount: 0,
      blockers: [],
    };
  }
  return invoke<RendererLifecycleStatus>("renderer_lifecycle_status");
}

export async function resetMainRenderer(request: {
  resetId: string;
  reason: "manual" | "background_idle";
  route: string;
  churnScore: number;
}): Promise<RendererResetResponse> {
  return invoke<RendererResetResponse>("renderer_lifecycle_reset_main", { request });
}

export function newRendererResetId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `renderer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
