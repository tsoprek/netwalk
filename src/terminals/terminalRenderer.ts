import type { TerminalRenderer } from "../api/appearance";

export type ResolvedTerminalRenderer = Exclude<TerminalRenderer, "auto">;

export const MAX_POOLED_MACOS_DOM_RENDERERS = 2;

export function isMacOsUserAgent(userAgent: string): boolean {
  return userAgent.includes("Macintosh") || userAgent.includes("Mac OS X");
}

export function resolveTerminalRenderer(
  renderer: TerminalRenderer,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): ResolvedTerminalRenderer {
  if (renderer !== "auto") return renderer;
  return isMacOsUserAgent(userAgent) ? "dom" : "webgl";
}

export function shouldPoolTerminalRenderer(
  renderer: TerminalRenderer,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): boolean {
  return isMacOsUserAgent(userAgent)
    && resolveTerminalRenderer(renderer, userAgent) === "dom";
}

export function terminalRendererPoolLimit(
  renderer: TerminalRenderer,
  liveTerminalCount: number,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): number {
  if (liveTerminalCount <= 0) return 0;
  return shouldPoolTerminalRenderer(renderer, userAgent)
    ? MAX_POOLED_MACOS_DOM_RENDERERS
    : 0;
}
