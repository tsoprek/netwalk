export type SessionProtocol = "ssh" | "rdp" | "shell" | "web" | "console";
export type RdpSecurityTransport = "nla" | "tls" | "rdp";
export type RdpQualityProfile = "balanced" | "low_bandwidth" | "very_low_bandwidth";
export type RdpResolutionPreset =
  | "800x600"
  | "1024x768"
  | "1280x720"
  | "1280x800"
  | "1366x768"
  | "1440x900"
  | "1600x900"
  | "1920x1080"
  | "2560x1440"
  | "3440x1440"
  | "3840x2160";

export const RDP_RESOLUTION_PRESETS: ReadonlyArray<{
  value: RdpResolutionPreset;
  label: string;
  width: number;
  height: number;
}> = [
  { value: "800x600", label: "800×600 (4:3)", width: 800, height: 600 },
  { value: "1024x768", label: "1024×768 (4:3)", width: 1024, height: 768 },
  { value: "1280x720", label: "1280×720 (HD)", width: 1280, height: 720 },
  { value: "1280x800", label: "1280×800 (16:10)", width: 1280, height: 800 },
  { value: "1366x768", label: "1366×768 (laptop)", width: 1366, height: 768 },
  { value: "1440x900", label: "1440×900 (16:10)", width: 1440, height: 900 },
  { value: "1600x900", label: "1600×900 (HD+)", width: 1600, height: 900 },
  { value: "1920x1080", label: "1920×1080 (Full HD)", width: 1920, height: 1080 },
  { value: "2560x1440", label: "2560×1440 (QHD)", width: 2560, height: 1440 },
  { value: "3440x1440", label: "3440×1440 (ultrawide)", width: 3440, height: 1440 },
  { value: "3840x2160", label: "3840×2160 (4K)", width: 3840, height: 2160 },
];

export function rdpResolutionDimensions(value?: RdpResolutionPreset): { width: number; height: number } | undefined {
  const preset = RDP_RESOLUTION_PRESETS.find((candidate) => candidate.value === value);
  return preset ? { width: preset.width, height: preset.height } : undefined;
}

export type SerialParity = "none" | "odd" | "even";
export type SerialFlowControl = "none" | "software" | "hardware";

export interface SavedSerialSettings {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: SerialParity;
  stopBits: 1 | 2;
  flowControl: SerialFlowControl;
}

