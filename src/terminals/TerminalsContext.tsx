import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  captureCanvasBackingStores,
  canvasBackingStorePixels,
  disposeWebglAddonAndContext,
  prepareWebglContextRelease,
  releaseCanvasBackingStores,
} from "./webglCleanup";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { readText as clipReadText, writeText as clipWriteText } from "@tauri-apps/plugin-clipboard-manager";
import type { MosaicDirection, MosaicNode } from "react-mosaic-component";
import {
  terminalControlSequenceForKeyEvent,
  type TerminalControlKeyMode,
} from "./controlKeys";
import { matchesTerminalNotesShortcut, matchesTerminalSelectAllShortcut } from "./notesShortcut";
import { matchesTerminalPasswordShortcut } from "./passwordShortcut";
import { AnsiBackgroundFilter, buildAnsiTint } from "./ansiTint";
import { hasSshPasswordPrompt } from "./authenticationPrompt";
import { diagnosticEvent } from "../api/diagnostics";
import { addLocalNotification } from "../notifications/localStore";
import { resolveOnePasswordLogin, type OnePasswordCredentialRef } from "../api/onePassword";
import { terminalRendererPoolLimit } from "./terminalRenderer";
import { drainRendererPool, remainingLiveTerminalCount } from "./rendererPoolLifecycle";

// react-mosaic-component doesn't re-export its internal `MosaicKey` alias.
// Inline it so our helpers can carry the same constraint as `MosaicNode`.
type MosaicKey = string | number;
import { useAppearance } from "../appearance/AppearanceContext";
import { getEffectiveTerminalAnsiAccent } from "../api/appearance";
import { normalizeConsoleText } from "../utils/consoleText";
import { initialTerminalGrid, isUsableTerminalGrid } from "./terminalGeometry";
import {
  arrangeTerminalWorkspace,
  firstTerminalPane,
  isMultiPaneLayout,
  reorderTerminalWorkspace,
  selectTerminalWorkspace,
  terminalWorkspaceIds,
  type TerminalWorkspaceArrange,
} from "./terminalLayout";

/// Shared encoder \u2014 building one per keystroke is wasteful even though
/// individual `new TextEncoder()` calls are cheap. Hoisting also makes the
/// hot-path call site read one line shorter.
const UTF8_ENCODER = new TextEncoder();

type PasswordShortcutStatus = "retrieving" | "sent" | "blocked" | "error";

function emitPasswordShortcutStatus(tabId: number, status: PasswordShortcutStatus, message: string) {
  window.dispatchEvent(new CustomEvent("catwalk:terminal-password-status", {
    detail: { tabId, status, message },
  }));
}

function terminalActiveLogicalLine(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  let row = Math.max(0, buffer.baseY + buffer.cursorY);
  const lines: string[] = [];
  let line = buffer.getLine(row);
  if (!line) return "";
  lines.unshift(line.translateToString(false));
  while (line.isWrapped && row > 0) {
    row -= 1;
    line = buffer.getLine(row);
    if (!line) break;
    lines.unshift(line.translateToString(false));
  }
  return lines.join("");
}

function tabHasActivePasswordPrompt(tab: TerminalTab, observedTail: string): boolean {
  return hasSshPasswordPrompt(observedTail)
    || hasSshPasswordPrompt(terminalActiveLogicalLine(tab.terminal));
}

/// Decode a base64 string emitted by the Rust pty reader into a Uint8Array.
/// `atob` is a binary-string transform so each char-code is the raw byte
/// value \u2014 perfect for xterm.js `write(Uint8Array)`. Done inline (no
/// helper) inside the listen callback for one less function-call frame on
/// the hot path.
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/// Build spawn options for a duplicate/reconnect. If the original tab
/// registered a `respawn` callback, ask it for fresh `cmd`/`args` (e.g.
/// to allocate a new broker loopback port) and overlay them on top of
/// the rest of the original opts. Falls back to the captured args.
async function freshSpawnOpts(opts: SpawnOpts): Promise<SpawnOpts> {
  if (!opts.respawn) return opts;
  const next = await opts.respawn();
  return { ...opts, ...next };
}

export interface TerminalTab {
  id: number;          // local sequence id (also pty id reused for simplicity)
  title: string;
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  ptyId: number;
  exited: boolean;
  exitCode?: number;
  connectedAt: number;
  lastOutputAt: number;
  lastInputAt: number;
  unlistens: UnlistenFn[];
  /// Invalidates queued native/xterm callbacks before this renderer can be
  /// rebound to another PTY.
  deactivateSession: () => void;
  /// Per-session xterm subscriptions. These must be detached before a DOM
  /// renderer can be safely returned to the macOS reuse pool.
  terminalBindings: Array<{ dispose(): void }>;
  /// Imperative context-menu listener attached to the persistent host.
  contextMenuHandler: (event: MouseEvent) => void;
  /// Persistent DOM host for the xterm renderer. Created at spawn time and
  /// reused across navigations so the buffer survives unmount/remount of the
  /// Terminals page — xterm only repaints into the element it was first
  /// `open()`'d on, so we must keep that element alive and just re-parent it.
  host: HTMLDivElement;
  opened: boolean;
  /// Current WebGL renderer, retained briefly after the tab loses focus so
  /// quick switches can reuse its GPU context. The terminal view keeps at
  /// most two renderers and evicts the least recently used one.
  webglAddon: WebglAddon | null;
  /// Delayed renderer teardown for an inactive or unmounted tab.
  webglDetachTimer: number | null;
  /// Monotonic recency used by the terminal view's bounded WebGL LRU.
  webglLastUsedAt: number;
  /// Optional accent hex inherited from the saved session / device that
  /// spawned this tab. Used to tint the tab strip for at-a-glance ID.
  accent?: string;
  /// The arguments this tab was originally spawned with. Kept so the user
  /// can reconnect (close + re-spawn the same command) or duplicate the
  /// session into a new tab without re-deriving them from the device list.
  spawnOpts: SpawnOpts;
  /// Optional group label. Tabs that share a group are visually clustered
  /// in the tab strip and can be arranged into the mosaic as a unit.
  group?: string;
}

interface PooledTerminalRenderer {
  terminal: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  host: HTMLDivElement;
  opened: boolean;
}

function detachTerminalWebglAndBackingStores(tab: TerminalTab) {
  if (tab.webglDetachTimer != null) window.clearTimeout(tab.webglDetachTimer);
  tab.webglDetachTimer = null;
  if (!tab.webglAddon) return;
  const canvases = captureCanvasBackingStores(tab.host);
  const backingPixels = canvasBackingStorePixels(canvases);
  const addon = tab.webglAddon;
  tab.webglAddon = null;
  disposeWebglAddonAndContext(addon);
  releaseCanvasBackingStores(canvases, true);
  diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-memory", "Terminal WebGL backing stores released", {
    tab_id: tab.id,
    canvas_count: canvases.length,
    backing_pixels: backingPixels,
    remaining_canvas_count: document.querySelectorAll("canvas").length,
  });
}

function disposeTerminalAndBackingStores(tab: TerminalTab) {
  const canvases = captureCanvasBackingStores(tab.host);
  const backingPixels = canvasBackingStorePixels(canvases);
  const releaseWebglContext = prepareWebglContextRelease(tab.webglAddon);
  tab.webglAddon = null;
  try { tab.terminal.dispose(); } catch { /* renderer already stopped */ }
  finally {
    releaseWebglContext();
    releaseCanvasBackingStores(canvases, true);
  }
  diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-memory", "Terminal canvas backing stores released", {
    tab_id: tab.id,
    canvas_count: canvases.length,
    backing_pixels: backingPixels,
    remaining_canvas_count: document.querySelectorAll("canvas").length,
  });
}

function detachTerminalSessionBindings(tab: TerminalTab) {
  for (const binding of tab.terminalBindings.splice(0)) {
    try { binding.dispose(); } catch { /* already detached */ }
  }
  try { tab.host.removeEventListener("contextmenu", tab.contextMenuHandler, true); } catch { /* noop */ }
  // A pooled renderer must never retain a handler that can write to the old
  // PTY while it is parked between sessions.
  try { tab.terminal.attachCustomKeyEventHandler(() => false); } catch { /* noop */ }
}

function pooledRendererFromTab(tab: TerminalTab): PooledTerminalRenderer {
  return {
    terminal: tab.terminal,
    fit: tab.fit,
    search: tab.search,
    host: tab.host,
    opened: tab.opened,
  };
}

function disposePooledTerminalRenderer(renderer: PooledTerminalRenderer) {
  const canvases = captureCanvasBackingStores(renderer.host);
  const backingPixels = canvasBackingStorePixels(canvases);
  try { renderer.terminal.attachCustomKeyEventHandler(() => false); } catch { /* noop */ }
  try { renderer.terminal.blur(); } catch { /* noop */ }
  try { renderer.terminal.clearSelection(); } catch { /* noop */ }
  try { renderer.search.clearDecorations(); } catch { /* noop */ }
  try { renderer.terminal.dispose(); } catch { /* already stopped */ }
  finally { releaseCanvasBackingStores(canvases, true); }
  try { renderer.host.remove(); } catch { /* noop */ }
  return { canvasCount: canvases.length, backingPixels };
}

