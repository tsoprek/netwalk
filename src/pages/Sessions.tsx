import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import SessionSettingsPanel from "../components/SessionSettingsPanel";
import FocusGrid from "../components/FocusGrid";
import GuestOsIcon from "../components/GuestOsIcon";
import ContextMenu, { captureContextMenu, type ContextMenuItem, type ContextMenuPosition } from "../components/ContextMenu";
import NotesIcon, { type NotesIconName } from "../components/NotesIcon";
import ActionIconLegend from "../components/ActionIconLegend";
import ThemedSelect from "../components/ThemedSelect";
import UnsavedSettingsDialog from "../components/UnsavedSettingsDialog";
import {
  classifyInventoryType,
  detectInventoryOs,
  inventoryOsOptions,
  matchesInventoryType,
  type InventoryTypeFilter,
} from "../api/inventoryFilters";
import {
  SavedSession,
  SavedSessionTunnel,
  SessionGroup,
  SessionProtocol,
  assignSessionToGroup,
  compareSessionsForDisplay,
  deleteGroup,
  deleteSession,
  effectiveSessionConnections,
  exportAll,
  exportAllGroups,
  listGroups,
  listSessions,
  newGroupId,
  newId,
  reorderSession,
  reorderGroup,
  normalizedSessionTunnels,
  sessionSshForwardArgs,
  sessionSshForwardSpecs,
  touchSession,
  upsertGroup,
  upsertSession,
} from "../api/sessions";
import { pushSshDestWithVimFix, pushSshDestPlain } from "../api/sshVimFix";
import {
  browseUrl,
  getSshKeyPath,
  openUntrustedBrowserProxy,
  openUrl,
  probeHost,
  BROWSE_OPEN_WINDOW,
  BROWSE_OPEN_EXTERNAL,
  SSH_APP_INAPP,
  SFTP_APP_INAPP,
  SFTP_APP_BROWSER,
  SFTP_APP_SYSTEM,
  urlHost,
} from "../api/standalone";
import { useTerminals } from "../terminals/TerminalsContext";
import { openConnCatBrowserWindow } from "../api/browserWindow";
import { useConsoles } from "../consoles/useConsoles";
import { useAppearance } from "../appearance/AppearanceContext";
import { useViewMode } from "../appearance/ViewModeContext";
import { useNavMenuItems } from "../components/navMenu";
import { buildTranscriptPath } from "../api/transcript";
import { addLocalNotification } from "../notifications/localStore";
import {
  loadPinnedSessions,
  togglePinnedSession,
  subscribePinnedSessions,
  getSessionSshUserHistory,
  recordSessionSshUser,
} from "../api/devicePrefs";
import {
  hasOnePasswordCredential,
  onePasswordErrorMessage,
  resolveOnePasswordLogin,
} from "../api/onePassword";
import { failPendingAuthentication, pendingAuthenticationCommand } from "../terminals/pendingAuthentication";
import { useDirectRdp } from "../api/directRdp";

const EMPTY: SavedSession = {
  id: "",
  name: "",
  protocol: "ssh",
  host: "",
  port: 22,
  username: "",
  shellCmd: "",
  createdAt: 0,
};

// Pseudo-group id used in the UI for the implicit "Ungrouped" bucket.
const UNGROUPED = "__ungrouped__";
const STRUCTURED_CONNECTIONS_GROUP_KEY = "catwalk.connections.structuredGroup";

function loadStructuredConnectionsGroup(): string {
  try {
    return localStorage.getItem(STRUCTURED_CONNECTIONS_GROUP_KEY) || UNGROUPED;
  } catch {
    return UNGROUPED;
  }
}

const CONNECTION_ICON_BUTTON_STYLE: React.CSSProperties = {
  width: 30,
  height: 28,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "1px solid var(--border)",
};

function sessionDefaultPort(s: SavedSession): number {
  if (s.protocol === "rdp") return 3389;
  if (s.protocol === "web") return (s.webPorts ?? [443])[0] || 443;
  return 22;
}

function sessionTargetPort(s: SavedSession, fallback?: number): number {
  return s.port || fallback || sessionDefaultPort(s);
}