export interface SavedSession {
  id: string;
  name: string;
  protocol: SessionProtocol;
  /// For ssh/rdp/web: target host. Ignored for shell.
  host: string;
  /// For ssh/rdp. Unused for web (see `webPorts`).
  port: number;
  /// For ssh/rdp.
  username: string;
  /// Optional Windows domain used by direct RDP connections.
  rdpDomain?: string;
  /// Optional RDP-specific port override. This is useful when RDP is enabled
  /// on an SSH Connection whose primary `port` belongs to SSH.
  rdpPort?: number;
  /// Per-Connection RDP launcher override. Missing means inherit the global
  /// saved-Connection setting (ConnCat on supported macOS builds by default).
  rdpApp?: "catwalk" | "freerdp" | "system";
  /// Security transport used by direct ConnCat RDP. Missing defaults to NLA.
  /// ConnCat updates this after a transport connects successfully so the next
  /// launch can start with the last known working mode.
  rdpSecurity?: RdpSecurityTransport;
  /// In-app RDP image-quality preset. Missing means balanced, 32-bit output.
  rdpQuality?: RdpQualityProfile;
  /// Explicit remote desktop framebuffer size. Missing automatically chooses
  /// a display-aware size and retains the conservative macOS memory cap.
  rdpResolution?: RdpResolutionPreset;
  /// Optional 1Password Login item used for in-app SSH or direct RDP authentication.
  /// Only the item reference and account selector are persisted; resolved
  /// username/password values are never written to the saved connection.
  onePassword?: import("./onePassword").OnePasswordCredentialRef;
  /// For shell: command line (default: /bin/zsh or cmd.exe).
  shellCmd?: string;
  /// Local serial-console settings. `host` stores the device path (macOS /
  /// Linux) or COM port name (Windows) for console connections.
  serial?: SavedSerialSettings;
  /// Per-session private key path. When set, SSH/SFTP launches use this
  /// instead of the global key configured under Identities.
  sshKeyPath?: string;
  /// Per-connection SSH local forwards. Each entry becomes
  /// `ssh -L localPort:destinationHost:destinationPort ...` when SSH opens.
  sshTunnels?: SavedSessionTunnel[];
  /// For web: ordered list of TCP ports to expose as Browse buttons.
  /// Each opens `https://<host>:<port>` in ConnCat's in-app browser.
  webPorts?: number[];
  notes?: string;
  createdAt: number;
  lastUsedAt?: number;
  /// Server-sync bookkeeping — last local change, ms since epoch.
  updatedAt?: number;
  /// Tombstone: when set, this id is deleted; kept so the deletion can win
  /// against an older server copy during merge.
  deletedAt?: number;
  /// Group id this session belongs to. Undefined / unknown = "Ungrouped".
  groupId?: string;
  /// Per-group display order (ascending). Sessions without `order` retain
  /// their creation order; opening a connection must not move its card.
  order?: number;
  /// Optional accent color (hex). Tints the session card stripe and the
  /// terminal tab when launching from this session.
  color?: string;
  /// When true and `color` is set, terminal tabs spawned from this session
  /// remap their ANSI palette so colored program output (ls, git, prompts)
  /// tints toward the card color instead of the theme defaults.
  tintAnsi?: boolean;
  /// Per-OS external-terminal override for "Connect → External terminal" and
  /// "SFTP → External terminal". Matches the rust launcher's known app ids
  /// (Terminal/iTerm/Warp on mac; OpenSSH/WindowsTerminal/PuTTY/KiTTY/
  /// SecureCRT on Windows). Empty / undefined falls back to the global
  /// default stored under `catwalk.terminal`.
  terminalMac?: string;
  terminalWindows?: string;
  /// Per-session button visibility on the My Connections row. Missing /
  /// undefined means "use protocol defaults" (ssh → SSH+SFTP; rdp → RDP;
  /// web → none). `browse` controls whether configured `webPorts` are
  /// exposed as buttons; when absent, older profiles infer it from ports.
  connections?: {
    ssh?: boolean;
    rdp?: boolean;
    sftp?: boolean;
    browse?: boolean;
  };
  /// SSH ServerAliveInterval seconds. When set (>0), launches inject
  /// `-o ServerAliveInterval=<n> -o ServerAliveCountMax=3` so the session
  /// survives idle NAT timeouts. Null/undefined = disabled.
  keepalive?: number;
  /// SSH "vim fix" wrapper toggle. When true, the in-app terminal launch
  /// appends `VIMINIT=… exec $SHELL` to the ssh argv so vim on the remote
  /// box doesn't hang under xterm.js. Default is off so SSH follows the
  /// normal interactive login path and MOTD/login banners can show.
  vimFix?: boolean;
  /// Per-session "SSH — Open with" preference. Mirrors the per-device
  /// option on VMs. Sentinel `"app"` (or undefined) = in-app terminal
  /// tab; any other value is a system terminal id returned by
  /// `detectTerminals()` (e.g. "Terminal", "iTerm", "Warp",
  /// "WindowsTerminal", "PuTTY", "KiTTY").
  sshApp?: string;
  /// Per-session "SFTP — Open with" preference. Sentinels:
  /// - `"app"`     = in-app terminal tab running `sftp`
  /// - `"browser"` = built-in SFTP browser route (default)
  /// - `"system"`  = external `sftp` CLI in the system terminal
  /// Anything else = SFTP GUI id from `detectSftpGuis()`.
  sftpApp?: string;
  /// Per-connection Browse presentation. Undefined inherits App Behavior.
  browseOpenMode?: "in_app" | "window" | "external";
  /// Per-session terminal scrollback (lines). Overrides the global
  /// `terminalScrollback` from appearance. Undefined = use global.
  scrollback?: number;
  /// Per-session transcript override.
  /// - `undefined`: inherit the global `transcriptEnabled` setting
  /// - `true`/`false`: force on/off for this session
  saveTranscript?: boolean;
  /// Per-session transcript directory override. When empty/undefined we
  /// fall back to the global `transcriptDir` from appearance.
  transcriptDir?: string;
  /// Optional device-type / OS icon to display on the My Connections row
  /// and focus card. Values come from `DEVICE_TYPE_OPTIONS` in
  /// `components/GuestOsIcon.tsx` (e.g. `cisco_router`, `linux_ubuntu`).
  /// Empty/undefined = no icon shown.
  deviceTypeIcon?: string;
}