export interface SpawnOpts {
  title: string;
  cmd: string;
  serial?: {
    path: string;
    baudRate: number;
    dataBits: 5 | 6 | 7 | 8;
    parity: "none" | "odd" | "even";
    stopBits: 1 | 2;
    flowControl: "none" | "software" | "hardware";
  };
  args?: string[];
  cwd?: string;
  env?: [string, string][];
  /// One-shot password written only after an SSH-style password prompt is
  /// observed. Used for CE-Infra managed BookMe VM credentials.
  autoPassword?: string;
  accent?: string;
  /// Per-session opt-in: force the ANSI palette + foreground/cursor to be
  /// tinted with `accent`. Stacks with the global "Tint terminal text"
  /// toggle in Settings — either source turns it on.
  tintAnsi?: boolean;
  /// Override the global terminal scrollback (lines). When undefined we
  /// fall back to `appearance.terminalScrollback`.
  scrollback?: number;
  /// Absolute path of a file to append every byte of pty output to (with
  /// ANSI escapes stripped). The Rust pty reader writes directly so the
  /// transcript survives even if the UI tab is closed mid-stream.
  /// Undefined disables transcript saving for this tab.
  transcriptPath?: string;
  /// Re-derive `cmd`/`args` at duplicate/reconnect time. Needed for sessions
  /// whose args embed a transient resource — e.g. broker loopback ports
  /// from `openTunnel()` go away after `IDLE_TIMEOUT` and dialing the old
  /// port number gives ECONNREFUSED. When set, duplicate/reconnect call
  /// this instead of reusing the captured `args`. Local shells and
  /// direct-host SSH leave it undefined and replay the original args.
  respawn?: () => Promise<Pick<SpawnOpts, "cmd"> & Partial<Omit<SpawnOpts, "cmd" | "respawn">>>;
  /// Initial group label for the tab. May be changed later via
  /// `setTabGroup`. Stored on the SpawnOpts so duplicate/reconnect
  /// produces a tab in the same group.
  group?: string;
  /// Optional sidebar row identity ("d:<deviceId>" or "s:<sessionId>")
  /// that produced this tab. Used by the workspace-presets feature so
  /// a snapshot can list every open connection by stable row id.
  /// Untyped tabs (e.g. local shells) leave this undefined.
  rowKey?: string;
  /// Local shells and remote/device sessions need different Home/End escape
  /// sequences for Ctrl+A/Ctrl+E. Undefined keeps the session/device mapping.
  controlKeyMode?: TerminalControlKeyMode;
  /// Marks tabs whose respawn callback must refresh native credentials.
  /// Enables a visible reconnect status without exposing credential data.
  authenticationLabel?: string;
  /// Non-secret 1Password item reference used for on-demand password entry.
  /// Keeping the reference here lets the hotkey survive tab pop-out and
  /// reconnect without retaining the resolved password.
  passwordCredential?: OnePasswordCredentialRef;
}

export async function terminalPopoutOptions(tab: TerminalTab): Promise<SpawnOpts> {
  const fresh = await freshSpawnOpts(tab.spawnOpts);
  const { respawn: _respawn, ...serializable } = fresh;
  return serializable;
}

/// Layout arrangements offered when the user picks "Arrange this group".
/// `tabs` removes every group member from the layout (they remain open
/// as tabs that can be clicked to focus).
export type GroupArrange = "tabs" | TerminalWorkspaceArrange;

export type SplitOrientation = "horizontal" | "vertical";

export interface TerminalSplitWorkspace {
  id: string;
  name: string;
  layout: MosaicNode<number>;
}

interface Ctx {
  tabs: TerminalTab[];
  activeId: number | null;
  /// Mosaic layout tree. Leaves are tab ids; internal nodes are row/column
  /// splits with a percentage. `null` means the layout is empty (no panes
  /// visible, though `tabs` may still have entries the user hid).
  layout: MosaicNode<number> | null;
  /// Remembered multi-pane workspace. It remains available while an ordinary
  /// non-member tab is temporarily shown full-size.
  splitLayout: MosaicNode<number> | null;
  splitWorkspaces: TerminalSplitWorkspace[];
  activeSplitWorkspaceId: string | null;
  saveSplitWorkspace: (id: string | null, layout: MosaicNode<number>, name?: string) => string;
  activateSplitWorkspace: (id: string) => void;
  deleteSplitWorkspace: (id: string) => void;
  setActive: (id: number) => void;
  /// Move one tab immediately before another in the tab-strip order.
  reorderTab: (draggedId: number, targetId?: number, placement?: "before" | "after") => void;
  open: (opts: SpawnOpts) => Promise<number>;
  /// Write a ConneCat-owned status line without sending it to the PTY.
  /// Used by pre-connection tabs while native authentication is pending.
  writeNotice: (id: number, message: string, level?: "info" | "error") => void;
  /// Attach this window to an already-running native PTY. Used when moving
  /// a live SSH session between ConneCat windows without reconnecting.
  adopt: (opts: SpawnOpts, ptyId: number) => Promise<number>;
  close: (id: number) => Promise<void>;
  /// Drop this window's renderer/listeners but leave the native PTY alive.
  release: (id: number) => void;
  /// Kill the existing PTY for `id` and respawn the same command into a
  /// fresh tab. Convenient for SSH sessions that have died (or that you
  /// want to forcibly restart). The old tab is removed.
  reconnect: (id: number) => Promise<number | null>;
  /// Spawn another instance of the same command in a new tab. Both tabs
  /// run independently.
  duplicate: (id: number) => Promise<number | null>;
  /// Replace the layout (used as Mosaic's `onChange`). Pass `null` to clear.
  setLayout: (next: MosaicNode<number> | null) => void;
  /// Split the pane currently showing `targetId` along `direction` and place
  /// `newId` in the new sibling slot. No-op if `targetId` isn't in the
  /// layout. If the layout is empty, `newId` becomes the sole pane.
  splitWith: (targetId: number, newId: number, direction: MosaicDirection) => void;
  /// Remove `id` from the layout (the tab stays alive — re-show via setActive).
  removeFromLayout: (id: number) => void;
  /// Set or clear the group label of a tab. Pass `undefined` to remove
  /// it from its current group.
  setTabGroup: (id: number, group: string | undefined) => void;
  /// Replace the mosaic layout with every member of `group` arranged
  /// according to `mode`. `tabs` leaves the layout empty (group members
  /// stay open as background tabs).
  arrangeGroup: (group: string, mode: GroupArrange) => void;
  /// Rebuild the remembered split workspace, optionally adding hidden tabs.
  arrangeWorkspace: (mode: TerminalWorkspaceArrange, additionalIds?: number[]) => void;
  /// Set of group labels with broadcast input enabled. Typing in any
  /// member tab is mirrored to every other member's pty.
  broadcastGroups: ReadonlySet<string>;
  /// Toggle broadcast for a group on/off. Affects all current and future
  /// members of `group`.
  toggleGroupBroadcast: (group: string) => void;
  /// When true, typing in any tab is mirrored to every other live tab
  /// regardless of group. Composes with `broadcastGroups` (this flag
  /// wins because its scope is strictly larger).
  broadcastAll: boolean;
  /// Toggle the global broadcast-to-all-sessions flag.
  toggleBroadcastAll: () => void;
  /// Send arbitrary UTF-8 text to a single tab's pty as if the user
  /// typed it. Optional inter-line delay (ms) so devices that can't
  /// take a flood (older IOS, console-mode switches) still accept
  /// every command. The text is sent verbatim — callers responsible
  /// for normalising line endings (lf vs crlf vs cr) for the target.
  sendText: (tabId: number, text: string, lineDelayMs?: number) => Promise<void>;
  /// Send arbitrary text to every live member of `group`. Same line
  /// delay semantics as `sendText`. Useful for paste-style "apply this
  /// template to the whole group" actions.
  broadcastTextToGroup: (group: string, text: string, lineDelayMs?: number) => Promise<void>;
}

const TerminalsContext = createContext<Ctx | null>(null);

export function useTerminals(): Ctx {
  const c = useContext(TerminalsContext);
  if (!c) throw new Error("TerminalsProvider missing");
  return c;
}

