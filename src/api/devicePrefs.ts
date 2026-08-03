//! Persistent UI bits for the device list that don't belong on the device
//! object itself — pinned (starred) devices and a per-device SSH-username
//! history. All localStorage-only; not synced.

const PINS_KEY = "catwalk.pinnedDevices";
const SSH_USER_HISTORY_PREFIX = "catwalk.sshUserHistory.";
const MAX_USER_HISTORY = 5;

const PINS_EVENT = "catwalk:pins-changed";

function readPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writePins(set: Set<string>) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // quota — ignore
  }
  window.dispatchEvent(new CustomEvent(PINS_EVENT));
}

export function loadPinnedDevices(): Set<string> {
  return readPins();
}

export function isDevicePinned(id: string | number): boolean {
  return readPins().has(String(id));
}

export function togglePinnedDevice(id: string | number): boolean {
  const set = readPins();
  const key = String(id);
  if (set.has(key)) { set.delete(key); writePins(set); return false; }
  set.add(key); writePins(set); return true;
}

export function subscribePinnedDevices(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(PINS_EVENT, h);
  return () => window.removeEventListener(PINS_EVENT, h);
}

function userHistoryKey(deviceId: string | number): string {
  return `${SSH_USER_HISTORY_PREFIX}${deviceId}`;
}

/// Up to 5 most-recently-used SSH usernames for this device, newest first.
export function getSshUserHistory(deviceId: string | number): string[] {
  try {
    const raw = localStorage.getItem(userHistoryKey(deviceId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x).slice(0, MAX_USER_HISTORY) : [];
  } catch {
    return [];
  }
}

export function recordSshUser(deviceId: string | number, user: string): void {
  const u = (user ?? "").trim();
  if (!u) return;
  const existing = getSshUserHistory(deviceId).filter((x) => x !== u);
  const next = [u, ...existing].slice(0, MAX_USER_HISTORY);
  try {
    localStorage.setItem(userHistoryKey(deviceId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

// Separate namespace for My Connections pins + SSH user history so
// session ids (UUIDs) can't collide with device ids and so power users
// can independently nuke either set from devtools.
const SESSION_PINS_KEY = "catwalk.pinnedSessions";
const SESSION_PINS_EVENT = "catwalk:session-pins-changed";
const SESSION_SSH_USER_HISTORY_PREFIX = "catwalk.sessionSshUserHistory.";

function readSessionPins(): Set<string> {
  try {
    const raw = localStorage.getItem(SESSION_PINS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSessionPins(set: Set<string>) {
  try {
    localStorage.setItem(SESSION_PINS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // quota — ignore
  }
  window.dispatchEvent(new CustomEvent(SESSION_PINS_EVENT));
}

export function loadPinnedSessions(): Set<string> {
  return readSessionPins();
}

export function togglePinnedSession(id: string): boolean {
  const set = readSessionPins();
  if (set.has(id)) { set.delete(id); writeSessionPins(set); return false; }
  set.add(id); writeSessionPins(set); return true;
}

export function subscribePinnedSessions(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(SESSION_PINS_EVENT, h);
  return () => window.removeEventListener(SESSION_PINS_EVENT, h);
}

function sessionUserHistoryKey(sessionId: string): string {
  return `${SESSION_SSH_USER_HISTORY_PREFIX}${sessionId}`;
}

export function getSessionSshUserHistory(sessionId: string): string[] {
  try {
    const raw = localStorage.getItem(sessionUserHistoryKey(sessionId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x).slice(0, MAX_USER_HISTORY) : [];
  } catch {
    return [];
  }
}

export function recordSessionSshUser(sessionId: string, user: string): void {
  const u = (user ?? "").trim();
  if (!u) return;
  const existing = getSessionSshUserHistory(sessionId).filter((x) => x !== u);
  const next = [u, ...existing].slice(0, MAX_USER_HISTORY);
  try {
    localStorage.setItem(sessionUserHistoryKey(sessionId), JSON.stringify(next));
  } catch {
    // ignore
  }
}
