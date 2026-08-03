import type { IdentitiesShortcut } from "../api/appearance";

export interface IdentityShortcutEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function matchesIdentitiesShortcut(
  event: IdentityShortcutEvent,
  shortcut: IdentitiesShortcut,
): boolean {
  if (shortcut === "disabled") return false;
  const primary = Boolean(event.ctrlKey || event.metaKey);
  const isI = event.key.toLowerCase() === "i" || event.code === "KeyI";
  if (!primary || !isI) return false;
  if (shortcut === "primaryShiftI") return Boolean(event.shiftKey) && !event.altKey;
  return Boolean(event.altKey) && !event.shiftKey;
}