export function TerminalsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [layout, setLayoutState] = useState<MosaicNode<number> | null>(null);
  const [splitLayout, setSplitLayoutState] = useState<MosaicNode<number> | null>(null);
  const [splitWorkspaces, setSplitWorkspaces] = useState<TerminalSplitWorkspace[]>([]);
  const [activeSplitWorkspaceId, setActiveSplitWorkspaceId] = useState<string | null>(null);
  const splitWorkspacesRef = useRef<TerminalSplitWorkspace[]>([]);
  splitWorkspacesRef.current = splitWorkspaces;
  const activeSplitWorkspaceIdRef = useRef<string | null>(null);
  activeSplitWorkspaceIdRef.current = activeSplitWorkspaceId;
  const [broadcastGroups, setBroadcastGroups] = useState<Set<string>>(() => new Set());
  const broadcastGroupsRef = useRef<Set<string>>(broadcastGroups);
  broadcastGroupsRef.current = broadcastGroups;
  const [broadcastAll, setBroadcastAll] = useState<boolean>(false);
  const broadcastAllRef = useRef<boolean>(false);
  broadcastAllRef.current = broadcastAll;
  const tabsRef = useRef<TerminalTab[]>([]);
  tabsRef.current = tabs;
  const activeIdRef = useRef<number | null>(null);
  const reconnectingRef = useRef<Set<number>>(new Set());
  const adoptingPtyIdsRef = useRef<Map<number, Promise<number>>>(new Map());
  const passwordRequestRef = useRef<number | null>(null);
  const passwordPromptTailsRef = useRef<Map<number, string>>(new Map());
  const terminalRendererPoolRef = useRef<PooledTerminalRenderer[]>([]);
  const closingOrReleasedTerminalIdsRef = useRef<Set<number>>(new Set());
  const providerUnmountedRef = useRef(false);
  activeIdRef.current = activeId;
  // MRU stack of recently active tab ids (most recent last). Used by
  // `close()` to pick a sensible “next active” tab and bring it back
  // into the layout, instead of dropping the user into the empty
  // “No panes visible” placeholder.
  const activeHistoryRef = useRef<number[]>([]);
  useEffect(() => {
    if (activeId == null) return;
    const h = activeHistoryRef.current;
    const last = h[h.length - 1];
    if (last === activeId) return;
    const idx = h.indexOf(activeId);
    if (idx >= 0) h.splice(idx, 1);
    h.push(activeId);
    if (h.length > 32) h.splice(0, h.length - 32);
  }, [activeId]);
  const layoutRef = useRef<MosaicNode<number> | null>(null);
  layoutRef.current = layout;
  const splitLayoutRef = useRef<MosaicNode<number> | null>(null);
  splitLayoutRef.current = splitLayout;

  // Explicit split changes are different from a quick tab switch: panes
  // removed from the layout are no longer about to remount. Release their
  // accelerated renderers after React commits the new layout instead of
  // leaving detached canvases alive for the normal 30-second reuse window.
  const releaseHiddenWebglRenderers = useCallback((candidateIds: readonly number[]) => {
    if (candidateIds.length === 0) return;
    const candidates = new Set(candidateIds);
    window.setTimeout(() => {
      for (const tab of tabsRef.current) {
        if (!candidates.has(tab.id) || containsLeaf(layoutRef.current, tab.id)) continue;
        detachTerminalWebglAndBackingStores(tab);
      }
    }, 0);
  }, []);

  useEffect(() => {
    if (!isMultiPaneLayout(splitLayout) || splitWorkspacesRef.current.length > 0) return;
    const migrated: TerminalSplitWorkspace = {
      id: `split-${Date.now()}`,
      name: "Split 1",
      layout: splitLayout!,
    };
    splitWorkspacesRef.current = [migrated];
    setSplitWorkspaces([migrated]);
    activeSplitWorkspaceIdRef.current = migrated.id;
    setActiveSplitWorkspaceId(migrated.id);
  }, [splitLayout]);
  const { appearance } = useAppearance();
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;

  const rendererPoolLimit = useCallback((liveTerminalCount: number) => {
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    return terminalRendererPoolLimit(
      appearanceRef.current.terminalRenderer,
      liveTerminalCount,
      userAgent,
    );
  }, []);

  const drainTerminalRendererPool = useCallback((reason: string, liveTerminalCount: number) => {
    const poolSizeBefore = terminalRendererPoolRef.current.length;
    const released = drainRendererPool(
      terminalRendererPoolRef.current,
      disposePooledTerminalRenderer,
    );
    diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-memory", "DOM terminal renderer pool drained", {
      reason,
      live_tab_count: liveTerminalCount,
      pool_limit: rendererPoolLimit(liveTerminalCount),
      pool_size_before: poolSizeBefore,
      pool_size_after: terminalRendererPoolRef.current.length,
      disposed_renderer_count: released.disposedRendererCount,
      canvas_count: released.canvasCount,
      backing_pixels: released.backingPixels,
      remaining_canvas_count: document.querySelectorAll("canvas").length,
    });
  }, [rendererPoolLimit]);

  const retireTerminalRenderer = useCallback((
    tab: TerminalTab,
    liveTerminalCount: number,
    allowPool = true,
  ) => {
    detachTerminalSessionBindings(tab);
    const poolLimit = rendererPoolLimit(liveTerminalCount);
    if (allowPool
      && poolLimit > 0
      && terminalRendererPoolRef.current.length < poolLimit) {
      try { tab.terminal.blur(); } catch { /* noop */ }
      try { tab.terminal.clearSelection(); } catch { /* noop */ }
      try { tab.search.clearDecorations(); } catch { /* noop */ }
      try { tab.terminal.reset(); } catch { /* noop */ }
      try { tab.terminal.clear(); } catch { /* noop */ }
      tab.host.style.width = "1px";
      tab.host.style.height = "1px";
      try { tab.terminal.resize(2, 1); } catch { /* noop */ }
      try { tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1)); } catch { /* noop */ }
      // Commit the small geometry before detaching so WebKit does not keep
      // the previous full-pane compositing layer for every pooled renderer.
      try { void tab.host.offsetWidth; } catch { /* noop */ }
      try { tab.host.remove(); } catch { /* noop */ }
      terminalRendererPoolRef.current.push(pooledRendererFromTab(tab));
      diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-memory", "DOM terminal renderer parked for reuse", {
        tab_id: tab.id,
        live_tab_count: liveTerminalCount,
        pool_size: terminalRendererPoolRef.current.length,
        pool_limit: poolLimit,
      });
      return;
    }
    disposeTerminalAndBackingStores(tab);
    try { tab.host.remove(); } catch { /* noop */ }
  }, [rendererPoolLimit]);

  // If the user switches away from macOS DOM mode, release parked renderers
  // immediately so a later WebGL session cannot accidentally inherit them.
  useEffect(() => {
    const limit = rendererPoolLimit(tabs.length);
    if (limit > 0 && terminalRendererPoolRef.current.length <= limit) return;
    drainTerminalRendererPool(
      tabs.length === 0 ? "no-live-terminals" : "renderer-mode-changed",
      tabs.length,
    );
  }, [appearance.terminalRenderer, drainTerminalRendererPool, rendererPoolLimit, tabs.length]);

  useEffect(() => {
    const liveIds = new Set(tabs.map((tab) => tab.id));
    for (const id of closingOrReleasedTerminalIdsRef.current) {
      if (!liveIds.has(id)) closingOrReleasedTerminalIdsRef.current.delete(id);
    }
  }, [tabs]);

  const writeBytesToPtyAndBroadcast = useCallback((sourcePtyId: number, bytes: number[]) => {
    invoke("pty_write", { id: sourcePtyId, data: bytes }).catch(() => {});
    // Broadcast: mirror terminal input to every other live pty when
    // `broadcastAll` is on, otherwise only to tabs in the same group
    // when that group is in the broadcast set. Read state through refs
    // so we always pick up the latest selection without re-binding.
    if (broadcastAllRef.current) {
      for (const t of tabsRef.current) {
        if (t.ptyId === sourcePtyId) continue;
        if (t.exited) continue;
        invoke("pty_write", { id: t.ptyId, data: bytes }).catch(() => {});
      }
    } else {
      const me = tabsRef.current.find((t) => t.ptyId === sourcePtyId);
      const g = me?.group;
      if (g && broadcastGroupsRef.current.has(g)) {
        for (const t of tabsRef.current) {
          if (t.ptyId === sourcePtyId) continue;
          if (t.group !== g) continue;
          if (t.exited) continue;
          invoke("pty_write", { id: t.ptyId, data: bytes }).catch(() => {});
        }
      }
    }
  }, []);

  const writeTextToPtyAndBroadcast = useCallback((sourcePtyId: number, text: string) => {
    writeBytesToPtyAndBroadcast(sourcePtyId, Array.from(UTF8_ENCODER.encode(text)));
  }, [writeBytesToPtyAndBroadcast]);

  const openOrAdopt = useCallback(async (
    opts: SpawnOpts,
    existingPtyId?: number,
    replacePaneId?: number,
  ): Promise<number> => {
    const a = appearanceRef.current.terminal;
    // The global "Tint terminal text" toggle and the per-session tintAnsi
    // checkbox now do the same thing: when there's an accent to tint with,
    // apply the full accent-shaded ANSI palette plus foreground/cursor.
    // Per-session tintAnsi uses the tab's card color. The global toggle
    // falls back to the terminal ANSI accent so terminal color can diverge
    // from the app/button/icon accent.
    const terminalAnsiAccent = getEffectiveTerminalAnsiAccent(appearanceRef.current);
    const effAccent = opts.accent
      || (appearanceRef.current.tintTerminalText ? terminalAnsiAccent : undefined);
    const wantTint =
      !!effAccent
      && (opts.tintAnsi === true || appearanceRef.current.tintTerminalText);
    const ansiTint = wantTint
      ? buildAnsiTint(effAccent!, a.theme.background ?? "#000000")
      : null;
    const tintFg = wantTint
      ? { foreground: effAccent!, cursor: effAccent! }
      : null;
    const theme = ansiTint || tintFg
      ? { ...a.theme, ...(ansiTint ?? {}), ...(tintFg ?? {}) }
      : a.theme;
    const scrollback = Math.max(100, Math.min(
      100000,
      opts.scrollback ?? appearanceRef.current.terminalScrollback ?? 1000,
    ));
    const initialGrid = initialTerminalGrid(
      window.innerWidth,
      window.innerHeight,
      a.fontSize,
    );
    const poolLimit = rendererPoolLimit(tabsRef.current.length);
    const pooledRenderer = poolLimit > 0
      ? terminalRendererPoolRef.current.pop()
      : undefined;
    let term: Terminal;
    let fit: FitAddon;
    let search: SearchAddon;
    let host: HTMLDivElement;
    let opened: boolean;
    if (pooledRenderer) {
      ({ terminal: term, fit, search, host, opened } = pooledRenderer);
      term.options.fontFamily = a.fontFamily;
      term.options.fontSize = a.fontSize;
      term.options.cursorBlink = true;
      term.options.convertEol = true;
      term.options.scrollback = scrollback;
      term.options.theme = theme;
      host.className = "terminals-pane-inner";
      host.style.width = "100%";
      host.style.height = "100%";
      try { term.resize(initialGrid.cols, initialGrid.rows); } catch { /* fitted after mount */ }
      diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-memory", "DOM terminal renderer reused", {
        live_tab_count: tabsRef.current.length,
        pool_size: terminalRendererPoolRef.current.length,
        pool_limit: poolLimit,
      });
    } else {
      term = new Terminal({
        fontFamily: a.fontFamily,
        fontSize: a.fontSize,
        cursorBlink: true,
        // Serial consoles and ROMMON commonly emit bare LF instead of the
        // CRLF produced by a Unix PTY. Keep subsequent lines at column zero.
        convertEol: true,
        cols: initialGrid.cols,
        rows: initialGrid.rows,
        scrollback,
        theme,
        allowProposedApi: true,
      });
      fit = new FitAddon();
      search = new SearchAddon({ highlightLimit: 1000 });
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.loadAddon(search);
      host = document.createElement("div");
      host.className = "terminals-pane-inner";
      host.style.width = "100%";
      host.style.height = "100%";
      opened = false;
    }
    const releaseUnattachedRenderer = () => {
      const liveTerminalCount = tabsRef.current.filter(
        (tab) => !closingOrReleasedTerminalIdsRef.current.has(tab.id),
      ).length;
      const failedOpenPoolLimit = rendererPoolLimit(liveTerminalCount);
      if (failedOpenPoolLimit === 0
        || terminalRendererPoolRef.current.length >= failedOpenPoolLimit) {
        disposePooledTerminalRenderer({ terminal: term, fit, search, host, opened });
        if (liveTerminalCount === 0) {
          drainTerminalRendererPool("failed-open-without-live-terminals", 0);
        }
        return;
      }
      try { term.attachCustomKeyEventHandler(() => false); } catch { /* noop */ }
      try { term.blur(); } catch { /* noop */ }
      try { term.clearSelection(); } catch { /* noop */ }
      try { search.clearDecorations(); } catch { /* noop */ }
      try { term.reset(); } catch { /* noop */ }
      try { term.clear(); } catch { /* noop */ }
      host.style.width = "1px";
      host.style.height = "1px";
      try { term.resize(2, 1); } catch { /* noop */ }
      try { term.refresh(0, Math.max(0, term.rows - 1)); } catch { /* noop */ }
      try { void host.offsetWidth; } catch { /* noop */ }
      try { host.remove(); } catch { /* noop */ }
      terminalRendererPoolRef.current.push({ terminal: term, fit, search, host, opened });
    };
    const backgroundFilter = wantTint ? new AnsiBackgroundFilter() : null;
    const writeTerminal = (bytes: Uint8Array) => term.write(backgroundFilter ? backgroundFilter.write(bytes) : bytes);

    // Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 → font zoom (per-tab, scoped to
    // the focused terminal). Other Ctrl shortcuts are sent explicitly so
    // xterm/browser defaults cannot leak ^A/^E text into the prompt.
    // Returning `false` tells xterm to swallow the key so it doesn't also
    // get sent to the pty as input. The reset key (`0`) snaps back to the
    // global appearance.terminal.fontSize.
    const baseFontSize = a.fontSize;
    let attachedPtyId: number | null = null;
    let sessionActive = true;
    term.attachCustomKeyEventHandler((ev) => {
      if (!sessionActive) return false;
      if (ev.type !== "keydown") return true;
      if (matchesTerminalSelectAllShortcut(ev)) {
        term.selectAll();
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }
      if (matchesTerminalNotesShortcut(ev, appearanceRef.current.terminalNotesShortcut)) {
        if (attachedPtyId != null) {
          window.dispatchEvent(new CustomEvent("catwalk:terminal-send-to-notes", { detail: { tabId: attachedPtyId } }));
        }
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (ev.key.toLowerCase() === "f" || ev.code === "KeyF")) {
        if (attachedPtyId != null) {
          window.dispatchEvent(new CustomEvent("catwalk:terminal-find", { detail: { tabId: attachedPtyId } }));
        }
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }
      if (!(ev.ctrlKey || ev.metaKey)) return true;
      const k = ev.key;
      const isPlus = k === "+" || k === "=" || ev.code === "Equal" || ev.code === "NumpadAdd";
      const isMinus = k === "-" || k === "_" || ev.code === "Minus" || ev.code === "NumpadSubtract";
      const isZero = k === "0" || ev.code === "Digit0" || ev.code === "Numpad0";
      if (!isPlus && !isMinus && !isZero) {
        const sequence = terminalControlSequenceForKeyEvent(ev, { mode: opts.controlKeyMode });
        if (!sequence || attachedPtyId == null) return true;
        writeTextToPtyAndBroadcast(attachedPtyId, sequence);
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }
      const cur = term.options.fontSize ?? baseFontSize;
      let next = cur;
      if (isPlus) next = Math.min(48, cur + 1);
      else if (isMinus) next = Math.max(6, cur - 1);
      else if (isZero) next = baseFontSize;
      if (next !== cur) {
        term.options.fontSize = next;
        try { fit.fit(); } catch { /* not attached yet */ }
      }
      ev.preventDefault();
      ev.stopPropagation();
      return false;
    });

    let ptyId: number;
    try {
      ptyId = existingPtyId ?? await (opts.serial
        ? invoke<number>("serial_open", {
            options: opts.serial,
            transcriptPath: opts.transcriptPath ?? null,
          })
        : invoke<number>("pty_spawn", {
          cmd: opts.cmd,
          args: opts.args ?? [],
          cwd: opts.cwd ?? null,
          env: opts.env ?? null,
          cols: initialGrid.cols,
          rows: initialGrid.rows,
          transcriptPath: opts.transcriptPath ?? null,
        }));
    } catch (error) {
      releaseUnattachedRenderer();
      throw error;
    }
    attachedPtyId = ptyId;
    const connectedAt = Date.now();
    let lastOutputAt = connectedAt;
    let lastInputAt = connectedAt;
    const markOutput = () => {
      lastOutputAt = Date.now();
      const current = tabsRef.current.find((tab) => tab.ptyId === ptyId);
      if (current) current.lastOutputAt = lastOutputAt;
    };

    const dataEv = `pty://${ptyId}/data`;
    const exitEv = `pty://${ptyId}/exit`;
    const unlistens: UnlistenFn[] = [];

    let autoPassword = existingPtyId == null ? opts.autoPassword : undefined;
    let promptTail = "";
    const promptDecoder = new TextDecoder();
    const observePasswordOutput = (bytes: Uint8Array) => {
      if (!autoPassword && !opts.passwordCredential) return;
      promptTail = (promptTail + promptDecoder.decode(bytes, { stream: true })).slice(-256);
      if (opts.passwordCredential) passwordPromptTailsRef.current.set(ptyId, promptTail);
      if (!autoPassword || !hasSshPasswordPrompt(promptTail)) return;
      const secret = autoPassword;
      autoPassword = undefined;
      promptTail = "";
      passwordPromptTailsRef.current.delete(ptyId);
      const encoded = Array.from(UTF8_ENCODER.encode(`${secret}\r`));
      diagnosticEvent("ssh_tunnel", "info", "catwalk.terminal-auth", "SSH password prompt detected; configured credential submitted", {
        pty_id: ptyId,
        authentication_source: opts.authenticationLabel || "configured credential",
      });
      invoke("pty_write", { id: ptyId, data: encoded }).catch((error) => {
        diagnosticEvent("ssh_tunnel", "error", "catwalk.terminal-auth", "Configured credential submission failed", {
          pty_id: ptyId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    if (autoPassword) {
      diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-auth", "Automatic password submission armed", {
        pty_id: ptyId,
        authentication_source: opts.authenticationLabel || "configured credential",
      });
    }
    let unData: UnlistenFn;
    try {
      unData = existingPtyId == null
        ? await listen<string>(dataEv, (e) => {
          if (!sessionActive) return;
          const bytes = b64ToBytes(e.payload);
          markOutput();
          writeTerminal(bytes);
          observePasswordOutput(bytes);
          })
        : await (async () => {
          type SequencedChunk = { sequence: number; data: string };
          type PtySnapshot = { sequence: number; data: string };
          const pending: SequencedChunk[] = [];
          let snapshotSequence: number | null = null;
          const unlisten = await listen<SequencedChunk>(`pty://${ptyId}/data-sequenced`, (e) => {
            if (!sessionActive) return;
            if (snapshotSequence == null) pending.push(e.payload);
            else if (e.payload.sequence > snapshotSequence) {
              const bytes = b64ToBytes(e.payload.data);
              markOutput();
              writeTerminal(bytes);
              observePasswordOutput(bytes);
            }
          });
          try {
            const snapshot = await invoke<PtySnapshot>("pty_snapshot", { id: ptyId });
            if (snapshot.data) {
              const bytes = b64ToBytes(snapshot.data);
              markOutput();
              writeTerminal(bytes);
              observePasswordOutput(bytes);
            }
            snapshotSequence = snapshot.sequence;
            for (const chunk of pending) {
              if (chunk.sequence > snapshot.sequence) {
                const bytes = b64ToBytes(chunk.data);
                markOutput();
                writeTerminal(bytes);
                observePasswordOutput(bytes);
              }
            }
          } catch (error) {
            unlisten();
            throw error;
          }
          return unlisten;
          })();
    } catch (error) {
      if (existingPtyId == null) void invoke("pty_kill", { id: ptyId }).catch(() => {});
      releaseUnattachedRenderer();
      throw error;
    }
    unlistens.push(unData);

    let unExit: UnlistenFn;
    try {
      unExit = await listen<number>(exitEv, (e) => {
        if (!sessionActive) return;
        const code = Number(e.payload);
        term.writeln(`\r\n\x1b[33m[process exited with code ${code}]\x1b[0m`);
        setTabs((cur) =>
          cur.map((t) => (t.ptyId === ptyId ? { ...t, exited: true, exitCode: code } : t)),
        );
      });
    } catch (error) {
      try { unData(); } catch { /* noop */ }
      if (existingPtyId == null) void invoke("pty_kill", { id: ptyId }).catch(() => {});
      releaseUnattachedRenderer();
      throw error;
    }
    unlistens.push(unExit);

    const terminalBindings: Array<{ dispose(): void }> = [];
    terminalBindings.push(term.onData((d) => {
      if (!sessionActive) return;
      promptTail = "";
      passwordPromptTailsRef.current.delete(ptyId);
      lastInputAt = Date.now();
      const current = tabsRef.current.find((tab) => tab.ptyId === ptyId);
      if (current) current.lastInputAt = lastInputAt;
      writeTextToPtyAndBroadcast(ptyId, d);
    }));
    terminalBindings.push(term.onResize(({ cols, rows }) => {
      if (!sessionActive) return;
      // A tab is briefly detached/reparented while switching or changing a
      // Mosaic layout. Never propagate that transient near-zero geometry to
      // the PTY: nested SSH and serial consoles would immediately wrap their
      // output into a handful of columns and corrupt the visible buffer.
      if (!isUsableTerminalGrid(cols, rows)) {
        diagnosticEvent("ssh_tunnel", "warn", "catwalk.terminal-resize", "Ignored unusable terminal geometry", {
          pty_id: ptyId,
          cols,
          rows,
        });
        return;
      }
      invoke("pty_resize", { id: ptyId, cols, rows }).catch(() => {});
    }));

    // Auto-copy on selection: mirror the typical Linux terminal UX where
    // simply highlighting text puts it on the clipboard, no Ctrl+C needed.
    // Fires on every selection change; only write when non-empty so we don't
    // clobber the clipboard on click-to-deselect. Gated by user preference
    // (read live from the ref so toggling Settings affects existing tabs).
    // Goes through the Tauri clipboard plugin — `navigator.clipboard` is
    // unreliable inside the webview (permission rejection on macOS/Linux).
    terminalBindings.push(term.onSelectionChange(() => {
      if (!sessionActive) return;
      if (!appearanceRef.current.terminalAutoCopySelection) return;
      const sel = term.getSelection();
      if (!sel) return;
      clipWriteText(sel).catch(() => {});
    }));

    // Right-click in a terminal pane has two modes, gated by the user
    // preference `terminalRightClickPaste`:
    //   * ON  — paste the system clipboard straight into the pty (default,
    //           matches PuTTY/iTerm behaviour).
    //   * OFF — open ConneCat's own pane context menu (Copy, Paste, Select
    //           All, Clear, Insert template…). The native OS menu is
    //           always suppressed so we control the UX consistently.
    // We fire a window-level CustomEvent in OFF mode rather than reach into
    // React state directly so the imperatively-built host stays decoupled
    // from the page that renders the menu.
    const contextMenuHandler = (e: MouseEvent) => {
      if (!sessionActive) return;
      e.preventDefault();
      e.stopPropagation();
      if (appearanceRef.current.terminalRightClickPaste) {
        clipReadText().then((text) => {
          const plainText = normalizeConsoleText(text);
          if (!plainText) return;
          const enc = UTF8_ENCODER.encode(plainText);
          invoke("pty_write", { id: ptyId, data: Array.from(enc) }).catch(() => {});
        }).catch(() => {});
        return;
      }
      window.dispatchEvent(new CustomEvent("catwalk:terminal-pane-menu", {
        detail: { tabId: ptyId, x: e.clientX, y: e.clientY },
      }));
    };
    host.addEventListener("contextmenu", contextMenuHandler, true);

    const tab: TerminalTab = {
      id: ptyId,
	      title: opts.title,
	      terminal: term,
	      fit,
	      search,
	      ptyId,
      exited: false,
      connectedAt,
      lastOutputAt,
      lastInputAt,
      unlistens,
      deactivateSession: () => {
        sessionActive = false;
        attachedPtyId = null;
      },
      terminalBindings,
      contextMenuHandler,
      host,
      opened,
      webglAddon: null,
      webglDetachTimer: null,
      webglLastUsedAt: 0,
      accent: opts.accent,
      spawnOpts: { ...opts, autoPassword: undefined },
      group: opts.group,
    };
    closingOrReleasedTerminalIdsRef.current.delete(ptyId);
    setTabs((cur) => [...cur, tab]);
    activeIdRef.current = ptyId;
    setActiveId(ptyId);
    if (replacePaneId != null) {
      // Reconnect is the one operation that intentionally swaps a pane in
      // place. Update both the visible layout and the remembered workspace
      // so restoring a group cannot resurrect the old terminal id.
      const currentLayout = layoutRef.current;
      const rememberedLayout = splitLayoutRef.current;
      const nextLayout = currentLayout != null && containsLeaf(currentLayout, replacePaneId)
        ? replaceLeaf(currentLayout, replacePaneId, ptyId) ?? ptyId
        : ptyId;
      const nextSplit = rememberedLayout != null && containsLeaf(rememberedLayout, replacePaneId)
        ? replaceLeaf(rememberedLayout, replacePaneId, ptyId)
        : rememberedLayout;
      const nextWorkspaces = splitWorkspacesRef.current.map((workspace) => (
        containsLeaf(workspace.layout, replacePaneId)
          ? { ...workspace, layout: replaceLeaf(workspace.layout, replacePaneId, ptyId) ?? workspace.layout }
          : workspace
      ));
      splitWorkspacesRef.current = nextWorkspaces;
      setSplitWorkspaces(nextWorkspaces);
      layoutRef.current = nextLayout;
      splitLayoutRef.current = nextSplit;
      setLayoutState(nextLayout);
      setSplitLayoutState(nextSplit);
    } else {
      // A newly opened session is a new tab, not a replacement pane. When a
      // group grid is visible, show the new tab on its own and retain the
      // grid as the remembered workspace. Clicking a group member restores
      // every original pane exactly where it was.
      const selection = selectTerminalWorkspace(
        layoutRef.current,
        splitLayoutRef.current,
        ptyId,
      );
      layoutRef.current = selection.layout;
      splitLayoutRef.current = selection.splitLayout;
      setLayoutState(selection.layout);
      setSplitLayoutState(selection.splitLayout);
    }
    return ptyId;
  }, [drainTerminalRendererPool, rendererPoolLimit, writeTextToPtyAndBroadcast]);

  const open = useCallback(
    (opts: SpawnOpts) => openOrAdopt(opts),
    [openOrAdopt],
  );

  const writeNotice = useCallback((id: number, message: string, level: "info" | "error" = "info") => {
    const tab = tabsRef.current.find((candidate) => candidate.id === id);
    if (!tab) return;
    const color = level === "error" ? "31" : "36";
    const safeMessage = message.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
    tab.terminal.writeln(`\r\n\x1b[${color}m${safeMessage}\x1b[0m`);
  }, []);

  const adopt = useCallback(
    (opts: SpawnOpts, ptyId: number) => {
      const existing = tabsRef.current.find((tab) => tab.ptyId === ptyId);
      if (existing) return Promise.resolve(existing.id);
      const pending = adoptingPtyIdsRef.current.get(ptyId);
      if (pending) return pending;
      const adoption = openOrAdopt(opts, ptyId).finally(() => {
        if (adoptingPtyIdsRef.current.get(ptyId) === adoption) {
          adoptingPtyIdsRef.current.delete(ptyId);
        }
      });
      adoptingPtyIdsRef.current.set(ptyId, adoption);
      return adoption;
    },
    [openOrAdopt],
  );

  const forgetSplitMember = useCallback((id: number) => {
    const nextWorkspaces = splitWorkspacesRef.current
      .map((workspace) => {
        const strippedWorkspace = removeLeaf(workspace.layout, id);
        return strippedWorkspace != null && isMultiPaneLayout(strippedWorkspace)
          ? { ...workspace, layout: strippedWorkspace }
          : null;
      })
      .filter((workspace): workspace is TerminalSplitWorkspace => workspace != null);
    splitWorkspacesRef.current = nextWorkspaces;
    setSplitWorkspaces(nextWorkspaces);
    const stripped = removeLeaf(splitLayoutRef.current, id);
    const nextSplit = isMultiPaneLayout(stripped) ? stripped : null;
    splitLayoutRef.current = nextSplit;
    setSplitLayoutState(nextSplit);
    if (activeSplitWorkspaceIdRef.current
        && !nextWorkspaces.some((workspace) => workspace.id === activeSplitWorkspaceIdRef.current)) {
      activeSplitWorkspaceIdRef.current = null;
      setActiveSplitWorkspaceId(null);
    }
  }, []);

  const release = useCallback((id: number) => {
    if (closingOrReleasedTerminalIdsRef.current.has(id)) return;
    const tab = tabsRef.current.find((candidate) => candidate.id === id);
    if (!tab) return;
    closingOrReleasedTerminalIdsRef.current.add(id);
    tab.deactivateSession();
    for (const un of tab.unlistens) {
      try { un(); } catch { /* noop */ }
    }
    tab.unlistens.length = 0;
    if (tab.webglDetachTimer != null) window.clearTimeout(tab.webglDetachTimer);
    tab.webglDetachTimer = null;
    const remainingCount = remainingLiveTerminalCount(
      tabsRef.current.map((candidate) => candidate.id),
      closingOrReleasedTerminalIdsRef.current,
      id,
    );
    const remaining = tabsRef.current.filter((candidate) => (
      candidate.id !== id && !closingOrReleasedTerminalIdsRef.current.has(candidate.id)
    ));
    retireTerminalRenderer(tab, remainingCount);
    if (remainingCount === 0) drainTerminalRendererPool("last-terminal-released", 0);
    passwordPromptTailsRef.current.delete(id);
    if (passwordRequestRef.current === id) passwordRequestRef.current = null;
    setTabs((cur) => cur.filter((candidate) => candidate.id !== id));
    setLayoutState((cur) => removeLeaf(cur, id));
    forgetSplitMember(id);
    setActiveId((cur) => {
      if (cur !== id) return cur;
      return remaining.length ? remaining[remaining.length - 1].id : null;
    });
  }, [drainTerminalRendererPool, forgetSplitMember, retireTerminalRenderer]);

  const close = useCallback(async (id: number) => {
    if (closingOrReleasedTerminalIdsRef.current.has(id)) return;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    closingOrReleasedTerminalIdsRef.current.add(id);
    tab.deactivateSession();
    for (const un of tab.unlistens) {
      try { un(); } catch {}
    }
    tab.unlistens.length = 0;
    try { await invoke("pty_kill", { id: tab.ptyId }); } catch {}
    if (providerUnmountedRef.current) return;
    if (tab.webglDetachTimer != null) window.clearTimeout(tab.webglDetachTimer);
    tab.webglDetachTimer = null;
    const remainingCount = remainingLiveTerminalCount(
      tabsRef.current.map((candidate) => candidate.id),
      closingOrReleasedTerminalIdsRef.current,
      id,
    );
    const remaining = tabsRef.current.filter((candidate) => (
      candidate.id !== id && !closingOrReleasedTerminalIdsRef.current.has(candidate.id)
    ));
    retireTerminalRenderer(tab, remainingCount);
    if (remainingCount === 0) drainTerminalRendererPool("last-terminal-closed", 0);
    passwordPromptTailsRef.current.delete(id);
    if (passwordRequestRef.current === id) passwordRequestRef.current = null;
    setTabs((cur) => cur.filter((t) => t.id !== id));
    forgetSplitMember(id);
    // Drop the closed id from the MRU so it can't be chosen as the
    // next active tab below.
    const hist = activeHistoryRef.current;
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i] === id) hist.splice(i, 1);
    // Choose the next-active tab: most recent in MRU that still exists,
    // else the last tab in the list. May be null if nothing remains.
    let nextActive: number | null = null;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (remaining.some((t) => t.id === hist[i])) { nextActive = hist[i]; break; }
    }
    if (nextActive == null && remaining.length > 0) nextActive = remaining[remaining.length - 1].id;
    setLayoutState((cur) => {
      const stripped = removeLeaf(cur, id);
      // If removing the closed tab collapsed the mosaic to empty but we
      // still have tabs alive, surface the next-active one so the user
      // isn’t dropped into the empty placeholder.
      if (stripped == null && nextActive != null) return nextActive;
      return stripped;
    });
    setActiveId((cur) => (cur === id ? nextActive : cur));
  }, [drainTerminalRendererPool, forgetSplitMember, retireTerminalRenderer]);

  const duplicate = useCallback(async (id: number): Promise<number | null> => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return null;
    return open(await freshSpawnOpts(tab.spawnOpts));
  }, [open]);

  const reconnect = useCallback(async (id: number): Promise<number | null> => {
    if (reconnectingRef.current.has(id)) return null;
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return null;
    reconnectingRef.current.add(id);
    if (tab.spawnOpts.authenticationLabel) {
      writeNotice(id, `Waiting for ${tab.spawnOpts.authenticationLabel} authorization...`);
    }
    try {
      const opts = await freshSpawnOpts(tab.spawnOpts);
      // Keep the old renderer as the visible authorization surface, but end
      // its native SSH process before spawning the replacement. Otherwise
      // both remote sessions are briefly live during every reconnect.
      try { await invoke("pty_kill", { id: tab.ptyId }); } catch { /* close retries below */ }
      const newId = await openOrAdopt(opts, undefined, id);
      await close(id);
      return newId;
    } catch (error) {
      writeNotice(id, `Reconnect failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      return null;
    } finally {
      reconnectingRef.current.delete(id);
    }
  }, [openOrAdopt, close, writeNotice]);

  const activateSplitWorkspace = useCallback((id: string) => {
    const workspace = splitWorkspacesRef.current.find((candidate) => candidate.id === id);
    if (!workspace) return;
    activeSplitWorkspaceIdRef.current = id;
    setActiveSplitWorkspaceId(id);
    splitLayoutRef.current = workspace.layout;
    layoutRef.current = workspace.layout;
    setSplitLayoutState(workspace.layout);
    setLayoutState(workspace.layout);
    const currentActive = activeIdRef.current;
    const members = terminalWorkspaceIds(workspace.layout);
    const nextActive = currentActive != null && members.includes(currentActive) ? currentActive : members[0];
    activeIdRef.current = nextActive;
    setActiveId(nextActive);
  }, []);

  const saveSplitWorkspace = useCallback((
    id: string | null,
    nextLayout: MosaicNode<number>,
    name?: string,
  ): string => {
    const workspaceId = id ?? `split-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const existing = splitWorkspacesRef.current.find((workspace) => workspace.id === workspaceId);
    const workspaceName = name?.trim() || existing?.name || `Split ${splitWorkspacesRef.current.length + 1}`;
    // Workspaces are independent saved views. A session may intentionally
    // appear in several layouts, just like the same document can be part of
    // several editor workspaces. Updating one must never rewrite or delete
    // the others.
    const nextWorkspace = { id: workspaceId, name: workspaceName, layout: nextLayout };
    const nextWorkspaces = existing
      ? splitWorkspacesRef.current.map((workspace) => (
          workspace.id === workspaceId ? nextWorkspace : workspace
        ))
      : [...splitWorkspacesRef.current, nextWorkspace];
    splitWorkspacesRef.current = nextWorkspaces;
    setSplitWorkspaces(nextWorkspaces);
    activeSplitWorkspaceIdRef.current = workspaceId;
    setActiveSplitWorkspaceId(workspaceId);
    splitLayoutRef.current = nextLayout;
    layoutRef.current = nextLayout;
    setSplitLayoutState(nextLayout);
    setLayoutState(nextLayout);
    return workspaceId;
  }, []);

  const deleteSplitWorkspace = useCallback((id: string) => {
    const deletedWorkspace = splitWorkspacesRef.current.find((workspace) => workspace.id === id);
    const nextWorkspaces = splitWorkspacesRef.current.filter((workspace) => workspace.id !== id);
    splitWorkspacesRef.current = nextWorkspaces;
    setSplitWorkspaces(nextWorkspaces);
    if (activeSplitWorkspaceIdRef.current !== id) return;
    activeSplitWorkspaceIdRef.current = null;
    setActiveSplitWorkspaceId(null);
    splitLayoutRef.current = null;
    setSplitLayoutState(null);
    const fallback = activeIdRef.current ?? tabsRef.current[0]?.id ?? null;
    layoutRef.current = fallback;
    setLayoutState(fallback);
    releaseHiddenWebglRenderers(terminalWorkspaceIds(deletedWorkspace?.layout ?? null));
  }, [releaseHiddenWebglRenderers]);

  const setLayout = useCallback((next: MosaicNode<number> | null) => {
    const previousIds = terminalWorkspaceIds(layoutRef.current);
    const nextSplit = isMultiPaneLayout(next) ? next : null;
    splitLayoutRef.current = nextSplit;
    setSplitLayoutState(nextSplit);
    layoutRef.current = next;
    setLayoutState(next);
    const activeWorkspaceId = activeSplitWorkspaceIdRef.current;
    if (activeWorkspaceId && nextSplit) {
      const nextWorkspaces = splitWorkspacesRef.current.map((workspace) => (
        workspace.id === activeWorkspaceId ? { ...workspace, layout: nextSplit } : workspace
      ));
      splitWorkspacesRef.current = nextWorkspaces;
      setSplitWorkspaces(nextWorkspaces);
    }
    releaseHiddenWebglRenderers(previousIds);
  }, [releaseHiddenWebglRenderers]);

  const splitWith = useCallback(
    (targetId: number, newId: number, direction: MosaicDirection) => {
      setLayoutState((cur) => {
        if (cur == null) return newId;
        // Already in the layout? Just bring it back into the focused slot.
        if (containsLeaf(cur, newId)) return cur;
        const split: MosaicNode<number> = {
          direction,
          first: targetId,
          second: newId,
          splitPercentage: 50,
        };
        const next = replaceLeaf(cur, targetId, split) ?? split;
        layoutRef.current = next;
        splitLayoutRef.current = next;
        setSplitLayoutState(next);
        return next;
      });
      activeIdRef.current = newId;
      setActiveId(newId);
    },
    [],
  );

  const removeFromLayout = useCallback((id: number) => {
    const next = removeLeaf(layoutRef.current, id);
    layoutRef.current = next;
    setLayoutState(next);
    const nextSplit = isMultiPaneLayout(next) ? next : null;
    splitLayoutRef.current = nextSplit;
    setSplitLayoutState(nextSplit);
    const currentActive = activeIdRef.current;
    if (next == null) {
      activeIdRef.current = null;
      setActiveId(null);
    } else if (currentActive === id || currentActive == null || !containsLeaf(next, currentActive)) {
      const nextActive = firstTerminalPane(next);
      activeIdRef.current = nextActive;
      setActiveId(nextActive);
    }
    releaseHiddenWebglRenderers([id]);
  }, [releaseHiddenWebglRenderers]);

  const setTabGroup = useCallback((id: number, group: string | undefined) => {
    const cleaned = group?.trim() || undefined;
    setTabs((cur) => cur.map((t) => (
      t.id === id
        ? { ...t, group: cleaned, spawnOpts: { ...t.spawnOpts, group: cleaned } }
        : t
    )));
  }, []);

  const reorderTab = useCallback((
    draggedId: number,
    targetId?: number,
    placement: "before" | "after" = "before",
  ) => {
    if (draggedId === targetId) return;
    setTabs((current) => {
      const draggedIndex = current.findIndex((tab) => tab.id === draggedId);
      if (draggedIndex < 0 || (targetId != null && !current.some((tab) => tab.id === targetId))) return current;
      const next = [...current];
      const [dragged] = next.splice(draggedIndex, 1);
      const targetIndex = targetId == null ? next.length : next.findIndex((tab) => tab.id === targetId);
      const insertionIndex = targetId != null && placement === "after" ? targetIndex + 1 : targetIndex;
      next.splice(insertionIndex, 0, dragged);
      return next;
    });
    if (targetId != null) {
      const activeWorkspaceId = activeSplitWorkspaceIdRef.current;
      const nextWorkspaces = splitWorkspacesRef.current.map((workspace) => ({
        ...workspace,
        // Shared sessions can exist in several workspaces. A drag only
        // reorders the workspace it came from; the other saved views must
        // retain their independent layouts.
        layout: workspace.id === activeWorkspaceId
          ? reorderTerminalWorkspace(workspace.layout, draggedId, targetId, placement) ?? workspace.layout
          : workspace.layout,
      }));
      splitWorkspacesRef.current = nextWorkspaces;
      setSplitWorkspaces(nextWorkspaces);
      const previousSplit = splitLayoutRef.current;
      const nextSplit = reorderTerminalWorkspace(
        previousSplit, draggedId, targetId, placement,
      );
      if (nextSplit !== previousSplit) {
        splitLayoutRef.current = nextSplit;
        setSplitLayoutState(nextSplit);
        const currentLayout = layoutRef.current;
        if (currentLayout != null
            && containsLeaf(currentLayout, draggedId)
            && containsLeaf(currentLayout, targetId)) {
          const nextLayout = reorderTerminalWorkspace(
            currentLayout, draggedId, targetId, placement,
          );
          layoutRef.current = nextLayout;
          setLayoutState(nextLayout);
        }
      }
    }
  }, []);

  const toggleGroupBroadcast = useCallback((group: string) => {
    setBroadcastGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const toggleBroadcastAll = useCallback(() => {
    setBroadcastAll((v) => !v);
  }, []);

  // Shared low-level send. Splits on newlines and pty_writes each line
  // followed by a CR, pausing `lineDelayMs` between lines so we don't
  // overrun slow devices. lineDelayMs=0 sends the whole buffer in a
  // single pty_write (paste behaviour). Note: we DO NOT echo to xterm —
  // the device echoes back through the normal pty data channel.
  const sendBufferToPty = useCallback(
    async (ptyId: number, text: string, lineDelayMs: number): Promise<void> => {
      if (lineDelayMs <= 0) {
        const bytes = Array.from(UTF8_ENCODER.encode(text));
        try { await invoke("pty_write", { id: ptyId, data: bytes }); } catch {}
        return;
      }
      // Normalise CRLF / CR to LF first so we send one CR per logical
      // line regardless of source. Trailing empty line is preserved.
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const send = i < lines.length - 1 ? line + "\r" : line;
        const bytes = Array.from(UTF8_ENCODER.encode(send));
        try { await invoke("pty_write", { id: ptyId, data: bytes }); } catch {}
        if (i < lines.length - 1 && lineDelayMs > 0) {
          await new Promise((r) => setTimeout(r, lineDelayMs));
        }
      }
    },
    [],
  );

  const sendText = useCallback(
    async (tabId: number, text: string, lineDelayMs = 60): Promise<void> => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || tab.exited) return;
      tab.lastInputAt = Date.now();
      await sendBufferToPty(tab.ptyId, text, lineDelayMs);
    },
    [sendBufferToPty],
  );

  // Fanout in parallel: each member's pty is independent so we don't
  // need to serialise across tabs (only across lines within a tab).
  const broadcastTextToGroup = useCallback(
    async (group: string, text: string, lineDelayMs = 60): Promise<void> => {
      const members = tabsRef.current.filter((t) => t.group === group && !t.exited);
      const sentAt = Date.now();
      members.forEach((tab) => { tab.lastInputAt = sentAt; });
      await Promise.all(members.map((t) => sendBufferToPty(t.ptyId, text, lineDelayMs)));
    },
    [sendBufferToPty],
  );

  const arrangeGroup = useCallback((group: string, mode: GroupArrange) => {
    const members = tabsRef.current.filter((t) => t.group === group).map((t) => t.id);
    if (members.length === 0) return;
    if (mode === "tabs") {
      let next: MosaicNode<number> | null = layoutRef.current;
      for (const id of members) next = removeLeaf(next, id);
      layoutRef.current = next;
      setLayoutState(next);
      const nextSplit = isMultiPaneLayout(next) ? next : null;
      splitLayoutRef.current = nextSplit;
      setSplitLayoutState(nextSplit);
      releaseHiddenWebglRenderers(members);
      return;
    }
    if (members.length === 1) {
      layoutRef.current = members[0];
      splitLayoutRef.current = null;
      setLayoutState(members[0]);
      setSplitLayoutState(null);
      activeIdRef.current = members[0];
      setActiveId(members[0]);
      return;
    }
    const layout = arrangeTerminalWorkspace(members, mode);
    layoutRef.current = layout;
    splitLayoutRef.current = layout;
    setLayoutState(layout);
    setSplitLayoutState(layout);
    activeIdRef.current = members[0];
    setActiveId(members[0]);
  }, [releaseHiddenWebglRenderers]);

  const arrangeWorkspace = useCallback((
    mode: TerminalWorkspaceArrange,
    additionalIds: number[] = [],
  ) => {
    const remembered = splitLayoutRef.current ?? layoutRef.current;
    const available = new Set(tabsRef.current.map((tab) => tab.id));
    const members = [...new Set([
      ...terminalWorkspaceIds(remembered),
      ...additionalIds,
    ])].filter((id) => available.has(id));
    if (members.length === 0) return;
    const next = arrangeTerminalWorkspace(members, mode);
    const nextSplit = isMultiPaneLayout(next) ? next : null;
    layoutRef.current = next;
    splitLayoutRef.current = nextSplit;
    setLayoutState(next);
    setSplitLayoutState(nextSplit);
    const currentActive = activeIdRef.current;
    const nextActive = currentActive != null && members.includes(currentActive)
      ? currentActive
      : members[0];
    activeIdRef.current = nextActive;
    setActiveId(nextActive);
  }, []);

  const setActive = useCallback((id: number) => {
    // Prefer the selected workspace when a tab belongs to several saved
    // layouts. Falling back to the first matching workspace preserves the
    // old behavior for activation from global shortcuts or notifications.
    const activeWorkspace = splitWorkspacesRef.current.find((candidate) => (
      candidate.id === activeSplitWorkspaceIdRef.current
      && terminalWorkspaceIds(candidate.layout).includes(id)
    ));
    const workspace = activeWorkspace ?? splitWorkspacesRef.current.find((candidate) => (
      terminalWorkspaceIds(candidate.layout).includes(id)
    ));
    if (workspace) {
      activateSplitWorkspace(workspace.id);
      activeIdRef.current = id;
      setActiveId(id);
      return;
    }
    activeIdRef.current = id;
    setActiveId(id);
    const selection = selectTerminalWorkspace(layoutRef.current, splitLayoutRef.current, id);
    layoutRef.current = selection.layout;
    splitLayoutRef.current = selection.splitLayout;
    setLayoutState(selection.layout);
    setSplitLayoutState(selection.splitLayout);
  }, [activateSplitWorkspace]);

  // Kill all on app unmount.
  useEffect(() => {
    providerUnmountedRef.current = false;
    return () => {
      providerUnmountedRef.current = true;
      for (const t of tabsRef.current) {
        t.deactivateSession();
        for (const un of t.unlistens) { try { un(); } catch {} }
        t.unlistens.length = 0;
        if (t.webglDetachTimer != null) window.clearTimeout(t.webglDetachTimer);
        t.webglDetachTimer = null;
        invoke("pty_kill", { id: t.ptyId }).catch(() => {});
        detachTerminalSessionBindings(t);
        disposeTerminalAndBackingStores(t);
        try { t.host.remove(); } catch {}
      }
      tabsRef.current = [];
      closingOrReleasedTerminalIdsRef.current.clear();
      drainTerminalRendererPool("provider-unmounted", 0);
    };
  }, [drainTerminalRendererPool]);

  // Window-level capture-phase intercept of Ctrl/Cmd +/-/0 so the Tauri
  // webview can't run its built-in page-zoom accelerator (most visible on
  // macOS where Cmd+= / Cmd+- never reach xterm's textarea). When focus is
  // inside a live terminal host we change that term's font size and re-fit
  // so the buffer rewraps to the new cell size; the per-tab xterm handler
  // installed in `open()` stays as the inner fallback for non-zoom keys.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key;
      const isFind = !ev.altKey && !ev.shiftKey && (k.toLowerCase() === "f" || ev.code === "KeyF");
      const isPassword = matchesTerminalPasswordShortcut(
        ev,
        appearanceRef.current.onePasswordShortcut,
      );
      const isPlus = k === "+" || k === "=" || ev.code === "Equal" || ev.code === "NumpadAdd";
      const isMinus = k === "-" || k === "_" || ev.code === "Minus" || ev.code === "NumpadSubtract";
      const isZero = k === "0" || ev.code === "Digit0" || ev.code === "Numpad0";
      const focused = document.activeElement as HTMLElement | null;
      const focusedTab = tabsRef.current.find((t) =>
        focused ? t.host.contains(focused) : t.id === activeIdRef.current,
      );
      const tab = focusedTab ?? tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (isPassword) {
        const passwordTab = tab;
        const credential = passwordTab?.spawnOpts.passwordCredential;
        if (!passwordTab || passwordTab.exited || !credential) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!tabHasActivePasswordPrompt(passwordTab, passwordPromptTailsRef.current.get(passwordTab.id) ?? "")) {
          emitPasswordShortcutStatus(passwordTab.id, "blocked", "No active password prompt. Nothing was sent.");
          return;
        }
        if (passwordRequestRef.current != null) {
          emitPasswordShortcutStatus(passwordTab.id, "blocked", "Credential retrieval is already in progress.");
          return;
        }
        passwordRequestRef.current = passwordTab.id;
        emitPasswordShortcutStatus(passwordTab.id, "retrieving", "Retrieving configured credentials…");
        diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-auth", "On-demand password retrieval started", {
          pty_id: passwordTab.ptyId,
          authentication_source: passwordTab.spawnOpts.authenticationLabel || "configured credential",
        });
        void resolveOnePasswordLogin(credential)
          .then(({ password }) => {
            const current = tabsRef.current.find((candidate) => candidate.id === passwordTab.id);
            if (!password || !current || current.exited) return;
            if (!tabHasActivePasswordPrompt(current, passwordPromptTailsRef.current.get(current.id) ?? "")) {
              emitPasswordShortcutStatus(current.id, "blocked", "Password prompt is no longer active. Nothing was sent.");
              return;
            }
            passwordPromptTailsRef.current.delete(current.id);
            // Deliberately bypass terminal broadcast mode for secrets.
            return invoke("pty_write", {
              id: current.ptyId,
              data: Array.from(UTF8_ENCODER.encode(`${password}\r`)),
            }).then(() => {
              diagnosticEvent("ssh_tunnel", "info", "catwalk.terminal-auth", "Configured password submitted on demand", {
                pty_id: current.ptyId,
                authentication_source: current.spawnOpts.authenticationLabel || "configured credential",
              });
              emitPasswordShortcutStatus(current.id, "sent", "Password sent to the active prompt.");
            });
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            diagnosticEvent("ssh_tunnel", "error", "catwalk.terminal-auth", "On-demand password submission failed", {
              pty_id: passwordTab.ptyId,
              error: message,
            });
            addLocalNotification({
              kind: "error",
              title: "Password retrieval failed",
              body: message || "The configured session password could not be retrieved.",
            });
            emitPasswordShortcutStatus(passwordTab.id, "error", "Password retrieval failed.");
          })
          .finally(() => {
            if (passwordRequestRef.current === passwordTab.id) passwordRequestRef.current = null;
          });
        return;
      }
      if (isFind) {
        if (!tab) return;
        window.dispatchEvent(new CustomEvent("catwalk:terminal-find", { detail: { tabId: tab.id } }));
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (!isPlus && !isMinus && !isZero) {
        const controlSequence = terminalControlSequenceForKeyEvent(ev, {
          mode: focusedTab?.spawnOpts.controlKeyMode,
        });
        if (!controlSequence || !focusedTab || focusedTab.exited) return;
        writeTextToPtyAndBroadcast(focusedTab.ptyId, controlSequence);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (!tab) return;
      const baseFontSize = appearanceRef.current.terminal.fontSize;
      const cur = tab.terminal.options.fontSize ?? baseFontSize;
      let next = cur;
      if (isPlus) next = Math.min(48, cur + 1);
      else if (isMinus) next = Math.max(6, cur - 1);
      else if (isZero) next = baseFontSize;
      if (next !== cur) {
        tab.terminal.options.fontSize = next;
        try { tab.fit.fit(); } catch { /* not attached */ }
      }
      ev.preventDefault();
      ev.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [writeTextToPtyAndBroadcast]);

  const value = useMemo<Ctx>(
    () => ({
      tabs,
      activeId,
      layout,
      splitLayout,
      splitWorkspaces,
      activeSplitWorkspaceId,
      saveSplitWorkspace,
      activateSplitWorkspace,
      deleteSplitWorkspace,
      setActive,
      reorderTab,
      open,
      writeNotice,
      adopt,
      close,
      release,
      reconnect,
      duplicate,
      setLayout,
      splitWith,
      removeFromLayout,
      setTabGroup,
      arrangeGroup,
      arrangeWorkspace,
      broadcastGroups,
      toggleGroupBroadcast,
      broadcastAll,
      toggleBroadcastAll,
      sendText,
      broadcastTextToGroup,
    }),
    [tabs, activeId, layout, splitLayout, splitWorkspaces, activeSplitWorkspaceId, saveSplitWorkspace, activateSplitWorkspace, deleteSplitWorkspace, setActive, reorderTab, open, writeNotice, close, reconnect, duplicate, setLayout, splitWith, removeFromLayout, setTabGroup, arrangeGroup, arrangeWorkspace, broadcastGroups, toggleGroupBroadcast, broadcastAll, toggleBroadcastAll, sendText, broadcastTextToGroup],
  );

  return <TerminalsContext.Provider value={value}>{children}</TerminalsContext.Provider>;
}

