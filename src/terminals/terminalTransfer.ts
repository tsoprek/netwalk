const EXPLICIT_TERMINAL_DROP_ZONES = ".terminals-tabs, .terminals-empty";

/** Return a release callback only for the first handler claiming this token. */
export function claimTerminalTransfer(
  activeTokens: Set<string>,
  token: string,
): (() => void) | null {
  if (!token || activeTokens.has(token)) return null;
  activeTokens.add(token);
  return () => activeTokens.delete(token);
}

/** These zones own their React drop handler; the window fallback must abstain. */
export function hasExplicitTerminalDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EXPLICIT_TERMINAL_DROP_ZONES) != null;
}
