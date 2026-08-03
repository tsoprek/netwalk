// Workspace presets — save a named snapshot of the currently-open
// terminal tabs (identified by sidebar row key) and restore it later
// in one click. Presets are intentionally minimal: only the row key
// and the group label are captured, so on restore we re-launch each
// connection via the live sidebar launcher (fresh SSH tunnels, fresh
// transcript paths, current device colours, etc.). Layout, dock side
// and selection state are NOT part of a preset.
//
// Storage: localStorage `catwalk.terminalsSidebar.workspaces` as a
// JSON array of WorkspacePreset.

export interface WorkspacePresetEntry {
  /// Sidebar row identity: "d:<deviceId>" for lab devices, "s:<sessionId>"
  /// for saved sessions. Untyped tabs (local shells) are skipped.
  rowKey: string;
  /// Group label the tab was last associated with. May be undefined.
  group?: string;
}

export interface WorkspacePreset {
  id: string;
  name: string;
  createdAt: number;
  entries: WorkspacePresetEntry[];
}

const KEY = "catwalk.terminalsSidebar.workspaces";

export function listPresets(): WorkspacePreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isPreset);
  } catch { return []; }
}

function isPreset(v: unknown): v is WorkspacePreset {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === "string"
    && typeof p.name === "string"
    && typeof p.createdAt === "number"
    && Array.isArray(p.entries);
}

function writeAll(presets: WorkspacePreset[]): void {
  localStorage.setItem(KEY, JSON.stringify(presets));
}

/// Persist a new preset (or replace by name). `entries` is captured
/// as-is — callers are expected to filter out untyped tabs first.
export function savePreset(name: string, entries: WorkspacePresetEntry[]): WorkspacePreset {
  const all = listPresets();
  // Replace existing by name (case-insensitive) so the menu doesn't
  // accumulate near-duplicates when the user iterates.
  const idx = all.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  const preset: WorkspacePreset = {
    id: idx >= 0 ? all[idx].id : newId(),
    name,
    createdAt: Date.now(),
    entries: entries.map(({ rowKey, group }) => ({ rowKey, group })),
  };
  if (idx >= 0) all[idx] = preset;
  else all.push(preset);
  writeAll(all);
  return preset;
}

export function deletePreset(id: string): void {
  writeAll(listPresets().filter((p) => p.id !== id));
}

function newId(): string {
  return `wp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
