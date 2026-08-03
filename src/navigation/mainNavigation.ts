export const MAIN_NAVIGATION_PATHS = [
  "/connections",
  "/sessions",
  "/remote-access",
  "/templates",
  "/notes",
  "/identities",
  "/settings",
] as const;

export interface MainNavigationShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

/** Plain Tab remains available to xterm and normal keyboard focus traversal. */
export function matchesMainNavigationShortcut(event: MainNavigationShortcutEvent): boolean {
  return (
    event.key === "Tab" &&
    event.ctrlKey === true &&
    event.metaKey !== true &&
    event.altKey !== true &&
    event.defaultPrevented !== true &&
    event.isComposing !== true
  );
}

function pathMatchesSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(`${section}/`);
}

/** Return the adjacent main ConneCat view, wrapping at either end. */
export function cycleMainNavigationPath(pathname: string, backwards: boolean): string {
  const currentIndex = MAIN_NAVIGATION_PATHS.findIndex((section) =>
    pathMatchesSection(pathname, section),
  );
  if (currentIndex < 0) {
    return backwards
      ? MAIN_NAVIGATION_PATHS[MAIN_NAVIGATION_PATHS.length - 1]
      : MAIN_NAVIGATION_PATHS[0];
  }
  const offset = backwards ? -1 : 1;
  const nextIndex =
    (currentIndex + offset + MAIN_NAVIGATION_PATHS.length) %
    MAIN_NAVIGATION_PATHS.length;
  return MAIN_NAVIGATION_PATHS[nextIndex];
}