export interface SavedSessionTunnel {
  id: string;
  localPort: number;
  destinationHost: string;
  destinationPort: number;
}

function validPort(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) return null;
  return n;
}

export function normalizedSessionTunnels(s: Pick<SavedSession, "sshTunnels">): SavedSessionTunnel[] {
  const seen = new Set<string>();
  const out: SavedSessionTunnel[] = [];
  for (const raw of s.sshTunnels ?? []) {
    const localPort = validPort(raw?.localPort);
    const destinationPort = validPort(raw?.destinationPort);
    const destinationHost = String(raw?.destinationHost || "").trim();
    if (localPort == null || destinationPort == null || !destinationHost) continue;
    if (/[\s"'\\]/.test(destinationHost)) continue;
    const key = `${localPort}:${destinationHost.toLowerCase()}:${destinationPort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(raw?.id || key),
      localPort,
      destinationHost,
      destinationPort,
    });
  }
  return out;
}

export function sessionSshForwardSpecs(s: Pick<SavedSession, "sshTunnels">): string[] {
  return normalizedSessionTunnels(s).map((t) =>
    `${t.localPort}:${t.destinationHost}:${t.destinationPort}`,
  );
}

export function sessionSshForwardArgs(s: Pick<SavedSession, "sshTunnels">): string[] {
  return sessionSshForwardSpecs(s).flatMap((spec) => ["-L", spec]);
}

export function effectiveSessionRdpPort(
  session: Pick<SavedSession, "protocol" | "port" | "rdpPort">,
): number {
  return validPort(session.rdpPort)
    ?? (session.protocol === "rdp" ? validPort(session.port) : null)
    ?? 3389;
}

/// Effective per-session button visibility. Mirrors the VM-card behavior:
/// when the user hasn't explicitly overridden a row, defaults are derived
/// from `protocol`. Older profiles infer Browse from `webPorts`; newer
/// profiles can disable Browse without discarding their configured ports.
export function effectiveSessionConnections(s: SavedSession): {
  ssh: boolean;
  rdp: boolean;
  sftp: boolean;
  browse: boolean;
} {
  const browse = s.connections?.browse ?? (s.webPorts ?? []).length > 0;
  const o = s.connections;
  if (s.protocol === "rdp") {
    return {
      ssh: o?.ssh ?? false,
      rdp: o?.rdp ?? true,
      sftp: o?.sftp ?? false,
      browse,
    };
  }
  if (s.protocol === "ssh") {
    return {
      ssh: o?.ssh ?? true,
      rdp: o?.rdp ?? false,
      sftp: o?.sftp ?? true,
      browse,
    };
  }
  // web / shell — buttons aren't shown in the row anyway, but keep defaults
  // honest.
  return {
    ssh: o?.ssh ?? false,
    rdp: o?.rdp ?? false,
    sftp: o?.sftp ?? false,
    browse,
  };
}

export interface SessionGroup {
  id: string;
  name: string;
  /// Optional group accent color (hex). Used by the Connections group frame
  /// and the matching group in the Sessions sidebar.
  color?: string;
  /// Display order (ascending). Lower = first.
  order: number;
  createdAt: number;
  updatedAt?: number;
  deletedAt?: number;
}

const KEY = "catwalk.sessions";
const GROUPS_KEY = "catwalk.sessionGroups";

function sanitizeSession(value: SavedSession): SavedSession {
  const {
    labDevice: _obsoleteLabDevice,
    sshOptions: _obsoleteSshOptions,
    ...clean
  } = value as SavedSession & { labDevice?: unknown; sshOptions?: unknown };
  const reference = clean.onePassword;
  const rdpSecurity = clean.rdpSecurity === "nla"
    || clean.rdpSecurity === "tls"
    || clean.rdpSecurity === "rdp"
    ? clean.rdpSecurity
    : undefined;
  const rdpQuality = clean.rdpQuality === "low_bandwidth"
    || clean.rdpQuality === "very_low_bandwidth"
    ? clean.rdpQuality
    : undefined;
  const rdpResolution = RDP_RESOLUTION_PRESETS.some((preset) => preset.value === clean.rdpResolution)
    ? clean.rdpResolution
    : undefined;
  const rdpPort = validPort(clean.rdpPort) ?? undefined;
  const onePassword = reference && typeof reference.itemReference === "string"
    ? {
        itemReference: reference.itemReference,
        ...(typeof reference.account === "string" && reference.account.trim()
          ? { account: reference.account }
          : {}),
      }
    : undefined;
  return {
    ...clean,
    rdpPort,
    rdpSecurity,
    rdpQuality,
    rdpResolution,
    onePassword,
    sshTunnels: normalizedSessionTunnels(clean),
  };
}

/// All sessions, including soft-deleted tombstones (used for merge).
function loadAll(): SavedSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedSession[];
    return Array.isArray(arr) ? arr.map(sanitizeSession) : [];
  } catch {
    return [];
  }
}

export function listSessions(): SavedSession[] {
  return loadAll().filter((s) => !s.deletedAt);
}

function persist(arr: SavedSession[]) {
  localStorage.setItem(KEY, JSON.stringify(arr.map(sanitizeSession)));
  window.dispatchEvent(new CustomEvent("catwalk:sessions-changed"));
}

export function rememberRdpSecurityTransport(id: string, rdpSecurity: RdpSecurityTransport): void {
  const all = loadAll();
  const index = all.findIndex((session) => session.id === id && !session.deletedAt);
  if (index < 0 || all[index].rdpSecurity === rdpSecurity) return;
  all[index] = { ...all[index], rdpSecurity, updatedAt: Date.now() };
  persist(all);
}

export function upsertSession(s: SavedSession) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === s.id);
  const stamped = sanitizeSession({ ...s, updatedAt: Date.now() });
  if (i >= 0) all[i] = stamped; else all.push(stamped);
  persist(all);
}

export function deleteSession(id: string) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) {
    all[i] = { ...all[i], deletedAt: Date.now(), updatedAt: Date.now() };
    persist(all);
  }
}

export function touchSession(id: string) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) {
    all[i].lastUsedAt = Date.now();
    all[i].updatedAt = Date.now();
    persist(all);
  }
}

/** Stable card order: explicit drag order first, then original creation time. */
export function compareSessionsForDisplay(a: SavedSession, b: SavedSession): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.createdAt - b.createdAt;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/// Effective merge timestamp for an entry. Records that predate the sync
/// feature may not carry `updatedAt`; fall back to `createdAt`, then 0.
function mergeTs(s: SavedSession): number {
  return s.updatedAt ?? s.createdAt ?? 0;
}

/// Conflict policy for session sync (see PLAN.md §"Session sync policy"):
///
/// 1. Per id, last-write-wins by `updatedAt` (fallback `createdAt`, then 0).
/// 2. Tombstones (`deletedAt` set) participate in LWW like any other record.
///    A delete with a higher `updatedAt` beats an older edit; a later edit
///    on either side resurrects the row.
/// 3. Ties (equal `updatedAt`) → local wins. This is deterministic and
///    avoids ping-ponging the same record between two clients with skewed
///    clocks landing on the same millisecond.
/// 4. Ids present on only one side are kept.
///
/// Returns the merged array (incl. tombstones) and persists it locally.
export function mergeSessions(serverArr: SavedSession[]): SavedSession[] {
  const byId = new Map<string, SavedSession>();
  for (const s of loadAll()) byId.set(s.id, s);
  for (const s of serverArr || []) {
    if (!s || !s.id) continue;
    const existing = byId.get(s.id);
    if (!existing || mergeTs(s) > mergeTs(existing)) {
      byId.set(s.id, sanitizeSession(s));
    }
  }
  const merged = Array.from(byId.values());
  persist(merged);
  return merged;
}

/// Snapshot the full list (incl. tombstones) for upload to the portal.
export function exportAll(): SavedSession[] {
  return loadAll();
}

/// Merge a settings-panel draft with the latest persisted row. The panel
/// does not edit SSH tunnels; those live in a separate modal. Preserving the
/// latest tunnel list prevents a stale open settings panel from wiping a
/// tunnel edit when the user clicks Save/Close afterwards.
export function mergeSessionFormDraft(draft: SavedSession): SavedSession {
  const latest = loadAll().find((s) => s.id === draft.id);
  if (!latest) return sanitizeSession(draft);
  return sanitizeSession({
    ...latest,
    ...draft,
    sshTunnels: latest.sshTunnels,
  });
}

// ---------------------------------------------------------------------------
// Session groups: user-defined buckets to organize "My Connections".
// Stored under a separate localStorage key. Tombstones + last-write-wins
// merge mirror the session sync policy so the same /api/profile blob can
// carry them when we wire it through.
// ---------------------------------------------------------------------------

function loadGroupsAll(): SessionGroup[] {
  try {
    const raw = localStorage.getItem(GROUPS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SessionGroup[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistGroups(arr: SessionGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(arr));
}

export function listGroups(): SessionGroup[] {
  return loadGroupsAll()
    .filter((g) => !g.deletedAt)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function upsertGroup(g: SessionGroup) {
  const all = loadGroupsAll();
  const i = all.findIndex((x) => x.id === g.id);
  const stamped = { ...g, updatedAt: Date.now() };
  if (i >= 0) all[i] = stamped; else all.push(stamped);
  persistGroups(all);
  window.dispatchEvent(new CustomEvent("catwalk:sessions-changed"));
}

export function deleteGroup(id: string) {
  const all = loadGroupsAll();
  const i = all.findIndex((x) => x.id === id);
  if (i >= 0) {
    all[i] = { ...all[i], deletedAt: Date.now(), updatedAt: Date.now() };
    persistGroups(all);
    window.dispatchEvent(new CustomEvent("catwalk:sessions-changed"));
  }
  // Move any sessions in this group back to Ungrouped.
  for (const s of listSessions()) {
    if (s.groupId === id) upsertSession({ ...s, groupId: undefined });
  }
}

export function assignSessionToGroup(sessionId: string, groupId: string | undefined) {
  const all = loadAll();
  const i = all.findIndex((x) => x.id === sessionId);
  if (i < 0) return;
  // Append to end of target bucket — caller can follow up with reorderSession
  // for a precise position.
  const now = Date.now();
  const peers = all.filter((x) => !x.deletedAt && x.groupId === groupId && x.id !== sessionId);
  const maxOrder = peers.reduce((m, p) => Math.max(m, p.order ?? -1), -1);
  all[i] = { ...all[i], groupId, order: maxOrder + 1, updatedAt: now };
  persist(all);
}

/// Move `sessionId` so the dragged card visually takes `beforeId`'s slot
/// (or lands at the end of the bucket if `beforeId` is null). The drop
/// is direction-aware: dragging right-to-left puts the card BEFORE the
/// target, left-to-right puts it AFTER. Renumbers the affected bucket so
/// the order is dense and stable.
///
/// `visibleOrder`, when supplied, is the list of session ids in the
/// bucket as the user currently sees them. Pass it from the UI when the
/// rendered order differs from the persisted order/creation-time sort
/// — for example when pinned sessions float to the top. Without it the
/// function falls back to the persisted sort, which would mis-detect
/// direction whenever the visible order has been re-shuffled.
export function reorderSession(
  sessionId: string,
  beforeId: string | null,
  visibleOrder?: string[],
) {
  const all = loadAll();
  const moving = all.find((x) => x.id === sessionId);
  if (!moving) return;
  const targetGroup = beforeId
    ? all.find((x) => x.id === beforeId)?.groupId
    : moving.groupId;
  const now = Date.now();
  // Pull current order of the target bucket WITH the moving entry so we
  // can tell whether the drag is L->R or R->L within the bucket.
  let fullIds: string[];
  if (visibleOrder && visibleOrder.length > 0) {
    // Trust what the user sees. Filter to the bucket and to ids that
    // still exist so a stale list can't insert ghosts.
    const liveInGroup = new Set(
      all
        .filter((x) => !x.deletedAt && x.groupId === targetGroup)
        .map((x) => x.id),
    );
    fullIds = visibleOrder.filter((id) => liveInGroup.has(id));
    // Append any peers the caller didn't include (defensive — shouldn't
    // happen in practice but keeps the bucket complete).
    for (const id of liveInGroup) {
      if (!fullIds.includes(id)) fullIds.push(id);
    }
  } else {
    const peersFull = all
      .filter((x) => !x.deletedAt && x.groupId === targetGroup)
      .sort(compareSessionsForDisplay);
    fullIds = peersFull.map((p) => p.id);
  }
  const dragIdx = fullIds.indexOf(sessionId);
  const ids = fullIds.filter((id) => id !== sessionId);
  if (beforeId) {
    const targetIdxFull = fullIds.indexOf(beforeId);
    const targetIdxAfter = ids.indexOf(beforeId);
    if (targetIdxFull < 0 || targetIdxAfter < 0) {
      ids.push(sessionId);
    } else {
      // dragIdx < 0 means the moving session is changing groups; treat
      // as "drop on target slot" (insert before).
      const insertAt = dragIdx >= 0 && dragIdx < targetIdxFull
        ? targetIdxAfter + 1
        : targetIdxAfter;
      ids.splice(insertAt, 0, sessionId);
    }
  } else {
    ids.push(sessionId);
  }
  const orderById = new Map(ids.map((id, i) => [id, i]));
  for (let i = 0; i < all.length; i++) {
    if (all[i].deletedAt) continue;
    if (all[i].id === sessionId) {
      all[i] = { ...all[i], groupId: targetGroup, order: orderById.get(all[i].id)!, updatedAt: now };
    } else if (orderById.has(all[i].id)) {
      all[i] = { ...all[i], order: orderById.get(all[i].id)!, updatedAt: now };
    }
  }
  persist(all);
}

export function newGroupId(): string {
  return "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/// Move group `draggedId` so it lands in `beforeId`'s slot in the
/// visible group list. Direction-aware: dragging forward drops AFTER,
/// dragging backward drops BEFORE (mirrors `reorderSession`). Renumbers
/// every live group's `order` to keep the sequence dense and stable.
export function reorderGroup(draggedId: string, beforeId: string) {
  if (draggedId === beforeId) return;
  const visible = listGroups();
  const ids = visible.map((g) => g.id);
  const dragIdx = ids.indexOf(draggedId);
  const targetIdx = ids.indexOf(beforeId);
  if (dragIdx < 0 || targetIdx < 0) return;
  const filtered = ids.filter((id) => id !== draggedId);
  const targetIdxAfter = filtered.indexOf(beforeId);
  const insertAt = dragIdx < targetIdx ? targetIdxAfter + 1 : targetIdxAfter;
  filtered.splice(insertAt, 0, draggedId);
  const now = Date.now();
  const all = loadGroupsAll();
  const newOrder = new Map(filtered.map((id, i) => [id, i]));
  for (let i = 0; i < all.length; i++) {
    if (all[i].deletedAt) continue;
    if (newOrder.has(all[i].id)) {
      all[i] = { ...all[i], order: newOrder.get(all[i].id)!, updatedAt: now };
    }
  }
  persistGroups(all);
}

export function exportAllGroups(): SessionGroup[] {
  return loadGroupsAll();
}

export function mergeGroups(serverArr: SessionGroup[]): SessionGroup[] {
  const ts = (g: SessionGroup) => g.updatedAt ?? g.createdAt ?? 0;
  const byId = new Map<string, SessionGroup>();
  for (const g of loadGroupsAll()) byId.set(g.id, g);
  for (const g of serverArr || []) {
    if (!g || !g.id) continue;
    const existing = byId.get(g.id);
    if (!existing || ts(g) > ts(existing)) byId.set(g.id, g);
  }
  const merged = Array.from(byId.values());
  persistGroups(merged);
  return merged;
}
