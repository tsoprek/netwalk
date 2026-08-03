export interface SessionTabShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

export type SessionTabShortcut =
  | { kind: "relative"; offset: -1 | 1 }
  | { kind: "index"; index: number };

/** Fixed tab shortcuts shared by Sessions and Remote Access. */
export function sessionTabShortcut(event: SessionTabShortcutEvent): SessionTabShortcut | null {
  if (
    event.ctrlKey !== true ||
    event.shiftKey === true ||
    event.metaKey === true ||
    event.altKey === true ||
    event.defaultPrevented === true ||
    event.isComposing === true
  ) return null;

  if (event.key === "PageUp") return { kind: "relative", offset: -1 };
  if (event.key === "PageDown") return { kind: "relative", offset: 1 };
  if (/^[1-9]$/.test(event.key)) return { kind: "index", index: Number(event.key) - 1 };
  return null;
}

export function sessionTabShortcutTarget<T>(
  tabs: readonly T[],
  activeTab: T | null | undefined,
  shortcut: SessionTabShortcut,
): T | null {
  if (tabs.length === 0) return null;
  if (shortcut.kind === "index") return tabs[shortcut.index] ?? null;
  const currentIndex = activeTab == null ? -1 : tabs.indexOf(activeTab);
  if (currentIndex < 0) return shortcut.offset > 0 ? tabs[0] : tabs[tabs.length - 1];
  return tabs[(currentIndex + shortcut.offset + tabs.length) % tabs.length];
}
