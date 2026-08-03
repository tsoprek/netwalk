// Small reusable factory for the "Go to ..." context-menu cluster
// shared by the top bar, the empty terminals view, and the various
// page-level right-click menus. Keeps every page agreeing on the same
// nav verbs and ordering so right-click feels consistent.

import { useNavigate, useLocation } from "react-router-dom";
import { type ContextMenuItem } from "./ContextMenu";

export interface NavMenuEntry {
  label: string;
  path: string;
}

const NAV_ENTRIES: NavMenuEntry[] = [
  { label: "Connections",     path: "/connections" },
  { label: "Sessions",        path: "/sessions" },
  { label: "Remote Access",   path: "/remote-access" },
  { label: "Templates",       path: "/templates" },
  { label: "Notes",           path: "/notes" },
  { label: "Identities",      path: "/identities" },
  { label: "Settings",        path: "/settings" },
];

/// Build the "Go to" submenu items. Skips the route the user is already
/// viewing and renders matching rows as disabled-with-checkmark for
/// extra context.
export function useNavMenuItems(): ContextMenuItem[] {
  const nav = useNavigate();
  const loc = useLocation();
  const items: ContextMenuItem[] = [];
  items.push({ label: "Go to", disabled: true, onClick: () => {} });
  for (const e of NAV_ENTRIES) {
    const active = loc.pathname === e.path || loc.pathname.startsWith(e.path + "/");
    items.push({
      label: `   ${active ? "\u2713 " : ""}${e.label}`,
      disabled: active,
      onClick: () => nav(e.path),
    });
  }
  return items;
}

/// Reload the current browser/webview frame. Used by the top-bar menu
/// and the "stuck" recovery affordance on empty pages.
export function reloadAppWindow(): void {
  try {
    window.location.reload();
  } catch {
    /* ignore */
  }
}
