import type { TerminalNotesShortcut } from "../api/appearance";

export interface NotesShortcutEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function matchesTerminalNotesShortcut(
  event: NotesShortcutEvent,
  shortcut: TerminalNotesShortcut,
): boolean {
  if (shortcut === "disabled") return false;
  const primary = Boolean(event.ctrlKey || event.metaKey);
  const isN = event.key.toLowerCase() === "n" || event.code === "KeyN";
  if (!primary || !isN) return false;
  if (shortcut === "primaryShiftN") return Boolean(event.shiftKey) && !event.altKey;
  return Boolean(event.altKey) && !event.shiftKey;
}

export function matchesTerminalSelectAllShortcut(event: NotesShortcutEvent): boolean {
  const primary = Boolean(event.ctrlKey || event.metaKey);
  const isA = event.key.toLowerCase() === "a" || event.code === "KeyA";
  return primary && isA && !event.altKey && !event.shiftKey;
}