export default function Sessions() {
  const { launchSavedRdp } = useDirectRdp();
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  // Inline expansion of one session's settings panel; null = nothing open.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const settingsDirtyRef = useRef(false);
  const [settingsClosePrompt, setSettingsClosePrompt] = useState(false);
  const [settingsPromptSaving, setSettingsPromptSaving] = useState(false);
  const settingsSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [tunnelEditorId, setTunnelEditorId] = useState<string | null>(null);
  // Draft for the "+ New" flow. When set, we render a settings panel at the
  // top of the page that, on save, gets a real id and joins `sessions`.
  const [newDraft, setNewDraft] = useState<SavedSession | null>(null);
  const newDraftDirtyRef = useRef(false);
  const newDraftSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [newDraftClosePrompt, setNewDraftClosePrompt] = useState(false);
  const [newDraftPromptSaving, setNewDraftPromptSaving] = useState(false);
  const handleSettingsDirtyChange = useCallback((dirty: boolean) => {
    settingsDirtyRef.current = dirty;
  }, []);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<InventoryTypeFilter>("all");
  const [osFilter, setOsFilter] = useState("all");
  const [workspaceGroupId, setWorkspaceGroupId] = useState<string>(loadStructuredConnectionsGroup);
  const [err, setErr] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  // Per-row drop indicator for in-bucket reorder.
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  // Group-header reorder state: which group is being dragged and which
  // header is the current drop target. Both null when no drag in flight.
  const [groupDragId, setGroupDragId] = useState<string | null>(null);
  const groupDragIdRef = useRef<string | null>(null);
  const sessionDragIdRef = useRef<string | null>(null);
  const [groupDropId, setGroupDropId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pins, setPins] = useState<Set<string>>(() => loadPinnedSessions());
  useEffect(() => subscribePinnedSessions(() => setPins(loadPinnedSessions())), []);
  const expandedRef = useRef<HTMLDivElement | null>(null);
  // Tauri's webview doesn't implement window.prompt/confirm, so we drive
  // group rename/create + delete confirmations through an inline form.
  const [groupPrompt, setGroupPrompt] = useState<
    | { mode: "new" }
    | { mode: "rename"; group: SessionGroup }
    | null
  >(null);
  const [groupPromptText, setGroupPromptText] = useState("");
  const [groupColorEditor, setGroupColorEditor] = useState<SessionGroup | null>(null);
  const [groupColorDraft, setGroupColorDraft] = useState("#38bdf8");
  const [confirmDel, setConfirmDel] = useState<
    | { kind: "session"; session: SavedSession }
    | { kind: "group"; group: SessionGroup }
    | null
  >(null);
  // Right-click menu state. `target` distinguishes "empty area" (new-only
  // menu) from "session" (per-row actions including duplicate).
  const [menu, setMenu] = useState<
    | { pos: ContextMenuPosition; target: { kind: "empty" } }
    | { pos: ContextMenuPosition; target: { kind: "toolbar" } }
    | { pos: ContextMenuPosition; target: { kind: "session"; session: SavedSession } }
    | null
  >(null);
  const {
    open: openTerminalTab,
    close: closeTerminalTab,
    writeNotice: writeTerminalNotice,
  } = useTerminals();
  const { openBrowser: openBrowserTab, openSftp } = useConsoles();
  const { appearance, userPrefs, setUserPrefs } = useAppearance();
  const showToolbarText = appearance.connectionsToolbarDisplay === "iconsAndText";
  const { viewMode } = useViewMode();
  const autoOpenSshOnDoubleClick = appearance.savedConnectionDoubleClickAction === "connect";
  const settingsOpenDelayMs = autoOpenSshOnDoubleClick ? appearance.settingsOpenDelayMs : 0;
  const focusCardSize = appearance.focusCardSize;
  const navigate = useNavigate();
  const navItems = useNavMenuItems();

  /// Effective spawn options for a session, merging global appearance with
  /// the per-session overrides (`scrollback`, `saveTranscript`,
  /// `transcriptDir`).
  function sessionSpawnExtras(s: SavedSession): {
    scrollback: number;
    transcriptPath?: string;
  } {
    const enabled = s.saveTranscript ?? appearance.transcriptEnabled;
    const dir = (s.transcriptDir && s.transcriptDir.trim())
      ? s.transcriptDir.trim()
      : appearance.transcriptDir;
    return {
      scrollback: s.scrollback ?? appearance.terminalScrollback,
      transcriptPath: buildTranscriptPath({ enabled, dir, name: s.name }),
    };
  }

  function sessionSshKeyPath(s: SavedSession): string | undefined {
    return s.sshKeyPath?.trim() || getSshKeyPath() || undefined;
  }

  function tunnelCount(s: SavedSession): number {
    return normalizedSessionTunnels(s).length;
  }

  function canConfigureTunnels(s: SavedSession): boolean {
    return s.protocol !== "shell" && s.protocol !== "web" && s.protocol !== "console";
  }

  function saveSessionTunnels(sessionId: string, tunnels: SavedSessionTunnel[]) {
    const current = sessions.find((s) => s.id === sessionId) ?? listSessions().find((s) => s.id === sessionId);
    if (!current) return;
    const next = {
      ...current,
      sshTunnels: normalizedSessionTunnels({ sshTunnels: tunnels }),
    };
    upsertSession(next);
    reload();
    void pushProfile();
    setTunnelEditorId(null);
  }

  function reload() {
    setSessions(listSessions());
    setGroups(listGroups());
  }

  useEffect(() => {
    const onSessionsChanged = () => reload();
    window.addEventListener("catwalk:sessions-changed", onSessionsChanged);
    return () => window.removeEventListener("catwalk:sessions-changed", onSessionsChanged);
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pushProfile() {
    // ConnCat connections are local-only. Keep this function as the existing
    // save call-site boundary so edits remain synchronous and easy to audit.
  }

  const sessionOsOptions = useMemo(() => inventoryOsOptions(sessions.map((s) => [
    s.deviceTypeIcon,
    s.name,
  ])), [sessions]);

  useEffect(() => {
    if (osFilter !== "all" && !sessionOsOptions.some((option) => option.value === osFilter)) {
      setOsFilter("all");
    }
  }, [osFilter, sessionOsOptions]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return sessions.filter((s) => {
      if (q && ![s.name, s.host, s.username].some((v) => v.toLowerCase().includes(q))) return false;
      const descriptors = [s.deviceTypeIcon, s.name];
      const inventoryOs = detectInventoryOs(...descriptors);
      const descriptorText = descriptors.filter(Boolean).join(" ").toLowerCase();
      const inventoryType = classifyInventoryType({
        isCml: /(^|[\s_-])cml([\s_-]|$)/.test(descriptorText),
        isVirtual: Boolean(inventoryOs) || s.protocol === "rdp",
        descriptors,
      });
      return matchesInventoryType(typeFilter, inventoryType)
        && (osFilter === "all" || inventoryOs?.value === osFilter);
    });
  }, [sessions, filter, osFilter, typeFilter]);
  const tunnelEditorSession = tunnelEditorId
    ? sessions.find((s) => s.id === tunnelEditorId) ?? null
    : null;

  function startNew(proto: SessionProtocol) {
    newDraftDirtyRef.current = false;
    newDraftSaveRef.current = null;
    setNewDraftClosePrompt(false);
    setNewDraftPromptSaving(false);
    setNewDraft({
      ...EMPTY,
      id: newId(),
      protocol: proto,
      port: proto === "rdp" ? 3389 : proto === "console" ? 0 : 22,
      webPorts: proto === "web" ? [443] : undefined,
      serial: proto === "console" ? {
        baudRate: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: "none",
      } : undefined,
      createdAt: Date.now(),
    });
  }

  /// Pre-fill the new-connection modal with a clone of `s`. Gets a fresh
  /// id and `lastUsedAt`/`order` cleared so the duplicate sorts naturally;
  /// name gets " (copy)" appended so users see something distinct.
  function duplicateSession(s: SavedSession) {
    newDraftDirtyRef.current = false;
    newDraftSaveRef.current = null;
    setNewDraftClosePrompt(false);
    setNewDraftPromptSaving(false);
    setNewDraft({
      ...s,
      id: newId(),
      name: `${s.name} (copy)`,
      createdAt: Date.now(),
      lastUsedAt: undefined,
      order: undefined,
    });
  }

  function emptyMenuItems(): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: "New device…", icon: <NotesIcon name="new-device" size={16} />, onClick: () => startNew("ssh") },
      { label: "New console…", icon: <NotesIcon name="serial-console" size={16} />, onClick: () => startNew("console") },
      { label: "New local shell…", icon: <NotesIcon name="local-shell" size={16} />, onClick: () => startNew("shell") },
      { label: "New group…", icon: <NotesIcon name="group" size={16} />, onClick: () => addGroup() },
      { divider: true },
      ...navItems,
    ];
    return items;
  }

  function toolbarMenuItems(): ContextMenuItem[] {
    return [
      {
        label: "Icons only",
        hint: showToolbarText ? undefined : "✓",
        onClick: () => setUserPrefs({ ...userPrefs, connectionsToolbarDisplay: "icons" }),
      },
      {
        label: "Icons and text",
        hint: showToolbarText ? "✓" : undefined,
        onClick: () => setUserPrefs({ ...userPrefs, connectionsToolbarDisplay: "iconsAndText" }),
      },
    ];
  }

  function sessionMenuItems(s: SavedSession): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (s.protocol === "shell" || s.protocol === "console") {
      items.push({
        label: s.protocol === "console" ? "Open console" : "Connect",
        icon: <NotesIcon name={s.protocol === "console" ? "serial-console" : "local-shell"} size={16} />,
        onClick: () => { void connect(s); },
      });
    } else {
      // Always surface SSH/RDP/SFTP so the user can override a
      // misconfigured switch without first opening Settings. Browse is
      // only meaningful when at least one web port is configured.
      items.push({ label: "Open SSH", icon: <NotesIcon name="ssh" size={16} />, onClick: () => dispatchSsh(s) });
      items.push({ label: "Open RDP", icon: <NotesIcon name="rdp" size={16} />, onClick: () => { void rdpConnect(s); } });
      items.push({ label: "Open SFTP", icon: <NotesIcon name="sftp" size={16} />, onClick: () => dispatchSftp(s) });
      for (const p of (s.webPorts ?? [])) {
        items.push({
          label: `Browse :${p}`,
          icon: <NotesIcon name="browse" size={16} />,
          onClick: async () => {
            try {
              await browseSessionPort(s, p);
            } catch (e: any) {
              setErr(e.message ?? String(e));
            }
          },
        });
      }

      // "Open SSH as <user>" — recent usernames for this saved session.
      // Skips the current default to avoid a duplicate of "Open SSH".
      const currentUser = (s.username || "").trim();
      const userHistory = getSessionSshUserHistory(s.id).filter((u) => u !== currentUser);
      for (const u of userHistory) {
        items.push({
          label: `Open SSH as ${u}`,
          onClick: () => {
            upsertSession({ ...s, username: u });
            reload();
            dispatchSsh({ ...s, username: u });
          },
        });
      }

      // Copy a ready-to-paste ssh command for this saved session.
      if (s.protocol === "ssh") {
        items.push({
          label: "Copy SSH command",
          hint: `${currentUser ? currentUser + "@" : ""}${s.host}`,
          onClick: async () => {
            try {
              const key = sessionSshKeyPath(s);
              const port = s.port && s.port !== 22 ? ` -p ${s.port}` : "";
              const ident = key ? ` -i ${key}` : "";
              const forwards = sessionSshForwardSpecs(s).map((spec) => ` -L ${spec}`).join("");
              const user = currentUser ? `${currentUser}@` : "";
              const cmd = `ssh${ident}${port}${forwards} ${user}${s.host}`;
              const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
              await writeText(cmd);
              addLocalNotification({ kind: "info", title: "SSH command copied", body: cmd });
            } catch (e: any) {
              setErr(e?.message ?? String(e));
            }
          },
        });
      }

      // Test connection from this endpoint to the saved host.
      const probePort =
        s.protocol === "web"
          ? ((s.webPorts ?? [])[0] ?? 443)
          : (s.port || (s.protocol === "rdp" ? 3389 : 22));
      if (s.host) {
        items.push({
          label: "Test connection",
          hint: `${s.host}:${probePort}`,
          onClick: async () => {
            try {
              await probeHost(s.host, probePort);
              addLocalNotification({
                kind: "info",
                title: "Connection OK",
                body: `${s.name} (${s.host}:${probePort}) is reachable.`,
              });
            } catch (e: any) {
              const msg = e?.message ?? String(e);
              addLocalNotification({
                kind: "error",
                title: `Connection to ${s.name} failed`,
                body: msg,
              });
              setErr(msg);
            }
          },
        });
      }
    }

    // Copy host (works for every protocol that has one).
    if (s.host) {
      items.push({ divider: true });
      items.push({
        label: "Copy host",
        hint: s.host,
        onClick: async () => {
          try {
            const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
            await writeText(s.host);
          } catch (e: any) {
            setErr(e?.message ?? String(e));
          }
        },
      });
    }

    items.push({ divider: true });
    items.push({
      label: pins.has(s.id) ? "Unpin connection" : "Pin connection",
      onClick: () => { togglePinnedSession(s.id); },
    });
    items.push({ label: "Edit settings…", onClick: () => openSettings(s.id) });
    items.push({ label: "Duplicate", hint: "Ctrl+D", onClick: () => duplicateSession(s) });
    items.push({ divider: true });
    items.push({ label: "Delete", danger: true, onClick: () => remove(s) });
    return items;
  }

  /// Toggle the inline settings panel for a session. Opening one closes
  /// any other open panel.
  function openSettings(id: string) {
    settingsSaveRef.current = null;
    settingsDirtyRef.current = false;
    setSettingsClosePrompt(false);
    setSettingsPromptSaving(false);
    setExpandedId(id);
  }

  function closeSettings() {
    settingsSaveRef.current = null;
    settingsDirtyRef.current = false;
    setSettingsClosePrompt(false);
    setSettingsPromptSaving(false);
    setExpandedId(null);
  }

  function requestCloseSettings() {
    if (settingsDirtyRef.current) {
      setSettingsClosePrompt(true);
      return;
    }
    closeSettings();
  }

  function closeNewDraft() {
    newDraftDirtyRef.current = false;
    newDraftSaveRef.current = null;
    setNewDraftClosePrompt(false);
    setNewDraftPromptSaving(false);
    setNewDraft(null);
  }

  function requestCloseNewDraft() {
    if (newDraftDirtyRef.current) {
      setNewDraftClosePrompt(true);
      return;
    }
    closeNewDraft();
  }

  async function saveAndCloseNewDraft() {
    if (newDraftPromptSaving) return;
    const save = newDraftSaveRef.current;
    if (!save) { closeNewDraft(); return; }
    setNewDraftPromptSaving(true);
    try {
      const ok = await save();
      if (ok) closeNewDraft();
      else setNewDraftClosePrompt(false);
    } finally {
      setNewDraftPromptSaving(false);
    }
  }

  async function saveAndCloseSettings() {
    if (settingsPromptSaving) return;
    const save = settingsSaveRef.current;
    if (!save) { closeSettings(); return; }
    setSettingsPromptSaving(true);
    try {
      const ok = await save();
      if (ok) closeSettings();
      else setSettingsClosePrompt(false);
    } finally {
      setSettingsPromptSaving(false);
    }
  }

  function toggleExpand(id: string) {
    if (expandedId === id) requestCloseSettings();
    else openSettings(id);
  }

  // Debounce single-click row expansion so a follow-up double-click (which
  // opens SSH) gets a chance to cancel it. The delay is user-configurable
  // from Settings and resolves to 0ms when double-click SSH is disabled.
  const rowClickTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (rowClickTimerRef.current != null) {
      window.clearTimeout(rowClickTimerRef.current);
      rowClickTimerRef.current = null;
    }
  }, []);
  function toggleExpandDeferred(id: string) {
    if (rowClickTimerRef.current != null) {
      window.clearTimeout(rowClickTimerRef.current);
      rowClickTimerRef.current = null;
    }
    if (settingsOpenDelayMs <= 0) {
      toggleExpand(id);
      return;
    }
    rowClickTimerRef.current = window.setTimeout(() => {
      rowClickTimerRef.current = null;
      toggleExpand(id);
    }, settingsOpenDelayMs);
  }
  function cancelDeferredExpand() {
    if (rowClickTimerRef.current != null) {
      window.clearTimeout(rowClickTimerRef.current);
      rowClickTimerRef.current = null;
    }
  }

  // After expanding, scroll the panel into view so the user can see its
  // contents without manually scrolling.
  useEffect(() => {
    if (!expandedId) return;
    const id = window.setTimeout(() => {
      expandedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 0);
    return () => window.clearTimeout(id);
  }, [expandedId]);

  async function connect(s: SavedSession) {
    setErr(null);
    try {
      if (s.protocol === "web") {
        const ports = (s.webPorts ?? []).filter((p) => p > 0 && p < 65536);
        if (ports.length === 0) {
          setErr("No ports configured for this web session.");
          return;
        }
        for (const p of ports) {
          await browseSessionPort(s, p);
        }
      } else if (s.protocol === "rdp") {
        await rdpConnect(s);
      } else if (s.protocol === "shell") {
        const cmd = s.shellCmd?.trim() || defaultShell();
        const parts = splitCmd(cmd);
        await openTerminalTab({
          title: s.name,
          cmd: parts[0],
          args: parts.slice(1),
          accent: s.color,
          tintAnsi: s.tintAnsi,
          controlKeyMode: "local-shell",
          ...sessionSpawnExtras(s),
        });
        navigate("/terminals");
      } else if (s.protocol === "console") {
        const serial = s.serial ?? {
          baudRate: 9600,
          dataBits: 8,
          parity: "none" as const,
          stopBits: 1 as const,
          flowControl: "none" as const,
        };
        await openTerminalTab({
          title: s.name,
          cmd: "serial-console",
          serial: { path: s.host, ...serial },
          accent: s.color,
          tintAnsi: s.tintAnsi,
          controlKeyMode: "hardware-session",
          ...sessionSpawnExtras(s),
        });
        navigate("/terminals");
      } else {
        await sshConnect(s);
      }
      touchSession(s.id);
      reload();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  async function browseSessionPort(s: SavedSession, port: number) {
    try {
      const proxy = await openUntrustedBrowserProxy(browseUrl(s.host, port));
      const browseMode = s.browseOpenMode ?? appearance.browseOpenMode;
      if (browseMode === BROWSE_OPEN_EXTERNAL) {
        await openUrl(proxy.url);
      } else if (browseMode === BROWSE_OPEN_WINDOW) {
        await openConnCatBrowserWindow(proxy.url, `${s.name || s.host} :${port}`);
      } else {
        openBrowserTab(proxy.url, `${s.name || s.host} :${port}`);
        navigate("/consoles");
      }
      touchSession(s.id);
      reload();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  async function sftpBrowser(s: SavedSession) {
    setErr(null);
    try {
      const credential = hasOnePasswordCredential(s)
        ? await resolveOnePasswordLogin(s.onePassword!)
        : null;
      const keyPath = credential ? undefined : sessionSshKeyPath(s) || undefined;
      openSftp({
        host: s.host,
        port: sessionTargetPort(s, 22),
        user: credential?.username ?? s.username ?? "",
        keyPath,
        password: credential?.password,
        autoConnect: !!credential || !!keyPath,
        title: s.name,
      });
      navigate("/consoles");
      touchSession(s.id);
      reload();
    } catch (error) {
      setErr(onePasswordErrorMessage(error));
    }
  }

  /// Open `sftp` against the saved host in the user's external terminal
  /// (Terminal / iTerm / Warp / Windows Terminal / etc.).
  async function sftpExternal(s: SavedSession) {
    setErr(null);
    try {
      const keepaliveSeconds = s.keepalive && s.keepalive > 0 ? Math.floor(s.keepalive) : undefined;
      await invoke("launch_sftp_host", {
        username: s.username || "",
        host: s.host,
        port: s.port || 22,
        terminalApp: pickSessionTerminal(s),
        keyPath: sessionSshKeyPath(s),
        keepaliveSeconds,
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  /// Open an in-app terminal tab running `sftp` against the saved host.
  async function sftpInAppTerm(s: SavedSession) {
    setErr(null);
    try {
      const key = sessionSshKeyPath(s);
      const buildArgs = async () => {
        const args = ["-P", String(sessionTargetPort(s, 22))];
        if (key) args.push("-i", key);
        if (s.keepalive && s.keepalive > 0) {
          args.push("-o", `ServerAliveInterval=${Math.floor(s.keepalive)}`);
          args.push("-o", "ServerAliveCountMax=3");
        }
        args.push(`${s.username || ""}${s.username ? "@" : ""}${s.host}`);
        return args;
      };
      await openTerminalTab({
        title: `${s.name} (sftp)`,
        cmd: "sftp",
        args: await buildArgs(),
        accent: s.color,
        tintAnsi: s.tintAnsi,
        ...sessionSpawnExtras(s),
        respawn: async () => ({ cmd: "sftp", args: await buildArgs() }),
      });
      navigate("/terminals");
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  /// Launch an external SFTP GUI (Cyberduck / FileZilla / Transmit / WinSCP /
  /// …) connecting directly to the saved host:port.
  async function sftpGuiExternal(s: SavedSession, appId: string) {
    setErr(null);
    try {
      await invoke("launch_sftp_gui_host", {
        appId,
        username: s.username || "",
        host: s.host,
        port: s.port || 22,
        keyPath: sessionSshKeyPath(s),
      });
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  /// Dispatch the SSH button click using the per-session `sshApp` preference.
  /// Sentinel `"app"` (or undefined) opens in-app; anything else is a system
  /// terminal id passed to the external launcher.
  function dispatchSsh(s: SavedSession) {
    if (hasOnePasswordCredential(s)) {
      void sshConnect(s);
      return;
    }
    const app = s.sshApp || SSH_APP_INAPP;
    if (app === SSH_APP_INAPP) void sshConnect(s);
    else void sshExternalWith(s, app);
  }

  /// Variant of `sshExternal` that forces a specific terminal app, ignoring
  /// the per-OS picker. Used by the per-session "SSH — Open with" choice.
  async function sshExternalWith(s: SavedSession, terminalApp: string) {
    setErr(null);
    try {
      if (hasOnePasswordCredential(s)) {
        await sshConnect(s);
        return;
      }
      if (s.username) recordSessionSshUser(s.id, s.username);
      const keepaliveSeconds = s.keepalive && s.keepalive > 0 ? Math.floor(s.keepalive) : undefined;
      await invoke("launch_ssh_host", {
        username: s.username || "",
        host: s.host,
        port: s.port || 22,
        terminalApp,
        keyPath: sessionSshKeyPath(s),
        keepaliveSeconds,
        localForwards: sessionSshForwardSpecs(s),
      });
      touchSession(s.id);
      reload();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  /// Dispatch the SFTP button click using the per-session `sftpApp`
  /// preference (mirrors VM behavior).
  function dispatchSftp(s: SavedSession) {
    const app = s.sftpApp || SFTP_APP_BROWSER;
    if (app === SFTP_APP_INAPP) void sftpInAppTerm(s);
    else if (app === SFTP_APP_BROWSER) void sftpBrowser(s);
    else if (app === SFTP_APP_SYSTEM) void sftpExternal(s);
    else void sftpGuiExternal(s, app);
  }

  /// Force an SSH in-app terminal regardless of `s.protocol` — used by the
  /// SSH button shown on every host-based row.
  async function sshConnect(s: SavedSession) {
    setErr(null);
    let pendingTabId: number | null = null;
    try {
      const usesOnePassword = hasOnePasswordCredential(s);
      const port = s.protocol === "ssh" ? (s.port || 22) : 22;
      const buildLaunch = async () => {
        const credential = usesOnePassword
          ? await resolveOnePasswordLogin(s.onePassword!)
          : null;
        const username = credential?.username ?? s.username ?? "";
        const args = [
          "-o", "StrictHostKeyChecking=accept-new",
          "-p", String(port),
        ];
        if (credential) {
          args.push("-o", "PubkeyAuthentication=no");
          args.push("-o", "PreferredAuthentications=password,keyboard-interactive");
        }
        if (s.keepalive && s.keepalive > 0) {
          args.push("-o", `ServerAliveInterval=${Math.floor(s.keepalive)}`);
          args.push("-o", "ServerAliveCountMax=3");
        }
        const key = sessionSshKeyPath(s);
        if (key && !credential) args.push("-i", key);
        args.push(...sessionSshForwardArgs(s));
        const dest = `${username}${username ? "@" : ""}${s.host}`;
        if (s.vimFix === true) pushSshDestWithVimFix(args, dest);
        else pushSshDestPlain(args, dest);
        if (username) recordSessionSshUser(s.id, username);
        return {
          title: s.name,
          cmd: "ssh",
          args,
          autoPassword: credential?.password,
          accent: s.color,
          tintAnsi: s.tintAnsi,
          authenticationLabel: usesOnePassword ? "1Password" : undefined,
          passwordCredential: usesOnePassword ? s.onePassword : undefined,
          ...sessionSpawnExtras(s),
        };
      };
      if (usesOnePassword) {
        pendingTabId = await openTerminalTab({
          title: `${s.name} - Signing in`,
          ...pendingAuthenticationCommand(),
          accent: s.color,
          tintAnsi: s.tintAnsi,
          scrollback: s.scrollback ?? appearance.terminalScrollback,
          controlKeyMode: "local-shell",
          authenticationLabel: "1Password",
          passwordCredential: s.onePassword,
          respawn: buildLaunch,
        });
        navigate("/terminals");
      }
      await openTerminalTab({ ...(await buildLaunch()), respawn: buildLaunch });
      if (pendingTabId != null) await closeTerminalTab(pendingTabId);
      navigate("/terminals");
      touchSession(s.id);
      reload();
    } catch (error) {
      const message = onePasswordErrorMessage(error);
      if (pendingTabId != null) {
        await failPendingAuthentication(pendingTabId, "1Password", message, writeTerminalNotice);
      }
      setErr(message);
    }
  }

  /// Force an RDP launch regardless of `s.protocol`.
  async function rdpConnect(s: SavedSession) {
    setErr(null);
    try {
      await launchSavedRdp(s);
      // A companion RDP window must not reorder the saved Connections grid.
      // Explicit drag order remains the only ordering mutation for this path.
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  function remove(s: SavedSession) {
    setConfirmDel({ kind: "session", session: s });
  }

  function addGroup() {
    setGroupPromptText("");
    setGroupPrompt({ mode: "new" });
  }

  function renameGroup(g: SessionGroup) {
    setGroupPromptText(g.name);
    setGroupPrompt({ mode: "rename", group: g });
  }

  function removeGroup(g: SessionGroup) {
    setConfirmDel({ kind: "group", group: g });
  }

  function editGroupColor(g: SessionGroup) {
    setGroupColorDraft(g.color || "#38bdf8");
    setGroupColorEditor(g);
  }

  function saveGroupColor(color?: string) {
    if (!groupColorEditor) return;
    upsertGroup({ ...groupColorEditor, color });
    setGroupColorEditor(null);
    reload();
    void pushProfile();
  }

  /// Build the set of drag handlers a group `<h3>` header needs to take
  /// part in group reordering. The Ungrouped pseudo-section is a
  /// drop-only target — it never gets `draggable` itself. Session-card
  /// drops are still handled by the existing section-level
  /// `onGroupDragOver/onGroupDrop` handlers, which look for a different
  /// dataTransfer type, so the two DnD flows don't collide.
  function headerDragHandlers(groupId: string) {
    const isUngrouped = groupId === UNGROUPED;
    const isDrag = groupDragId === groupId;
    const isOver = groupDropId === groupId && groupDragId != null && groupDragId !== groupId;
    return {
      draggable: !isUngrouped,
      isDrag,
      isOver,
      onDragStart: (e: React.DragEvent) => {
        if (isUngrouped) return;
        groupDragIdRef.current = groupId;
        setGroupDragId(groupId);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/x-catwalk-group-id", groupId);
        try { e.dataTransfer.setData("text/plain", `catwalk-group:${groupId}`); } catch { /* ref fallback */ }
        // Stop the event from bubbling so the section's session-drop
        // handler doesn't also see this drag.
        e.stopPropagation();
      },
      onDragOver: (e: React.DragEvent) => {
        const draggedId = groupDragIdRef.current;
        if (draggedId == null || draggedId === groupId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setGroupDropId(groupId);
      },
      onDragLeave: () => {
        setGroupDropId((t) => (t === groupId ? null : t));
      },
      onDrop: (e: React.DragEvent) => {
        const draggedId = groupDragIdRef.current;
        if (draggedId == null || draggedId === groupId) return;
        e.preventDefault();
        e.stopPropagation();
        // Ungrouped is a fixed trailing bucket — drops on its header
        // are intentional no-ops.
        if (!isUngrouped) {
          reorderGroup(draggedId, groupId);
          reload();
          void pushProfile();
        }
        groupDragIdRef.current = null;
        setGroupDragId(null);
        setGroupDropId(null);
      },
      onDragEnd: () => {
        groupDragIdRef.current = null;
        setGroupDragId(null);
        setGroupDropId(null);
      },
    };
  }

  function submitGroupPrompt() {
    if (!groupPrompt) return;
    const name = groupPromptText.trim();
    if (!name) return;
    if (groupPrompt.mode === "new") {
      const order = (groups[groups.length - 1]?.order ?? -1) + 1;
      upsertGroup({ id: newGroupId(), name, order, createdAt: Date.now() });
    } else {
      upsertGroup({ ...groupPrompt.group, name });
    }
    setGroupPrompt(null);
    setGroupPromptText("");
    reload();
    void pushProfile();
  }

  function submitConfirmDel() {
    if (!confirmDel) return;
    if (confirmDel.kind === "session") {
      deleteSession(confirmDel.session.id);
    } else {
      deleteGroup(confirmDel.group.id);
      if (workspaceGroupId === confirmDel.group.id) {
        setWorkspaceGroupId(UNGROUPED);
      }
    }
    setConfirmDel(null);
    reload();
    void pushProfile();
  }

  function toggleCollapsed(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function onDragStart(e: React.DragEvent, sessionId: string) {
    sessionDragIdRef.current = sessionId;
    e.dataTransfer.setData("text/x-catwalk-session-id", sessionId);
    try { e.dataTransfer.setData("text/plain", `catwalk-session:${sessionId}`); } catch { /* ref fallback */ }
    e.dataTransfer.effectAllowed = "move";
  }
  function draggedSessionId(e: React.DragEvent): string {
    if (sessionDragIdRef.current) return sessionDragIdRef.current;
    const explicit = e.dataTransfer.getData("text/x-catwalk-session-id")
      || e.dataTransfer.getData("text/x-catwalk-focus-id");
    if (explicit) return explicit;
    const plain = e.dataTransfer.getData("text/plain");
    if (plain.startsWith("catwalk-session:")) return plain.slice("catwalk-session:".length);
    return plain.startsWith("catwalk-focus:") ? plain.slice("catwalk-focus:".length) : "";
  }
  function onGroupDragOver(e: React.DragEvent, groupId: string) {
    const isSessionDrag = Boolean(sessionDragIdRef.current)
      || Array.from(e.dataTransfer.types ?? []).includes("text/x-catwalk-session-id")
      || Array.from(e.dataTransfer.types ?? []).includes("text/x-catwalk-focus-id")
      || Array.from(e.dataTransfer.types ?? []).includes("text/plain");
    if (isSessionDrag && !groupDragIdRef.current) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverGroup(groupId);
    }
  }
  function onGroupDragLeave(groupId: string) {
    setDragOverGroup((d) => (d === groupId ? null : d));
  }
  function onGroupDrop(e: React.DragEvent, groupId: string) {
    e.preventDefault();
    const sid = draggedSessionId(e);
    sessionDragIdRef.current = null;
    setDragOverGroup(null);
    if (!sid) return;
    // Drop on the group header itself = append to end of that bucket.
    assignSessionToGroup(sid, groupId === UNGROUPED ? undefined : groupId);
    reload();
    void pushProfile();
  }

  function onRowDragOver(e: React.DragEvent, rowId: string) {
    const isSessionDrag = Boolean(sessionDragIdRef.current)
      || Array.from(e.dataTransfer.types ?? []).includes("text/x-catwalk-session-id")
      || Array.from(e.dataTransfer.types ?? []).includes("text/x-catwalk-focus-id")
      || Array.from(e.dataTransfer.types ?? []).includes("text/plain");
    if (!isSessionDrag || groupDragIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropBefore(rowId);
  }
  function onRowDrop(e: React.DragEvent, rowId: string) {
    e.preventDefault();
    e.stopPropagation();
    const sid = draggedSessionId(e);
    sessionDragIdRef.current = null;
    setDropBefore(null);
    setDragOverGroup(null);
    if (!sid || sid === rowId) return;
    // Pass the visible bucket order so direction sensing matches what
    // the user sees (pin-aware sort doesn't match storage order).
    const target = sessions.find((s) => s.id === rowId);
    const bucketId = target?.groupId && buckets.has(target.groupId) ? target.groupId : UNGROUPED;
    const visibleOrder = (buckets.get(bucketId) ?? []).map((s) => s.id);
    reorderSession(sid, rowId, visibleOrder);
    reload();
    void pushProfile();
  }

  const buckets = useMemo(() => {
    const map = new Map<string, SavedSession[]>();
    map.set(UNGROUPED, []);
    for (const g of groups) map.set(g.id, []);
    for (const s of filtered) {
      const key = s.groupId && map.has(s.groupId) ? s.groupId : UNGROUPED;
      map.get(key)!.push(s);
    }
    // Sort each bucket by pin → explicit drag order → creation order. Usage is
    // tracked for history only and must not rearrange the Connections screen.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const pa = pins.has(a.id) ? 0 : 1;
        const pb = pins.has(b.id) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return compareSessionsForDisplay(a, b);
      });
    }
    return map;
  }, [filtered, groups, pins]);

  useEffect(() => {
    if (workspaceGroupId === UNGROUPED || groups.some((group) => group.id === workspaceGroupId)) return;
    // Groups load after the component mounts. Keep the saved selection until
    // that first load completes so it is not replaced by Ungrouped.
    if (groups.length === 0) return;
    setWorkspaceGroupId(groups[0]?.id ?? UNGROUPED);
  }, [groups, workspaceGroupId]);

  useEffect(() => {
    try {
      localStorage.setItem(STRUCTURED_CONNECTIONS_GROUP_KEY, workspaceGroupId);
    } catch {
      // Selection persistence is a convenience; storage can be unavailable.
    }
  }, [workspaceGroupId]);

  function renderRow(s: SavedSession) {
    const isDropTarget = dropBefore === s.id;
    return (
      <div key={s.id} id={`session-row-${s.id}`} className="session-connection-list-row">
      <div
        className="card list-row-card"
        draggable
        onDragStart={(e) => onDragStart(e, s.id)}
        onDragOver={(e) => onRowDragOver(e, s.id)}
        onDragLeave={() => setDropBefore((d) => (d === s.id ? null : d))}
        onDrop={(e) => onRowDrop(e, s.id)}
        onDragEnd={() => { sessionDragIdRef.current = null; setDropBefore(null); setDragOverGroup(null); }}
        onContextMenu={(e) => setMenu({ pos: captureContextMenu(e), target: { kind: "session", session: s } })}
        onDoubleClick={(e) => {
          // Don't fire when the user double-clicks inside an inline editor /
          // button — only on whitespace areas of the card.
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          // Cancel the pending settings-panel expand so a double-click only
          // opens the connection, not the inline editor.
          cancelDeferredExpand();
          if (autoOpenSshOnDoubleClick) void connect(s);
        }}
        title={autoOpenSshOnDoubleClick ? "Double-click to connect" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          cursor: "grab",
          borderTop: isDropTarget ? "2px solid var(--accent)" : undefined,
          borderLeft: s.color ? `4px solid ${s.color}` : undefined,
          paddingLeft: s.color ? 12 : undefined,
        }}
      >
        <div
          style={{ flex: "1 1 240px", minWidth: 200, cursor: "pointer" }}
          onClick={(e) => {
            // Don't toggle when the user clicks inside an input/button so
            // the row's existing controls keep working.
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            // Defer so a follow-up double-click can cancel the expand.
            toggleExpandDeferred(s.id);
          }}
        >
          <div style={{ fontWeight: 600 }}>
            <span style={{ color: "var(--muted)", marginRight: 6 }} title="Drag to a group">⋮⋮</span>
            {s.name}
            {pins.has(s.id) && (
              <span
                title="Pinned"
                aria-label="Pinned"
                style={{ marginLeft: 6, color: "#f9a825", fontSize: 12 }}
              >
                {"\u2605"}
              </span>
            )}
            {s.deviceTypeIcon && (
              <span style={{ marginLeft: 8, verticalAlign: "middle" }}>
                <GuestOsIcon deviceType={s.deviceTypeIcon} />
              </span>
            )}
          </div>
          <div className="sub" style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
            {s.protocol.toUpperCase()}
            {s.protocol === "web" && ` · ${s.host}`}
            {s.protocol !== "shell" && s.protocol !== "web" && s.protocol !== "console" && ` · ${s.host}`}
            {s.protocol === "console" && ` · ${s.host} · ${s.serial?.baudRate ?? 9600} ${s.serial?.dataBits ?? 8}${(s.serial?.parity ?? "none")[0].toUpperCase()}${s.serial?.stopBits ?? 1}`}
            {s.protocol === "shell" && ` · ${s.shellCmd || defaultShell()}`}
          </div>
        </div>
        {s.protocol === "shell" || s.protocol === "console" ? (
          <button
            type="button"
            onClick={() => connect(s)}
            title={s.protocol === "console" ? "Open serial console" : "Launch local shell"}
            aria-label={s.protocol === "console" ? "Open serial console" : "Launch local shell"}
            style={{ ...CONNECTION_ICON_BUTTON_STYLE, color: s.color || "var(--accent)" }}
          >
            <NotesIcon name={s.protocol === "console" ? "serial-console" : "local-shell"} size={17} />
          </button>
        ) : (() => {
          const conn = effectiveSessionConnections(s);
          // Match the VM-row button style: plain compact buttons. Per-app
          // choice for SSH/SFTP is set in the connection details panel
          // ("Open with" dropdowns), mirroring DeviceSettingsPanel.
          const btnStyle: React.CSSProperties = {
            ...CONNECTION_ICON_BUTTON_STYLE,
            color: s.color || "var(--accent)",
          };
          return (
            <>
              {conn.ssh && (
                <button
                  type="button"
                  onClick={() => dispatchSsh(s)}
                  title="Open SSH using the per-connection app (set in details)"
                  aria-label="Open SSH"
                  style={btnStyle}
                >
                  <NotesIcon name="ssh" size={17} />
                </button>
              )}
              {conn.rdp && (
                <button
                  type="button"
                  onClick={() => rdpConnect(s)}
                  title={`Launch RDP to ${s.host}`}
                  aria-label={`Launch RDP to ${s.host}`}
                  style={btnStyle}
                >
                  <NotesIcon name="rdp" size={17} />
                </button>
              )}
              {conn.sftp && (
                <button
                  type="button"
                  onClick={() => dispatchSftp(s)}
                  title="Open SFTP using the per-connection app (set in details)"
                  aria-label="Open SFTP"
                  style={btnStyle}
                >
                  <NotesIcon name="sftp" size={17} />
                </button>
              )}
              {conn.browse && (s.webPorts ?? []).map((p) => (
                <button
                  key={`web-${p}`}
                  type="button"
                  title={`Open ${browseUrl(s.host, p)}`}
                  aria-label={`Browse ${s.host} on port ${p}`}
                  onClick={async () => {
                    try {
                      await browseSessionPort(s, p);
                    } catch (e: any) {
                      setErr(e.message ?? String(e));
                    }
                  }}
                  style={btnStyle}
                >
                  <NotesIcon name="browse" size={17} />
                </button>
              ))}
            </>
          );
        })()}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            remove(s);
          }}
          title="Delete this connection"
          aria-label="Delete connection"
          style={{
            marginLeft: "auto",
            background: "transparent",
            color: "var(--muted)",
            border: "none",
            padding: "4px 6px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "salmon"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)"; }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
      {expandedId === s.id && (
        // Render the settings panel in a centered modal (same UX as the
        // focus view) instead of expanding inline below the row. Keeps
        // the list compact and matches what users liked in focus view.
        <Modal wide onClose={requestCloseSettings}>
          <div ref={expandedRef}>
            <SessionSettingsPanel
              session={s}
              groups={groups}
              onSaved={() => { closeSettings(); reload(); void pushProfile(); }}
              onCancel={requestCloseSettings}
              onDelete={() => { closeSettings(); remove(s); }}
              onDirtyChange={handleSettingsDirtyChange}
              onSaveRequest={(save) => { settingsSaveRef.current = save; }}
              onConfigureTunnels={canConfigureTunnels(s) ? () => setTunnelEditorId(s.id) : undefined}
              tunnelCount={tunnelCount(s)}
            />
          </div>
        </Modal>
      )}
      </div>
    );
  }

  type CompactSessionAction = { label: string; icon?: NotesIconName; title: string; onClick: () => void };

  function compactSessionActions(s: SavedSession): CompactSessionAction[] {
    if (s.protocol === "shell") {
      return [{ label: "Local shell", icon: "local-shell", title: "Launch local shell", onClick: () => { void connect(s); } }];
    }
    if (s.protocol === "console") {
      return [{ label: "Console", icon: "serial-console", title: `Open serial console on ${s.host}`, onClick: () => { void connect(s); } }];
    }
    if (s.protocol === "web") {
      return [{ label: "Browse", icon: "browse", title: `Open ${s.host}`, onClick: () => { void connect(s); } }];
    }
    const conn = effectiveSessionConnections(s);
    const actions: CompactSessionAction[] = [];
    if (conn.ssh) {
      actions.push({
        label: "SSH",
        icon: "ssh",
        title: "Open SSH using the per-connection app (set in details)",
        onClick: () => dispatchSsh(s),
      });
    }
    if (conn.rdp) {
      actions.push({ label: "RDP", icon: "rdp", title: `Launch RDP to ${s.host}`, onClick: () => { void rdpConnect(s); } });
    }
    if (conn.sftp) {
      actions.push({
        label: "SFTP",
        icon: "sftp",
        title: "Open SFTP using the per-connection app (set in details)",
        onClick: () => dispatchSftp(s),
      });
    }
    if (conn.browse && (s.webPorts ?? []).length > 0) {
      const port = (s.webPorts ?? [])[0];
      actions.push({
        label: "Browse",
        icon: "browse",
        title: `Open ${browseUrl(s.host, port)}`,
        onClick: () => {
          void browseSessionPort(s, port).catch((e: any) => setErr(e?.message ?? String(e)));
        },
      });
    }
    return actions.slice(0, 3);
  }

  function renderCompactRow(s: SavedSession) {
    const isDropTarget = dropBefore === s.id;
    const actions = compactSessionActions(s);
    const hostLine = (() => {
      if (s.protocol === "shell") return s.shellCmd || defaultShell();
      if (s.protocol === "console") return `${s.host} · ${s.serial?.baudRate ?? 9600} baud`;
      return s.host;
    })();
    return (
      <div key={s.id} id={`session-row-${s.id}`} style={{ minWidth: 0 }}>
        <div
          className="compact-row"
          draggable
          onDragStart={(e) => onDragStart(e, s.id)}
          onDragOver={(e) => onRowDragOver(e, s.id)}
          onDragLeave={() => setDropBefore((d) => (d === s.id ? null : d))}
          onDrop={(e) => onRowDrop(e, s.id)}
          onDragEnd={() => { sessionDragIdRef.current = null; setDropBefore(null); setDragOverGroup(null); }}
          onContextMenu={(e) => setMenu({ pos: captureContextMenu(e), target: { kind: "session", session: s } })}
          onDoubleClick={(e) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            cancelDeferredExpand();
            if (autoOpenSshOnDoubleClick) void connect(s);
          }}
          title={autoOpenSshOnDoubleClick ? "Double-click to connect" : undefined}
          style={{
            borderTop: isDropTarget ? "2px solid var(--accent)" : undefined,
            borderLeft: s.color ? `4px solid ${s.color}` : undefined,
          }}
        >
          <span className="compact-row__grip" title="Drag to a group">⋮⋮</span>
          <div
            className="compact-row__main"
            onClick={(e) => {
              const tag = (e.target as HTMLElement).tagName;
              if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
              toggleExpandDeferred(s.id);
            }}
          >
            <div className="compact-row__title">
              <span className="compact-row__title-text">{s.name}</span>
              {pins.has(s.id) && <span title="Pinned" aria-label="Pinned" style={{ color: "#f9a825", fontSize: 12 }}>{"\u2605"}</span>}
              <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 700 }}>{s.protocol.toUpperCase()}</span>
              {s.deviceTypeIcon && (
                <GuestOsIcon deviceType={s.deviceTypeIcon} />
              )}
            </div>
            <div className="compact-row__meta" title={hostLine}>{hostLine}</div>
          </div>
          <div className="compact-row__actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                title={action.title}
                aria-label={action.label}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  action.onClick();
                }}
                style={action.icon
                  ? { ...CONNECTION_ICON_BUTTON_STYLE, color: s.color || "var(--accent)" }
                  : { padding: "4px 9px", fontSize: 12, lineHeight: 1.15 }}
              >
                {action.icon ? <NotesIcon name={action.icon} size={17} /> : action.label}
              </button>
            ))}
          </div>
        </div>
        {expandedId === s.id && (
          <Modal wide onClose={requestCloseSettings}>
            <div ref={expandedRef}>
              <SessionSettingsPanel
                session={s}
                groups={groups}
                onSaved={() => { closeSettings(); reload(); void pushProfile(); }}
                onCancel={requestCloseSettings}
                onDelete={() => { closeSettings(); remove(s); }}
                onDirtyChange={handleSettingsDirtyChange}
                onSaveRequest={(save) => { settingsSaveRef.current = save; }}
                onConfigureTunnels={canConfigureTunnels(s) ? () => setTunnelEditorId(s.id) : undefined}
                tunnelCount={tunnelCount(s)}
              />
            </div>
          </Modal>
        )}
      </div>
    );
  }

  function renderCompactRows(items: SavedSession[]) {
    return (
      <div className="compact-list-grid">
        {items.map(renderCompactRow)}
      </div>
    );
  }

  function workspaceSessionAddress(s: SavedSession): string {
    if (s.protocol === "shell") return s.shellCmd || defaultShell();
    return s.host;
  }

  function renderWorkspaceConnectionRow(s: SavedSession) {
    const actions = compactSessionActions(s);
    const isDropTarget = dropBefore === s.id;
    const address = workspaceSessionAddress(s);
    return (
      <div key={s.id} id={`session-row-${s.id}`} className="workspace-connection-row-host">
        <div
          className={`workspace-connection-row workspace-connection-row--${viewMode}`}
          draggable
          onDragStart={(event) => onDragStart(event, s.id)}
          onDragOver={(event) => onRowDragOver(event, s.id)}
          onDragLeave={() => setDropBefore((value) => (value === s.id ? null : value))}
          onDrop={(event) => onRowDrop(event, s.id)}
          onDragEnd={() => {
            sessionDragIdRef.current = null;
            setDropBefore(null);
            setDragOverGroup(null);
          }}
          onContextMenu={(event) => setMenu({
            pos: captureContextMenu(event),
            target: { kind: "session", session: s },
          })}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest("button, input, textarea, select")) return;
            cancelDeferredExpand();
            if (autoOpenSshOnDoubleClick) void connect(s);
          }}
          style={{
            "--workspace-row-color": s.color || "var(--accent)",
            borderTop: isDropTarget ? "2px solid var(--accent)" : undefined,
          } as React.CSSProperties}
        >
          <span className="workspace-connection-row__grip" title="Drag to a group" aria-hidden>⋮⋮</span>
          <span className="workspace-connection-row__status" aria-hidden />
          <button
            type="button"
            className="workspace-connection-row__identity"
            onClick={() => toggleExpandDeferred(s.id)}
            title="Open connection details"
          >
            <span className="workspace-connection-row__name">
              {s.name}
              {pins.has(s.id) && <span className="workspace-connection-row__pin" aria-label="Pinned">★</span>}
              {s.deviceTypeIcon && <GuestOsIcon deviceType={s.deviceTypeIcon} />}
            </span>
          </button>
          <button
            type="button"
            className="workspace-connection-row__address"
            title={`${address} — open connection settings`}
            onClick={() => toggleExpandDeferred(s.id)}
          >
            {address}
          </button>
          <span className="workspace-connection-row__actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                title={action.title}
                aria-label={action.label}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
              >
                {action.icon ? <NotesIcon name={action.icon} size={16} /> : action.label}
              </button>
            ))}
            <button
              type="button"
              className="workspace-connection-row__delete"
              title="Delete connection"
              aria-label="Delete connection"
              onClick={(event) => {
                event.stopPropagation();
                remove(s);
              }}
            >
              <NotesIcon name="delete" size={15} />
            </button>
          </span>
        </div>
        {expandedId === s.id && (
          <Modal wide onClose={requestCloseSettings}>
            <div ref={expandedRef}>
              <SessionSettingsPanel
                session={s}
                groups={groups}
                onSaved={() => { closeSettings(); reload(); void pushProfile(); }}
                onCancel={requestCloseSettings}
                onDelete={() => { closeSettings(); remove(s); }}
                onDirtyChange={handleSettingsDirtyChange}
                onSaveRequest={(save) => { settingsSaveRef.current = save; }}
                onConfigureTunnels={canConfigureTunnels(s) ? () => setTunnelEditorId(s.id) : undefined}
                tunnelCount={tunnelCount(s)}
              />
            </div>
          </Modal>
        )}
      </div>
    );
  }

  function renderWorkspaceConnectionRows(items: SavedSession[]) {
    return (
      <div className={`workspace-connection-rows workspace-connection-rows--${viewMode}`}>
        {items.map(renderWorkspaceConnectionRow)}
      </div>
    );
  }

  /// "Focus" view: a responsive grid of square cards. Clicking a card
  /// expands it into a centered modal hosting the same
  /// `SessionSettingsPanel` as the inline list view. Each card also
  /// surfaces the same connect actions as the list row, so users don't
  /// have to open the modal for a routine launch.
  function renderFocusGrid(items: SavedSession[]) {
    const expanded = items.find((s) => s.id === expandedId) ?? null;
    const renderActions = (s: SavedSession): React.ReactNode => {
      const actBtn = (label: string, icon: NotesIconName | null, title: string, onClick: () => void) => (
        <button
          type="button"
          title={title}
          aria-label={label}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          style={icon
            ? { ...CONNECTION_ICON_BUTTON_STYLE, color: s.color || "var(--accent)" }
            : { padding: "4px 10px", fontSize: 13, lineHeight: 1.2 }}
        >
          {icon ? <NotesIcon name={icon} size={17} /> : label}
        </button>
      );
      if (s.protocol === "shell") {
        return (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {actBtn("Local shell", "local-shell", "Launch local shell", () => connect(s))}
          </div>
        );
      }
      if (s.protocol === "console") {
        return (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
            {actBtn("Console", "serial-console", `Open serial console on ${s.host}`, () => connect(s))}
          </div>
        );
      }
      const conn = effectiveSessionConnections(s);
      return (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
          {conn.ssh && actBtn("SSH", "ssh", `SSH to ${s.host}`, () => sshConnect(s))}
          {conn.rdp && actBtn("RDP", "rdp", `RDP to ${s.host}`, () => rdpConnect(s))}
          {conn.sftp && actBtn("SFTP", "sftp", "Open SFTP browser", () => { void sftpBrowser(s); })}
          {conn.browse && (s.webPorts ?? []).slice(0, 1).map((p) => actBtn(
            `Browse port ${p}`,
            "browse",
            `Open ${browseUrl(s.host, p)}`,
            async () => {
              try {
                await browseSessionPort(s, p);
              } catch (e: any) {
                setErr(e.message ?? String(e));
              }
            },
          ))}
        </div>
      );
    };
    return (
      <FocusGrid
        items={items.map((s) => ({
          id: s.id,
          onContextMenu: (e) => setMenu({ pos: captureContextMenu(e), target: { kind: "session", session: s } }),
          card: (
            <>
              <div
                style={{
                  width: "100%",
                  height: 6,
                  background: s.color ?? "var(--accent)",
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "1em",
                  lineHeight: 1.25,
                  wordBreak: "break-word",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>{s.name}</span>
                {pins.has(s.id) && (
                  <span
                    title="Pinned"
                    aria-label="Pinned"
                    style={{ color: "#f9a825", fontSize: "0.875em" }}
                  >
                    {"\u2605"}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="focus-card__address"
                    title={workspaceSessionAddress(s)}
                  >
                    {workspaceSessionAddress(s) || "\u2014"}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(s.keepalive ?? 0) > 0 && (
                      <span style={{ background: "var(--accent)", color: "#fff", padding: "1px 6px", borderRadius: 4, fontSize: "0.75em" }}>
                        KA
                      </span>
                    )}
                    {(s.webPorts ?? []).length > 0 && (
                      <span style={{ background: "var(--muted)", color: "var(--bg)", padding: "1px 6px", borderRadius: 4, fontSize: "0.75em" }}>
                        WEB
                      </span>
                    )}
                    {tunnelCount(s) > 0 && (
                      <span style={{ background: "var(--accent)", color: "#fff", padding: "1px 6px", borderRadius: 4, fontSize: "0.75em" }}>
                        TUN {tunnelCount(s)}
                      </span>
                    )}
                  </div>
                </div>
                {s.deviceTypeIcon && (
                  <GuestOsIcon deviceType={s.deviceTypeIcon} size="lg" tile={40} />
                )}
              </div>
            </>
          ),
          actions: renderActions(s),
        }))}
        expandedId={expandedId}
        expandedContent={
          expanded && (
            <>
              <SessionSettingsPanel
                session={expanded}
                groups={groups}
                onSaved={() => { closeSettings(); reload(); void pushProfile(); }}
                onCancel={requestCloseSettings}
                onDelete={() => { closeSettings(); remove(expanded); }}
                onDirtyChange={handleSettingsDirtyChange}
                onSaveRequest={(save) => { settingsSaveRef.current = save; }}
                onConfigureTunnels={canConfigureTunnels(expanded) ? () => setTunnelEditorId(expanded.id) : undefined}
                tunnelCount={tunnelCount(expanded)}
              />
            </>
          )
        }
        onPick={(id) => toggleExpandDeferred(id)}
        onClose={requestCloseSettings}
        onDoubleClick={(id) => {
          cancelDeferredExpand();
          if (!autoOpenSshOnDoubleClick) return;
          const s = items.find((x) => x.id === id);
          if (s) void connect(s);
        }}
        onReorder={(draggedId, targetId) => {
          // Hand the focus grid's visible order to reorderSession so
          // L->R vs R->L is decided from what the user sees, not from
          // the persisted order/creation-time sort.
          reorderSession(draggedId, targetId, items.map((s) => s.id));
          reload();
          void pushProfile();
        }}
        onDragChange={(draggedId) => { sessionDragIdRef.current = draggedId; }}
        cardSize={focusCardSize}
        clickDelayMs={settingsOpenDelayMs}
      />
    );
  }

  function renderGroup(
    id: string,
    name: string,
    items: SavedSession[],
    extras?: React.ReactNode,
    color?: string,
  ) {
    const isCollapsed = collapsed.has(id);
    const hdr = headerDragHandlers(id);
    return (
      <section
        key={id}
        className={`device-group session-connection-group${isCollapsed ? " collapsed" : " open"}`}
        onDragOver={(e) => onGroupDragOver(e, id)}
        onDragLeave={() => onGroupDragLeave(id)}
        onDrop={(e) => onGroupDrop(e, id)}
        style={{
          "--connection-group-edge": color || "var(--accent)",
          outline: dragOverGroup === id ? "2px dashed var(--accent)" : undefined,
          outlineOffset: 4,
          marginBottom: 16,
          opacity: hdr.isDrag ? 0.5 : 1,
        } as React.CSSProperties}
      >
        <h3
          draggable={hdr.draggable}
          onDragStart={hdr.onDragStart}
          onDragOver={hdr.onDragOver}
          onDragLeave={hdr.onDragLeave}
          onDrop={hdr.onDrop}
          onDragEnd={hdr.onDragEnd}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: hdr.draggable ? "grab" : "pointer",
            userSelect: "none",
            borderTop: hdr.isOver ? "2px solid var(--accent)" : undefined,
            paddingTop: hdr.isOver ? 4 : undefined,
          }}
          onClick={() => toggleCollapsed(id)}
          title={hdr.draggable ? "Drag to reorder groups, click to collapse" : undefined}
        >
          {hdr.draggable && (
            <span aria-hidden style={{ color: "var(--muted)", padding: "0 2px", fontSize: 14 }}>⋮⋮</span>
          )}
          <span aria-hidden style={{ display: "inline-block", width: 14 }}>{isCollapsed ? "▶" : "▼"}</span>
          {name}
          <span className="device-group-count">({items.length})</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            {extras}
          </span>
        </h3>
        {!isCollapsed && (
          items.length === 0
            ? <p className="device-group-empty">Drop a session here to add it.</p>
            : renderWorkspaceConnectionRows(items)
        )}
      </section>
    );
  }

  /// Focus-mode counterpart to `renderGroup`: shows the same collapsible
  /// header (with rename/delete extras and count) wrapping a `FocusGrid`
  /// of the bucket's sessions. Empty buckets still render so users can
  /// see groups they haven't filled yet.
  ///
  /// Also accepts cross-group drops: when a focus card is dropped on the
  /// section (header or empty space), the session moves into this group.
  /// Card-on-card drops are handled by `FocusGrid` via `reorderSession`,
  /// which already detects group changes from the target card's groupId.
  function renderFocusGroup(
    id: string,
    name: string,
    items: SavedSession[],
    extras?: React.ReactNode,
    color?: string,
  ) {
    const isCollapsed = collapsed.has(id);
    const hdr = headerDragHandlers(id);
    const onSectionDragOver = (e: React.DragEvent) => {
      if (!sessionDragIdRef.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverGroup(id);
    };
    const onSectionDragLeave = (e: React.DragEvent) => {
      // Only clear when actually leaving the section (not crossing into a child).
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragOverGroup((d) => (d === id ? null : d));
    };
    const onSectionDrop = (e: React.DragEvent) => {
      const custom = e.dataTransfer.getData("text/x-catwalk-focus-id");
      const plain = e.dataTransfer.getData("text/plain");
      const sid = custom
        || (plain.startsWith("catwalk-focus:") ? plain.slice("catwalk-focus:".length) : "")
        || sessionDragIdRef.current
        || "";
      sessionDragIdRef.current = null;
      setDragOverGroup(null);
      if (!sid) return;
      e.preventDefault();
      assignSessionToGroup(sid, id === UNGROUPED ? undefined : id);
      reload();
      void pushProfile();
    };
    return (
      <section
        key={id}
        className={`device-group session-connection-group${isCollapsed ? " collapsed" : " open"}`}
        style={{
          "--connection-group-edge": color || "var(--accent)",
          marginBottom: 16,
          outline: dragOverGroup === id ? "2px dashed var(--accent)" : undefined,
          borderRadius: 8,
          padding: dragOverGroup === id ? 6 : undefined,
          opacity: hdr.isDrag ? 0.5 : 1,
        } as React.CSSProperties}
        onDragOver={onSectionDragOver}
        onDragLeave={onSectionDragLeave}
        onDrop={onSectionDrop}
      >
        <h3
          draggable={hdr.draggable}
          onDragStart={hdr.onDragStart}
          onDragOver={hdr.onDragOver}
          onDragLeave={hdr.onDragLeave}
          onDrop={hdr.onDrop}
          onDragEnd={hdr.onDragEnd}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: hdr.draggable ? "grab" : "pointer",
            userSelect: "none",
            borderTop: hdr.isOver ? "2px solid var(--accent)" : undefined,
            paddingTop: hdr.isOver ? 4 : undefined,
          }}
          onClick={() => toggleCollapsed(id)}
          title={hdr.draggable ? "Drag to reorder groups, click to collapse" : undefined}
        >
          {hdr.draggable && (
            <span aria-hidden style={{ color: "var(--muted)", padding: "0 2px", fontSize: 14 }}>⋮⋮</span>
          )}
          <span aria-hidden style={{ display: "inline-block", width: 14 }}>{isCollapsed ? "▶" : "▼"}</span>
          {name}
          <span className="device-group-count">({items.length})</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            {extras}
          </span>
        </h3>
        {!isCollapsed && (
          items.length === 0
            ? <p className="device-group-empty">No sessions in this group yet.</p>
            : renderFocusGrid(items)
        )}
      </section>
    );
  }

  function renderWorkspaceGroupControls(group: SessionGroup) {
    return (
      <>
        <button
          className="btn-small outline-action-button outline-action-button--icon"
          onClick={() => renameGroup(group)}
          title={`Rename ${group.name}`}
          aria-label={`Rename ${group.name}`}
        >
          <NotesIcon name="rename" size={15} />
        </button>
        <button
          className="btn-small outline-action-button outline-action-button--icon group-color-action"
          onClick={() => editGroupColor(group)}
          title={`Configure ${group.name} color`}
          aria-label={`Configure ${group.name} color`}
          style={{ "--group-color": group.color || "var(--accent)" } as React.CSSProperties}
        >
          <span className="group-color-action__swatch" aria-hidden />
        </button>
        <button
          className="btn-small outline-action-button outline-action-button--icon outline-action-button--danger"
          onClick={() => removeGroup(group)}
          title={`Delete ${group.name}`}
          aria-label={`Delete ${group.name}`}
        >
          <NotesIcon name="delete" size={15} />
        </button>
      </>
    );
  }

  function renderStructuredWorkspace() {
    const selectedGroup = groups.find((group) => group.id === workspaceGroupId);
    const selectedId = selectedGroup?.id ?? UNGROUPED;
    const selectedName = selectedGroup?.name ?? "Ungrouped";
    const selectedItems = buckets.get(selectedId) ?? [];
    return (
      <section className="structured-connections-workspace" aria-label="Connections by group">
        <aside className="structured-connections-groups">
          <div className="structured-connections-groups__header">
            <span>Groups</span>
          </div>
          {[...groups, { id: UNGROUPED, name: "Ungrouped", color: "" } as SessionGroup].map((group) => {
            const count = (buckets.get(group.id) ?? []).length;
            return (
              <button
                type="button"
                key={group.id}
                className={`structured-connections-group${selectedId === group.id ? " active" : ""}`}
                onClick={() => setWorkspaceGroupId(group.id)}
                aria-pressed={selectedId === group.id}
                style={{ "--structured-group-color": group.color || "var(--accent)" } as React.CSSProperties}
              >
                <span>{group.name}</span>
                <span>{count}</span>
              </button>
            );
          })}
        </aside>
        <div className="structured-connections-content">
          <header className="structured-connections-content__header">
            <div>
              <strong>{selectedName}</strong>
              <span>{selectedItems.length} connection{selectedItems.length === 1 ? "" : "s"}</span>
            </div>
            {selectedGroup && (
              <div className="structured-connections-content__actions">
                {renderWorkspaceGroupControls(selectedGroup)}
              </div>
            )}
          </header>
          {viewMode === "list" && (
            <div className="structured-connections-columns" aria-hidden="true">
              <span>Name</span>
              <span>Address</span>
              <span>Actions</span>
            </div>
          )}
          {selectedItems.length === 0
            ? <p className="device-group-empty structured-connections-empty">No connections in this group.</p>
            : viewMode === "focus"
              ? renderFocusGrid(selectedItems)
              : renderWorkspaceConnectionRows(selectedItems)}
        </div>
      </section>
    );
  }

  return (
    <div
      className={`connections-page connections-page--${viewMode} workspace-page--${appearance.workspaceDesign}`}
      data-renderer-reset-dirty={
        expandedId || newDraft || tunnelEditorId || groupPrompt || groupColorEditor ? "true" : undefined
      }
      onContextMenu={(e) => {
        // Page-level right click: open the "new" menu only when the user
        // clicked outside a session card. The row handler stops propagation
        // by setting its own menu first, so this fires for empty space,
        // headers and the page background.
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        setMenu({ pos: captureContextMenu(e), target: { kind: "empty" } });
      }}
      style={{
        minHeight: "100%",
        "--connection-action-icon-size": `${appearance.connectionActionIconSize}px`,
      } as React.CSSProperties}
    >
      <header className="connections-page-header">
        <h2 className="page-view-title">Connections</h2>
        <div
          className="connections-toolbar"
          onContextMenu={(event) => {
            event.stopPropagation();
            setMenu({ pos: captureContextMenu(event), target: { kind: "toolbar" } });
          }}
        >
        <input
          type="search"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
          aria-label="Search saved connections"
          style={{ maxWidth: 280 }}
        />
        <ThemedSelect
          ariaLabel="Filter connections by type"
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as InventoryTypeFilter)}
          className="workspace-filter-select workspace-filter-select--type"
          options={[
            { value: "all", label: "All types" },
            { value: "hardware", label: "Hardware" },
            { value: "switch", label: "Switch" },
            { value: "router", label: "Router" },
            { value: "vm", label: "VM" },
            { value: "cml", label: "CML" },
          ]}
        />
        <ThemedSelect
          ariaLabel="Filter connections by operating system"
          value={osFilter}
          onChange={setOsFilter}
          className="workspace-filter-select workspace-filter-select--os"
          options={[
            { value: "all", label: "All OS types" },
            ...sessionOsOptions,
          ]}
        />
        <button
          className={`btn-secondary connections-toolbar-action${showToolbarText ? "" : " connections-toolbar-action--only"}`}
          onClick={() => startNew("ssh")}
          title="New device"
          aria-label="New device"
        >
          <NotesIcon name="new-device" size={18} />
          {showToolbarText && <span>New device</span>}
        </button>
        <button
          className={`btn-secondary connections-toolbar-action${showToolbarText ? "" : " connections-toolbar-action--only"}`}
          onClick={() => startNew("console")}
          title="New serial console"
          aria-label="New serial console"
        >
          <NotesIcon name="serial-console" size={18} />
          {showToolbarText && <span>Console</span>}
        </button>
        <button
          className={`btn-secondary connections-toolbar-action${showToolbarText ? "" : " connections-toolbar-action--only"}`}
          onClick={() => startNew("shell")}
          title="New local shell"
          aria-label="New local shell"
        >
          <NotesIcon name="local-shell" size={18} />
          {showToolbarText && <span>Local shell</span>}
        </button>
        <button
          onClick={addGroup}
          className={`btn-secondary connections-toolbar-action${showToolbarText ? "" : " connections-toolbar-action--only"}`}
          title="New group"
          aria-label="New group"
        >
          <NotesIcon name="group" size={18} />
          {showToolbarText && <span>Group</span>}
        </button>
          <ActionIconLegend items={[
            { icon: "local-shell", label: "Local shell" },
            { icon: "serial-console", label: "Serial console" },
            { icon: "ssh", label: "SSH" },
            { icon: "rdp", label: "RDP" },
            { icon: "sftp", label: "SFTP" },
            { icon: "browse", label: "Browse" },
          ]} />
        </div>
      </header>

      {err && <p style={{ color: "salmon" }}>{err}</p>}

      {filtered.length === 0 && groups.length === 0 && !newDraft && (
        <p style={{ color: "var(--muted)" }}>No saved sessions yet. Add one above.</p>
      )}

      {appearance.workspaceDesign === "structured" ? (
        renderStructuredWorkspace()
      ) : viewMode === "focus" ? (
        <>
          {groups.map((g) => renderFocusGroup(
            g.id,
            g.name,
            buckets.get(g.id) ?? [],
            (
              renderWorkspaceGroupControls(g)
            ),
            g.color,
          ))}
          {renderFocusGroup(UNGROUPED, "Ungrouped", buckets.get(UNGROUPED) ?? [])}
        </>
      ) : (
        <>
          {groups.map((g) =>
            renderGroup(g.id, g.name, buckets.get(g.id) ?? [], (
              renderWorkspaceGroupControls(g)
            ), g.color),
          )}
          {renderGroup(UNGROUPED, "Ungrouped", buckets.get(UNGROUPED) ?? [])}
        </>
      )}

      {newDraft && (
        <Modal wide onClose={requestCloseNewDraft}>
          <h3 style={{ marginTop: 0 }}>
            {newDraft.protocol === "shell"
              ? "New local shell"
              : newDraft.protocol === "console"
                ? "New serial console"
                : "New device"}
          </h3>
          <SessionSettingsPanel
            session={newDraft}
            groups={groups}
            onSaved={() => { closeNewDraft(); reload(); void pushProfile(); }}
            onCancel={requestCloseNewDraft}
            onDirtyChange={(dirty) => { newDraftDirtyRef.current = dirty; }}
            onSaveRequest={(save) => { newDraftSaveRef.current = save; }}
          />
        </Modal>
      )}

      {tunnelEditorSession && (
        <TunnelEditorModal
          session={tunnelEditorSession}
          onClose={() => setTunnelEditorId(null)}
          onSave={(tunnels) => saveSessionTunnels(tunnelEditorSession.id, tunnels)}
        />
      )}

      {groupPrompt && (
        <Modal onClose={() => setGroupPrompt(null)}>
          <h3 style={{ marginTop: 0 }}>
            {groupPrompt.mode === "new" ? "New group" : `Rename "${groupPrompt.group.name}"`}
          </h3>
          <input
            autoFocus
            value={groupPromptText}
            onChange={(e) => setGroupPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitGroupPrompt();
              if (e.key === "Escape") setGroupPrompt(null);
            }}
            placeholder="Group name"
            style={{ width: "100%", marginBottom: 12 }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="outline-action-button outline-action-button--muted" onClick={() => setGroupPrompt(null)}>
              <NotesIcon name="cancel" size={15} />
              Cancel
            </button>
            <button className="outline-action-button" onClick={submitGroupPrompt} disabled={!groupPromptText.trim()}>
              <NotesIcon name={groupPrompt.mode === "new" ? "add" : "rename"} size={15} />
              {groupPrompt.mode === "new" ? "Create" : "Rename"}
            </button>
          </div>
        </Modal>
      )}

      {groupColorEditor && (
        <Modal onClose={() => setGroupColorEditor(null)}>
          <h3 style={{ marginTop: 0 }}>Group color</h3>
          <p style={{ color: "var(--muted)", marginTop: -4 }}>
            Choose the frame color for <strong>{groupColorEditor.name}</strong>. The same color is used in the Sessions sidebar.
          </p>
          <label className="group-color-editor">
            <span>Color</span>
            <input
              autoFocus
              type="color"
              value={groupColorDraft}
              onChange={(e) => setGroupColorDraft(e.target.value)}
              aria-label={`${groupColorEditor.name} group color`}
            />
            <code>{groupColorDraft.toUpperCase()}</code>
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button className="outline-action-button outline-action-button--muted" onClick={() => setGroupColorEditor(null)}>
              <NotesIcon name="cancel" size={15} />
              Cancel
            </button>
            <button className="outline-action-button outline-action-button--muted" onClick={() => saveGroupColor(undefined)}>
              Use theme accent
            </button>
            <button className="outline-action-button" onClick={() => saveGroupColor(groupColorDraft)}>
              <NotesIcon name="save" size={15} />
              Save
            </button>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)}>
          <h3 style={{ marginTop: 0 }}>Delete?</h3>
          <p>
            {confirmDel.kind === "session"
              ? <>Delete session <strong>{confirmDel.session.name}</strong>?</>
              : <>Delete group <strong>{confirmDel.group.name}</strong>? Its sessions move to Ungrouped.</>}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="outline-action-button outline-action-button--muted" onClick={() => setConfirmDel(null)}>
              <NotesIcon name="cancel" size={15} />
              Cancel
            </button>
            <button className="outline-action-button outline-action-button--danger" onClick={submitConfirmDel}>
              <NotesIcon name="delete" size={15} />
              Delete
            </button>
          </div>
        </Modal>
      )}

      {settingsClosePrompt && (
        <UnsavedSettingsDialog
          subject="connection"
          saving={settingsPromptSaving}
          onSave={() => { void saveAndCloseSettings(); }}
          onDiscard={closeSettings}
          onKeepEditing={() => setSettingsClosePrompt(false)}
        />
      )}

      {newDraftClosePrompt && (
        <UnsavedSettingsDialog
          subject="connection"
          saving={newDraftPromptSaving}
          onSave={() => { void saveAndCloseNewDraft(); }}
          onDiscard={closeNewDraft}
          onKeepEditing={() => setNewDraftClosePrompt(false)}
        />
      )}

      {menu && (
        <ContextMenu
          position={menu.pos}
          items={
            menu.target.kind === "empty"
              ? emptyMenuItems()
              : menu.target.kind === "toolbar"
                ? toolbarMenuItems()
              : sessionMenuItems(menu.target.session)
          }
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface TunnelDraft {
  id: string;
  localPort: string;
  destinationHost: string;
  destinationPort: string;
}

function tunnelDraftFrom(t: SavedSessionTunnel): TunnelDraft {
  return {
    id: t.id,
    localPort: String(t.localPort),
    destinationHost: t.destinationHost,
    destinationPort: String(t.destinationPort),
  };
}

function newTunnelDraft(): TunnelDraft {
  return {
    id: newId(),
    localPort: "",
    destinationHost: "",
    destinationPort: "",
  };
}

function parseTunnelDraft(row: TunnelDraft): SavedSessionTunnel | null {
  const localPort = Number(row.localPort);
  const destinationPort = Number(row.destinationPort);
  const destinationHost = row.destinationHost.trim();
  if (!row.localPort.trim() && !destinationHost && !row.destinationPort.trim()) return null;
  if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) {
    throw new Error("Local port must be between 1 and 65535.");
  }
  if (!destinationHost) {
    throw new Error("Destination IP/host is required.");
  }
  if (/[\s"'\\]/.test(destinationHost)) {
    throw new Error("Destination IP/host cannot contain spaces or quotes.");
  }
  if (!Number.isInteger(destinationPort) || destinationPort <= 0 || destinationPort > 65535) {
    throw new Error("Destination port must be between 1 and 65535.");
  }
  return {
    id: row.id || newId(),
    localPort,
    destinationHost,
    destinationPort,
  };
}

function TunnelEditorModal({
  session,
  onClose,
  onSave,
}: {
  session: SavedSession;
  onClose: () => void;
  onSave: (tunnels: SavedSessionTunnel[]) => void;
}) {
  const [rows, setRows] = useState<TunnelDraft[]>(() => {
    const existing = normalizedSessionTunnels(session).map(tunnelDraftFrom);
    return existing.length > 0 ? existing : [newTunnelDraft()];
  });
  const [err, setErr] = useState<string | null>(null);

  function patchRow(id: string, updates: Partial<TunnelDraft>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...updates } : row)));
  }

  function removeRow(id: string) {
    setRows((prev) => {
      const next = prev.filter((row) => row.id !== id);
      return next.length > 0 ? next : [newTunnelDraft()];
    });
  }

  function submit() {
    try {
      const parsed = rows
        .map(parseTunnelDraft)
        .filter((row): row is SavedSessionTunnel => row != null);
      setErr(null);
      onSave(parsed);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  const previewTunnels = rows
    .map((row) => {
      try {
        return parseTunnelDraft(row);
      } catch {
        return null;
      }
    })
    .filter((row): row is SavedSessionTunnel => row != null);
  const previewSpecs = sessionSshForwardSpecs({ sshTunnels: previewTunnels });

  return (
    <Modal wide onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>{session.name} tunnels</h3>
      <p style={{ color: "var(--muted)", marginTop: -4 }}>
        Opens with SSH as local forwards like <code>-L local:destination:port</code>.
      </p>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: 12 }}>
              <th style={{ padding: "6px 8px" }}>Local port</th>
              <th style={{ padding: "6px 8px" }}>Destination IP</th>
              <th style={{ padding: "6px 8px" }}>Destination port</th>
              <th style={{ padding: "6px 8px", width: 72 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px" }}>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={row.localPort}
                    onChange={(e) => patchRow(row.id, { localPort: e.target.value })}
                    placeholder="15443"
                    style={{ width: "9ch" }}
                  />
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <input
                    value={row.destinationHost}
                    onChange={(e) => patchRow(row.id, { destinationHost: e.target.value })}
                    placeholder="10.0.0.10"
                    style={{ width: "100%", minWidth: "18ch" }}
                  />
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={row.destinationPort}
                    onChange={(e) => patchRow(row.id, { destinationPort: e.target.value })}
                    placeholder="443"
                    style={{ width: "9ch" }}
                  />
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <button className="outline-action-button outline-action-button--danger" type="button" onClick={() => removeRow(row.id)} title="Remove tunnel">
                    <NotesIcon name="delete" size={15} />
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <button className="outline-action-button" type="button" onClick={() => setRows((prev) => [...prev, newTunnelDraft()])}>
          <NotesIcon name="add" size={15} />
          Add tunnel
        </button>
        {previewSpecs.length > 0 && (
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {previewSpecs.join(", ")}
          </span>
        )}
      </div>
      {err && <p style={{ color: "salmon" }}>{err}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="outline-action-button outline-action-button--muted" type="button" onClick={onClose}>
          <NotesIcon name="cancel" size={15} />
          Cancel
        </button>
        <button className="outline-action-button" type="button" onClick={submit}>
          <NotesIcon name="save" size={15} />
          Save tunnels
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  children,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          minWidth: 360,
          maxWidth: wide ? 720 : 480,
          width: wide ? "100%" : undefined,
          maxHeight: "calc(100vh - 24px)",
          overflowY: "auto",
          overflowX: "hidden",
          background: "var(--surface-bg, var(--bg))",
          marginBottom: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function defaultShell(): string {
  return navigator.userAgent.includes("Windows") ? "cmd.exe" : "/bin/zsh";
}

function isWindows(): boolean {
  return navigator.userAgent.includes("Windows");
}

/// Pick the external-terminal app for a session-launch on this OS.
/// Order: the session's per-OS override → the global default in
/// `catwalk.terminal` → undefined (let the rust launcher choose).
function pickSessionTerminal(s: SavedSession): string | undefined {
  const sessChoice = isWindows() ? s.terminalWindows : s.terminalMac;
  if (sessChoice && sessChoice.trim()) return sessChoice;
  return localStorage.getItem("catwalk.terminal") ?? undefined;
}

function splitCmd(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of s) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ && ch === " ") {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
