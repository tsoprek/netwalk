/// Per-device accent color, stored locally. Used to tint Lab Device cards
/// and the terminal tab opened from a device. Not synced to the server.

const KEY = "catwalk.deviceColors";
const ANSI_KEY = "catwalk.deviceAnsiTint";

function loadAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persist(m: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify(m));
}

function loadAnsiAll(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(ANSI_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function persistAnsi(m: Record<string, boolean>) {
  localStorage.setItem(ANSI_KEY, JSON.stringify(m));
}

export function getDeviceColor(id: number | string): string | undefined {
  return loadAll()[String(id)];
}

export function setDeviceColor(id: number | string, color: string | undefined) {
  const m = loadAll();
  if (!color) delete m[String(id)];
  else m[String(id)] = color;
  persist(m);
}

export function loadDeviceColors(): Record<string, string> {
  return loadAll();
}

export function getDeviceAnsiTint(id: number | string): boolean {
  return !!loadAnsiAll()[String(id)];
}

export function setDeviceAnsiTint(id: number | string, on: boolean) {
  const m = loadAnsiAll();
  if (on) m[String(id)] = true;
  else delete m[String(id)];
  persistAnsi(m);
}
