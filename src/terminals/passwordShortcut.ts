export interface TerminalPasswordShortcutEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function matchesTerminalPasswordShortcut(
  event: TerminalPasswordShortcutEvent,
  shortcut: OnePasswordShortcut = "primaryShiftP",
): boolean {
  if (shortcut === "disabled") return false;
  const primary = Boolean(event.ctrlKey || event.metaKey);
  const isP = event.key.toLowerCase() === "p" || event.code === "KeyP";
  if (!primary || !isP) return false;
  if (shortcut === "primaryShiftP") return Boolean(event.shiftKey) && !event.altKey;
  return Boolean(event.altKey) && !event.shiftKey;
}

export function onePasswordShortcutLabel(
  shortcut: OnePasswordShortcut,
  isMac: boolean,
): string {
  if (shortcut === "disabled") return "Disabled";
  const primary = isMac ? "⌘" : "Ctrl";
  const modifier = shortcut === "primaryAltP"
    ? (isMac ? "⌥" : "Alt")
    : (isMac ? "⇧" : "Shift");
  return isMac ? `${primary}${modifier}P` : `${primary}+${modifier}+P`;
}
import type { OnePasswordShortcut } from "../api/appearance";