// ---------------------------------------------------------------------------
// Mosaic tree helpers. Mosaic represents nodes as either a leaf value or a
// `{ direction, first, second, splitPercentage }` object — we work with the
// raw tree because the package's MosaicHelpers expect a specific path-driven
// API that doesn't fit our by-id mutations.

function isParent<T extends MosaicKey>(n: MosaicNode<T>): n is { direction: MosaicDirection; first: MosaicNode<T>; second: MosaicNode<T>; splitPercentage?: number } {
  return typeof n === "object" && n !== null && "direction" in n;
}

function containsLeaf<T extends MosaicKey>(node: MosaicNode<T> | null, id: T): boolean {
  if (node == null) return false;
  if (!isParent(node)) return node === id;
  return containsLeaf(node.first, id) || containsLeaf(node.second, id);
}

function removeLeaf<T extends MosaicKey>(node: MosaicNode<T> | null, id: T): MosaicNode<T> | null {
  if (node == null) return null;
  if (!isParent(node)) return node === id ? null : node;
  const first = removeLeaf(node.first, id);
  const second = removeLeaf(node.second, id);
  if (first == null && second == null) return null;
  if (first == null) return second;
  if (second == null) return first;
  return { ...node, first, second };
}

function replaceLeaf<T extends MosaicKey>(node: MosaicNode<T> | null, oldId: T, replacement: MosaicNode<T>): MosaicNode<T> | null {
  if (node == null) return null;
  if (!isParent(node)) return node === oldId ? replacement : node;
  return {
    ...node,
    first: replaceLeaf(node.first, oldId, replacement) ?? node.first,
    second: replaceLeaf(node.second, oldId, replacement) ?? node.second,
  };
}

// ---------------------------------------------------------------------------
