import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  MosaicWithoutDragDropContext as Mosaic,
  MosaicNode,
  MosaicWindow,
} from "react-mosaic-component";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  readText as clipReadText,
  writeText as clipWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import {
  useTerminals,
  TerminalTab,
  type TerminalSplitWorkspace,
  terminalPopoutOptions,
} from "../terminals/TerminalsContext";
import {
  isConneCatSessionWindow,
  openConneCatSessionWindow,
  openInMainConneCat,
} from "../api/sessionWindow";
import TerminalsSidebar from "../terminals/TerminalsSidebar";
import TemplatePicker from "../terminals/TemplatePicker";
import TemplatesManager from "../terminals/TemplatesManager";
import { CommandTemplate } from "../terminals/templates";
import { buildTemplateMenuItem } from "../terminals/templateMenu";
import { listUserTemplates } from "../terminals/userTemplates";
import { listSharedTemplates, refreshSharedTemplates, subscribeSharedTemplates } from "../terminals/sharedTemplates";
import { useAppearance } from "../appearance/AppearanceContext";
import { resolveTerminalRenderer, type ResolvedTerminalRenderer } from "../terminals/terminalRenderer";
import {
  captureTerminalSelection,
  loadNotebooks,
  notebookDestinations,
  subscribeNotebooks,
} from "../notebooks/store";
import type {
  SessionGroupDoubleClickAction,
  SessionGroupMiddleClickAction,
} from "../api/appearance";
import ContextMenu, {
  type ContextMenuItem,
  type ContextMenuPosition,
  captureContextMenu,
} from "../components/ContextMenu";
import NotesIcon from "../components/NotesIcon";
import SessionAccentButton from "../terminals/SessionAccentButton";
import { normalizeConsoleText } from "../utils/consoleText";
import { terminalSessionHealth } from "../terminals/sessionHealth";
import {
  isUsableTerminalGeometry,
  isUsableTerminalGrid,
} from "../terminals/terminalGeometry";
import {
  claimTerminalTransfer,
  hasExplicitTerminalDropZone,
} from "../terminals/terminalTransfer";
import {
  arrangeTerminalWorkspace,
  terminalWorkspaceIds,
  type TerminalWorkspaceArrange,
} from "../terminals/terminalLayout";
import {
  sessionTabShortcut,
  sessionTabShortcutTarget,
} from "../navigation/sessionTabNavigation";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  captureCanvasBackingStores,
  canvasBackingStorePixels,
  disposeWebglAddonAndContext,
  releaseCanvasBackingStores,
} from "../terminals/webglCleanup";
import { diagnosticEvent } from "../api/diagnostics";
import "@xterm/xterm/css/xterm.css";
import "react-mosaic-component/react-mosaic-component.css";

const SEARCH_DECORATIONS = {
  matchBackground: "#7c5f00",
  matchBorder: "#d97706",
  matchOverviewRuler: "#d97706",
  activeMatchBackground: "#b45309",
  activeMatchBorder: "#fbbf24",
  activeMatchColorOverviewRuler: "#fbbf24",
};

const TERMINAL_TRANSFER_CHANNEL = "catwalk-terminal-tab-transfer";
const TERMINAL_TRANSFER_PREFIX = "catwalk.terminalTransfer.";
const TERMINAL_TRANSFER_ACK_PREFIX = "catwalk.terminalTransferAck.";
const TERMINAL_NOTES_DESTINATION_KEY = "catwalk.terminals.notesDestination";
const terminalWindowId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

type TerminalTransferEntry = {
  tabId: number;
  options: Record<string, unknown>;
  ptyId: number;
};

type TerminalTransferPayload = {
  sourceWindowId: string;
  tabs: TerminalTransferEntry[];
};

type SessionStatusPopup = {
  tabId: number;
  status: "retrieving" | "sent" | "blocked" | "error";
  message: string;
};

export default function Terminals() {
  const sessionWindow = isConneCatSessionWindow();
  const {
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
    close,
    release,
    open,
    adopt,
    reconnect,
    duplicate,
    setLayout,
    setTabGroup,
    arrangeGroup,
    broadcastGroups,
    toggleGroupBroadcast,
    broadcastAll,
    toggleBroadcastAll,
    sendText,
    broadcastTextToGroup,
  } = useTerminals();
  const { appearance, userPrefs, setUserPrefs } = useAppearance();
  const terminalRenderer = resolveTerminalRenderer(appearance.terminalRenderer);
  const showToolbarText = appearance.terminalToolbarDisplay === "iconsAndText";

  // Active template picker, if any. `target` decides where Send routes
  // the rendered body (a single tab id or a group name).
  const [picker, setPicker] = useState<
    | { template: CommandTemplate; target: { kind: "tab"; id: number; title: string } | { kind: "group"; name: string } }
    | null
  >(null);

  // User-template manager modal toggle, and a cached snapshot of the
  // current user templates. Bumping `userTplVersion` re-reads from
  // localStorage so menus pick up edits made in the manager without a
  // full page reload.
  const [managerOpen, setManagerOpen] = useState(false);
  const [popoutError, setPopoutError] = useState("");
  const popoutPendingIdsRef = useRef<Set<number>>(new Set());
  const [popoutPendingIds, setPopoutPendingIds] = useState<Set<number>>(() => new Set());
  const [tabDropTarget, setTabDropTarget] = useState<{
    id: number;
    placement: "before" | "after";
  } | null>(null);
  const [windowDropActive, setWindowDropActive] = useState(false);
  const [healthNow, setHealthNow] = useState(() => Date.now());
  const transferChannelRef = useRef<BroadcastChannel | null>(null);
  // Native drag/drop can reach both the window capture listener and a React
  // drop zone. Claim a token before adopting anything so one physical drop
  // can never attach the same PTY twice.
  const acceptingTransferTokensRef = useRef<Set<string>>(new Set());
  const [userTplVersion, setUserTplVersion] = useState(0);
  const userTemplates = useMemo(() => [...listUserTemplates(), ...listSharedTemplates()], [userTplVersion]);
  useEffect(() => {
    // Only tick while the window is visible: healthNow drives an Idle/Active
    // label — freezing it while hidden avoids re-rendering every tab pill.
    let timer: number | null = null;
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(() => setHealthNow(Date.now()), 15_000);
    };
    const stop = () => {
      if (timer != null) { window.clearInterval(timer); timer = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { setHealthNow(Date.now()); start(); }
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSharedTemplates(() => setUserTplVersion((version) => version + 1));
    void refreshSharedTemplates();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const accept = (message: { type?: string; sourceWindowId?: string; tabId?: number; tabIds?: number[] } | null) => {
      if (message?.type !== "accepted" || message.sourceWindowId !== terminalWindowId) return;
      const ids = message.tabIds ?? (typeof message.tabId === "number" ? [message.tabId] : []);
      ids.forEach((id) => release(id));
    };
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(TERMINAL_TRANSFER_CHANNEL);
    transferChannelRef.current = channel;
    if (channel) channel.onmessage = (event) => accept(event.data);
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(TERMINAL_TRANSFER_ACK_PREFIX) || !event.newValue) return;
      try { accept(JSON.parse(event.newValue)); } catch { /* ignore malformed transfer ack */ }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      transferChannelRef.current = null;
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [release]);

  // Inline group-name prompt (Tauri webview doesn’t implement
  // window.prompt, so a real modal is required). `tabId` is the tab
  // whose group we’re setting.
  const [groupRenamePrompt, setGroupRenamePrompt] = useState<
    | { tabId: number; initial: string }
    | null
  >(null);
  const [groupRenameText, setGroupRenameText] = useState("");

  // Cursor-anchored context menu for the empty-state placeholder. The
  // tab-strip uses a separate state shape (`tabMenu`) because it cares
  // about the tab identity, not just a position.
  const [emptyMenuPos, setEmptyMenuPos] = useState<ContextMenuPosition | null>(null);
  const navigate = useNavigate();
  const groupClickTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (groupClickTimerRef.current != null) {
      window.clearTimeout(groupClickTimerRef.current);
      groupClickTimerRef.current = null;
    }
  }, []);

  // Right-click menu state for the tab strip. `tabId` is the tab the menu
  // applies to; `x`/`y` are viewport coordinates so we can render at the
  // cursor regardless of which tab was clicked. `groupOnly` (when set)
  // tells the menu it was opened from a group label \u2014 only group/arrange
  // entries should be shown.
  const [tabMenu, setTabMenu] = useState<
    | { tabId: number; x: number; y: number; groupOnly?: string }
    | null
  >(null);

  // Pane right-click menu. Populated when a terminal host fires the
  // `catwalk:terminal-pane-menu` CustomEvent — which only happens when
  // the user has disabled "Right-click pastes into terminal" in Settings.
  // Held as plain coordinates + tabId; the menu items are computed at
  // render time from the matching TerminalTab.
  const [paneMenu, setPaneMenu] = useState<
    | { tabId: number; pos: ContextMenuPosition }
    | null
  >(null);
  const [notesMenuPos, setNotesMenuPos] = useState<ContextMenuPosition | null>(null);
  const [toolbarMenuPos, setToolbarMenuPos] = useState<ContextMenuPosition | null>(null);
  const [notesDestinationId, setNotesDestinationId] = useState(() => localStorage.getItem(TERMINAL_NOTES_DESTINATION_KEY) ?? "");
  const [notebookVersion, setNotebookVersion] = useState(0);
  const [notesCaptureStatus, setNotesCaptureStatus] = useState("");
  const [sessionStatusPopup, setSessionStatusPopup] = useState<SessionStatusPopup | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findResult, setFindResult] = useState<{ resultIndex: number; resultCount: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const notesControlRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tabMenu) return;
    const onDoc = () => setTabMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTabMenu(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ tabId: number; x: number; y: number }>;
      const d = ce.detail;
      if (!d || typeof d.tabId !== "number") return;
      setPaneMenu({ tabId: d.tabId, pos: { x: d.x, y: d.y } });
    };
    window.addEventListener("catwalk:terminal-pane-menu", handler);
    return () => window.removeEventListener("catwalk:terminal-pane-menu", handler);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SessionStatusPopup>).detail;
      if (!detail || typeof detail.tabId !== "number" || !detail.message) return;
      setSessionStatusPopup(detail);
    };
    window.addEventListener("catwalk:terminal-password-status", handler);
    return () => window.removeEventListener("catwalk:terminal-password-status", handler);
  }, []);

  useEffect(() => {
    if (!sessionStatusPopup || sessionStatusPopup.status === "retrieving") return;
    const timer = window.setTimeout(() => setSessionStatusPopup(null), 2600);
    return () => window.clearTimeout(timer);
  }, [sessionStatusPopup]);

  async function newLocalShell() {
    const isWin = navigator.userAgent.includes("Windows");
    const cmd = isWin ? "cmd.exe" : (await guessShell());
    await open({ title: "Local shell", cmd, controlKeyMode: "local-shell" });
  }

  const tabById = useMemo(() => {
    const m = new Map<number, TerminalTab>();
    for (const t of tabs) m.set(t.id, t);
    return m;
  }, [tabs]);
  const activeTab = activeId == null ? null : tabById.get(activeId) ?? null;
  const notesDestinations = useMemo(
    () => notebookDestinations(loadNotebooks()).filter((destination) => destination.sections.length > 0),
    [notebookVersion],
  );
  const notesSection = useMemo(
    () => notesDestinations.flatMap((destination) => destination.sections).find((section) => section.id === notesDestinationId) ?? null,
    [notesDestinationId, notesDestinations],
  );
  const notesBook = notesSection
    ? notesDestinations.find((destination) => destination.book.id === notesSection.bookId)?.book ?? null
    : null;

  useEffect(() => subscribeNotebooks(() => setNotebookVersion((version) => version + 1)), []);

  useEffect(() => {
    if (notesSection || notesDestinations.length === 0) return;
    const fallback = notesDestinations[0].sections[0];
    setNotesDestinationId(fallback.id);
    localStorage.setItem(TERMINAL_NOTES_DESTINATION_KEY, fallback.id);
  }, [notesDestinations, notesSection]);

  const rememberNotesSection = useCallback((sectionId: string) => {
    setNotesDestinationId(sectionId);
    localStorage.setItem(TERMINAL_NOTES_DESTINATION_KEY, sectionId);
  }, []);

  const captureTabToNotes = useCallback((tabId: number) => {
    const tab = tabById.get(tabId);
    if (!tab) return;
    if (!notesSection) {
      setNotesCaptureStatus("Choose a Notes section");
      window.setTimeout(() => setNotesCaptureStatus(""), 1800);
      return;
    }
    const selection = tab.terminal.getSelection();
    if (!selection) {
      setNotesCaptureStatus("Select terminal output first");
      window.setTimeout(() => setNotesCaptureStatus(""), 1800);
      return;
    }
    const result = captureTerminalSelection(notesSection.id, tab.title, selection);
    setNotesCaptureStatus(result.note ? `Saved to ${notesSection.title}` : "Unable to create note");
    window.setTimeout(() => setNotesCaptureStatus(""), 1800);
  }, [notesSection, tabById]);

  useEffect(() => {
    const send = (event: Event) => {
      const tabId = (event as CustomEvent<{ tabId?: number }>).detail?.tabId;
      if (typeof tabId === "number") captureTabToNotes(tabId);
    };
    window.addEventListener("catwalk:terminal-send-to-notes", send);
    return () => window.removeEventListener("catwalk:terminal-send-to-notes", send);
  }, [captureTabToNotes]);

  const visibleIds = useMemo(() => collectLeaves(layout), [layout]);
  const splitMemberIds = useMemo(() => new Set(
    splitWorkspaces.flatMap((workspace) => terminalWorkspaceIds(workspace.layout)),
  ), [splitWorkspaces]);

  // Distinct group labels in first-seen order, mapped to a stable pastel
  // colour so the dividers and the tab-strip pill keep their identity as
  // tabs are added or removed.
  const groupNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tabs) {
      if (t.group && !seen.has(t.group)) {
        seen.add(t.group);
        out.push(t.group);
      }
    }
    return out;
  }, [tabs]);

  function colorForGroup(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 55%, 55%)`;
  }

  function clearPendingGroupClick() {
    if (groupClickTimerRef.current != null) {
      window.clearTimeout(groupClickTimerRef.current);
      groupClickTimerRef.current = null;
    }
  }

  function tabsForGroup(name: string): TerminalTab[] {
    return tabs.filter((t) => t.group === name);
  }

  const focusFindInput = useCallback(() => {
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  const openFind = useCallback((tabId?: number) => {
    if (tabId != null && tabById.has(tabId)) setActive(tabId);
    setFindOpen(true);
    focusFindInput();
  }, [focusFindInput, setActive, tabById]);

  function searchOptions(incremental = false) {
    return {
      caseSensitive: findCaseSensitive,
      incremental,
      decorations: SEARCH_DECORATIONS,
    };
  }

  function runFind(direction: "next" | "previous" = "next", incremental = false) {
    if (!activeTab) return;
    const query = findQuery;
    if (!query) {
      activeTab.search.clearDecorations();
      setFindResult(null);
      return;
    }
    const ok = direction === "previous"
      ? activeTab.search.findPrevious(query, searchOptions(false))
      : activeTab.search.findNext(query, searchOptions(incremental));
    if (!ok) setFindResult({ resultIndex: -1, resultCount: 0 });
  }

  function closeFind() {
    for (const t of tabs) t.search.clearDecorations();
    setFindOpen(false);
    setFindResult(null);
    activeTab?.terminal.focus();
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tabId?: number }>).detail;
      if (findOpen) closeFind();
      else openFind(detail?.tabId);
    };
    window.addEventListener("catwalk:terminal-find", handler);
    return () => window.removeEventListener("catwalk:terminal-find", handler);
  }, [findOpen, openFind]);

  useEffect(() => {
    if (!activeTab) {
      setFindResult(null);
      return;
    }
    const disposable = activeTab.search.onDidChangeResults((event) => {
      setFindResult({ resultIndex: event.resultIndex, resultCount: event.resultCount });
    });
    return () => disposable.dispose();
  }, [activeTab]);

  useEffect(() => {
    if (!findOpen || !activeTab) return;
    if (!findQuery) {
      activeTab.search.clearDecorations();
      setFindResult(null);
      return;
    }
    runFind("next", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findQuery, findCaseSensitive, activeTab?.id]);

  function scheduleGroupArrange(name: string) {
    clearPendingGroupClick();
    if (appearance.sessionGroupDoubleClickAction === "none") {
      arrangeGroup(name, "grid");
      return;
    }
    groupClickTimerRef.current = window.setTimeout(() => {
      groupClickTimerRef.current = null;
      arrangeGroup(name, "grid");
    }, 250);
  }

  function runSessionGroupAction(
    name: string,
    action: SessionGroupDoubleClickAction | SessionGroupMiddleClickAction,
  ) {
    const groupTabs = tabsForGroup(name);
    if (groupTabs.length === 0) return;
    switch (action) {
      case "reconnect":
        for (const t of groupTabs) void reconnect(t.id);
        break;
      case "closeAll":
        for (const t of groupTabs) void close(t.id);
        break;
      case "ungroup":
        for (const t of groupTabs) setTabGroup(t.id, undefined);
        break;
      case "none":
        break;
    }
  }

  function sessionGroupActionLabel(
    action: SessionGroupDoubleClickAction | SessionGroupMiddleClickAction,
  ): string {
    switch (action) {
      case "reconnect": return "reconnect all";
      case "closeAll": return "close all";
      case "ungroup": return "ungroup";
      case "none": return "do nothing";
    }
  }

  // Render order: each group's tabs stay contiguous in the order they
  // were opened; ungrouped tabs come last (also in spawn order).
  const orderedTabs = useMemo(() => {
    const buckets: TerminalTab[][] = groupNames.map(() => []);
    const ungrouped: TerminalTab[] = [];
    for (const t of tabs) {
      if (!t.group) { ungrouped.push(t); continue; }
      const i = groupNames.indexOf(t.group);
      buckets[i].push(t);
    }
    return { buckets, ungrouped };
  }, [tabs, groupNames]);
  const orderedTabIds = useMemo(
    () => [...orderedTabs.buckets.flat(), ...orderedTabs.ungrouped].map((tab) => tab.id),
    [orderedTabs],
  );
  const splitWorkspaceTabs = useMemo(() => splitWorkspaces.map((workspace) => ({
    ...workspace,
    tabs: terminalWorkspaceIds(workspace.layout)
      .map((id) => tabById.get(id))
      .filter((tab): tab is TerminalTab => tab != null),
  })).filter((workspace) => workspace.tabs.length > 1), [splitWorkspaces, tabById]);

  useEffect(() => {
    const onTabShortcut = (event: KeyboardEvent) => {
      const shortcut = sessionTabShortcut(event);
      if (!shortcut) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], .app-dialog-backdrop')) return;
      const targetId = sessionTabShortcutTarget(orderedTabIds, activeId, shortcut);
      if (targetId == null) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setActive(targetId);
    };
    window.addEventListener("keydown", onTabShortcut, { capture: true });
    return () => window.removeEventListener("keydown", onTabShortcut, { capture: true });
  }, [activeId, orderedTabIds, setActive]);

  // Single tab pill renderer; used both inside group blocks and for
  // ungrouped tabs so behaviour stays identical.
  // Ref-callback per pill so we can scroll the active one into view when
  // a launcher (Lab Devices / My Connections / reconnect) spawns a new
  // tab while the strip is wide enough to scroll horizontally.
  const tabPillRefs = useRef(new Map<number, HTMLDivElement>());
  useEffect(() => {
    if (activeId == null) return;
    const el = tabPillRefs.current.get(activeId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeId]);

  const popOutTerminal = async (tab: TerminalTab) => {
    if (popoutPendingIdsRef.current.size > 0) return;
    popoutPendingIdsRef.current.add(tab.id);
    setPopoutPendingIds(new Set(popoutPendingIdsRef.current));
    setPopoutError("");
    setSessionStatusPopup({
      tabId: tab.id,
      status: "retrieving",
      message: `Getting credentials for ${tab.title}…`,
    });
    try {
      const options = await terminalPopoutOptions(tab);
      await openConneCatSessionWindow(
        { kind: "terminal", options: options as unknown as Record<string, unknown>, ptyId: tab.ptyId },
        tab.title,
      );
      setSessionStatusPopup({ tabId: tab.id, status: "sent", message: `${tab.title} opened in a new window.` });
      release(tab.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPopoutError(message);
      setSessionStatusPopup({ tabId: tab.id, status: "error", message: "Could not open the session window." });
    } finally {
      popoutPendingIdsRef.current.delete(tab.id);
      setPopoutPendingIds(new Set(popoutPendingIdsRef.current));
    }
  };

  const popOutGroup = async (group: string) => {
    const members = tabs.filter((tab) => tab.group === group);
    if (members.length === 0) return;
    if (popoutPendingIdsRef.current.size > 0) return;
    members.forEach((tab) => popoutPendingIdsRef.current.add(tab.id));
    setPopoutPendingIds(new Set(popoutPendingIdsRef.current));
    setPopoutError("");
    setSessionStatusPopup({
      tabId: members[0].id,
      status: "retrieving",
      message: `Getting credentials for ${group}…`,
    });
    try {
      const options = await Promise.all(members.map((tab) => terminalPopoutOptions(tab)));
      await openConneCatSessionWindow(
        {
          kind: "terminal_group",
          options: options as unknown as Record<string, unknown>[],
          ptyIds: members.map((tab) => tab.ptyId),
        },
        `${group} (${members.length})`,
      );
      setSessionStatusPopup({
        tabId: members[0].id,
        status: "sent",
        message: `${group} opened in a new window.`,
      });
      members.forEach((tab) => release(tab.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPopoutError(message);
      setSessionStatusPopup({
        tabId: members[0].id,
        status: "error",
        message: "Could not open the session group window.",
      });
    } finally {
      members.forEach((tab) => popoutPendingIdsRef.current.delete(tab.id));
      setPopoutPendingIds(new Set(popoutPendingIdsRef.current));
    }
  };

  const startTerminalDrag = (event: React.DragEvent, tab: TerminalTab) => {
    const { respawn: _respawn, ...options } = tab.spawnOpts;
    const token = `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const payload: TerminalTransferPayload = {
      sourceWindowId: terminalWindowId,
      tabs: [{
        tabId: tab.id,
        options: options as unknown as Record<string, unknown>,
        ptyId: tab.ptyId,
      }],
    };
    localStorage.setItem(`${TERMINAL_TRANSFER_PREFIX}${token}`, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-catwalk-terminal-tab", token);
    event.dataTransfer.setData("text/plain", `catwalk-terminal:${token}`);
    window.setTimeout(() => localStorage.removeItem(`${TERMINAL_TRANSFER_PREFIX}${token}`), 60_000);
  };

  const startTerminalGroupDrag = (
    event: React.DragEvent,
    group: string,
    members: TerminalTab[],
  ) => {
    event.stopPropagation();
    clearPendingGroupClick();
    const token = `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    const payload: TerminalTransferPayload = {
      sourceWindowId: terminalWindowId,
      tabs: members.map((tab) => {
        const { respawn: _respawn, ...options } = tab.spawnOpts;
        return {
          tabId: tab.id,
          options: {
            ...options,
            group,
          } as unknown as Record<string, unknown>,
          ptyId: tab.ptyId,
        };
      }),
    };
    localStorage.setItem(`${TERMINAL_TRANSFER_PREFIX}${token}`, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-catwalk-terminal-tab", token);
    event.dataTransfer.setData("text/plain", `catwalk-terminal:${token}`);
    window.setTimeout(() => localStorage.removeItem(`${TERMINAL_TRANSFER_PREFIX}${token}`), 60_000);
  };

  const acceptTerminalDrop = async (
    event: { dataTransfer: DataTransfer; preventDefault: () => void },
    targetId?: number,
    placement: "before" | "after" = "before",
  ) => {
    const custom = event.dataTransfer.getData("application/x-catwalk-terminal-tab");
    const plain = event.dataTransfer.getData("text/plain");
    const token = custom || plain.match(/^catwalk-terminal:(.+)$/)?.[1] || "";
    if (!token) return;
    event.preventDefault();
    const releaseTransferClaim = claimTerminalTransfer(
      acceptingTransferTokensRef.current,
      token,
    );
    if (!releaseTransferClaim) return;
    const key = `${TERMINAL_TRANSFER_PREFIX}${token}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      let payload: TerminalTransferPayload;
      try {
        payload = JSON.parse(raw) as TerminalTransferPayload;
      } catch {
        return;
      }
      const entries = payload.tabs ?? [];
      if (entries.length === 0) return;
      const placeTabs = (ids: number[]) => {
        if (targetId == null) {
          ids.forEach((id) => reorderTab(id));
        } else if (placement === "after") {
          [...ids].reverse().forEach((id) => reorderTab(id, targetId, "after"));
        } else {
          ids.forEach((id) => reorderTab(id, targetId, "before"));
        }
      };
      if (payload.sourceWindowId === terminalWindowId) {
        placeTabs(entries.map((entry) => entry.tabId));
        localStorage.removeItem(key);
        return;
      }
      setPopoutError("");
      const openedIds: number[] = [];
      try {
        for (const entry of entries) {
          openedIds.push(await adopt(
            entry.options as unknown as Parameters<typeof open>[0],
            entry.ptyId,
          ));
        }
        placeTabs(openedIds);
        localStorage.removeItem(key);
        transferChannelRef.current?.postMessage({
          type: "accepted",
          sourceWindowId: payload.sourceWindowId,
          tabIds: entries.map((entry) => entry.tabId),
        });
        const ackKey = `${TERMINAL_TRANSFER_ACK_PREFIX}${token}`;
        localStorage.setItem(ackKey, JSON.stringify({
          type: "accepted",
          sourceWindowId: payload.sourceWindowId,
          tabIds: entries.map((entry) => entry.tabId),
        }));
        window.setTimeout(() => localStorage.removeItem(ackKey), 5_000);
      } catch (error) {
        openedIds.forEach((id) => release(id));
        setPopoutError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      releaseTransferClaim();
    }
  };

  useEffect(() => {
    const isTerminalTransfer = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("application/x-catwalk-terminal-tab");
    const onDragOver = (event: DragEvent) => {
      if (!isTerminalTransfer(event)) return;
      const target = event.target as HTMLElement | null;
      if (hasExplicitTerminalDropZone(target)) {
        setWindowDropActive(false);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setWindowDropActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget == null) setWindowDropActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!isTerminalTransfer(event)) return;
      setWindowDropActive(false);
      const target = event.target as HTMLElement | null;
      // Tab-strip handlers preserve exact before/after placement.
      if (hasExplicitTerminalDropZone(target)) return;
      event.preventDefault();
      void acceptTerminalDrop({
        dataTransfer: event.dataTransfer!,
        preventDefault: () => event.preventDefault(),
      });
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  });

  function renderTab(t: TerminalTab, workspaceId?: string) {
    const isSelectedWorkspace = workspaceId == null || workspaceId === activeSplitWorkspaceId;
    const isActive = t.id === activeId && isSelectedWorkspace;
    const isVisible = visibleIds.has(t.id) && isSelectedWorkspace;
    const isInSplit = splitMemberIds.size > 1 && splitMemberIds.has(t.id);
    const health = terminalSessionHealth(t, healthNow);
    return (
      <div
        key={t.id}
        ref={isSelectedWorkspace ? (el) => {
          if (el) tabPillRefs.current.set(t.id, el);
          else tabPillRefs.current.delete(t.id);
        } : undefined}
        className={
          "terminals-tab" +
          (isActive ? " active" : "") +
          (isVisible ? " visible" : "") +
          (t.exited ? " exited" : "") +
          (tabDropTarget?.id === t.id ? ` drop-${tabDropTarget.placement}` : "")
        }
        draggable
        onDragStart={(event) => {
          if (workspaceId) activateSplitWorkspace(workspaceId);
          startTerminalDrag(event, t);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          setTabDropTarget({
            id: t.id,
            placement: event.clientX >= rect.left + rect.width / 2 ? "after" : "before",
          });
        }}
        onDragLeave={() => setTabDropTarget((current) => current?.id === t.id ? null : current)}
        onDrop={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const placement = event.clientX >= rect.left + rect.width / 2 ? "after" : "before";
          setTabDropTarget(null);
          void acceptTerminalDrop(event, t.id, placement);
        }}
        onClick={() => {
          if (workspaceId) activateSplitWorkspace(workspaceId);
          setActive(t.id);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void reconnect(t.id);
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          void close(t.id);
        }}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTabMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
        }}
        title={`${t.title}: ${health.detail} Double-click to reconnect, middle-click to close, right-click for more.`}
        style={t.accent ? {
          borderBottom: `2px solid ${t.accent}`,
          boxShadow: `inset 3px 0 0 0 ${t.accent}`,
        } : undefined}
      >
        <span className={`terminals-health terminals-health--${health.state}`} title={health.detail} aria-label={`${t.title} ${health.label}`} />
        {isInSplit && <span className="terminals-tab-split-marker session-accent-icon" style={{ color: "var(--accent)" }} title="Visible in split layout" aria-label="Visible in split layout"><NotesIcon name="side-by-side" size={11} /></span>}
        <span className="terminals-tab-title">{t.title}</span>
        {health.state === "exited" && <button
          className="terminals-tab-close terminals-tab-reconnect"
          onClick={(e) => { e.stopPropagation(); void reconnect(t.id); }}
          title={`Reconnect ${t.title}`}
          aria-label={`Reconnect ${t.title}`}
        ><NotesIcon name="reconnect" size={14} /></button>}
        <SessionAccentButton
          className="terminals-tab-close terminals-tab-popout"
          disabled={popoutPendingIds.size > 0}
          onClick={(e) => {
            e.stopPropagation();
            void popOutTerminal(t);
          }}
          title={popoutPendingIds.size > 0 ? "Opening session window…" : "Open in external ConneCat window"}
          aria-label={`Open ${t.title} in external ConneCat window`}
        ><NotesIcon name="detach-window" size={14} /></SessionAccentButton>
        <button
          className="terminals-tab-close terminals-close-btn"
          onClick={(e) => { e.stopPropagation(); close(t.id); }}
          title="Close tab and kill process"
          aria-label={`Close ${t.title}`}
        ><NotesIcon name="cancel" size={14} /></button>
      </div>
    );
  }

  if (tabs.length === 0) {
    return (
      <div className={`terminals-shell workspace-page--${appearance.workspaceDesign}`}>
        {windowDropActive && (
          <div className="terminals-window-drop-overlay">
            Drop to add as the last tab
          </div>
        )}
        <TerminalsSidebar />
        <div
          className="terminals-empty"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => { void acceptTerminalDrop(event); }}
          onContextMenu={(e) => {
            setEmptyMenuPos(captureContextMenu(e));
          }}
        >
          <p>No terminal sessions open.</p>
          <p>
            Click <b>Connect SSH</b> on a device, or start a local shell:
          </p>
          <button type="button" className="btn-secondary outline-action-button" onClick={newLocalShell}>
            <NotesIcon name="local-shell" size={16} />
            New local shell
          </button>
        </div>
        {emptyMenuPos && (
          <ContextMenu
            position={emptyMenuPos}
            items={[
              { label: "New local shell", onClick: newLocalShell },
              { divider: true },
              { label: sessionWindow ? "Open Connections in main ConneCat" : "Go to Connections", onClick: () => sessionWindow ? void openInMainConneCat("/connections") : navigate("/connections") },
              { label: sessionWindow ? "Open Templates in main ConneCat" : "Go to Templates", onClick: () => sessionWindow ? void openInMainConneCat("/templates") : navigate("/templates") },
              { label: sessionWindow ? "Open Notes in main ConneCat" : "Go to Notes", onClick: () => sessionWindow ? void openInMainConneCat("/notes") : navigate("/notes") },
              { divider: true },
              { label: sessionWindow ? "Open Settings in main ConneCat" : "Settings", onClick: () => sessionWindow ? void openInMainConneCat("/settings") : navigate("/settings") },
            ]}
            onClose={() => setEmptyMenuPos(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`terminals-shell workspace-page--${appearance.workspaceDesign}`}>
      {windowDropActive && (
        <div className="terminals-window-drop-overlay">
          Drop to add as the last tab
        </div>
      )}
      <TerminalsSidebar />
      <div className="terminals-root">
      {sessionStatusPopup && (
        <div
          className={`terminals-password-popup terminals-password-popup--${sessionStatusPopup.status}`}
          role="status"
          aria-live="polite"
        >
          {sessionStatusPopup.status === "retrieving" && <span className="terminals-password-popup-spinner" aria-hidden="true" />}
          <span>{sessionStatusPopup.message}</span>
        </div>
      )}
      {popoutError && (
        <div style={{ color: "var(--danger, #ff6b6b)", fontSize: "0.85rem", padding: "4px 8px" }}>
          Could not open ConneCat session window: {popoutError}
        </div>
      )}
      <div
        className="terminals-tabs"
        onContextMenu={(event) => setToolbarMenuPos(captureContextMenu(event))}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setTabDropTarget(null);
        }}
        onDrop={(event) => {
          setTabDropTarget(null);
          void acceptTerminalDrop(event);
        }}
      >
        <div className="terminals-workspace-strip">
        {splitWorkspaceTabs.map((workspace) => (
          <div
            key={workspace.id}
            className="terminals-tab-group terminals-tab-group--split-workspace"
            title={`${workspace.name}. Drag tabs to reorder its panes.`}
            onClick={() => activateSplitWorkspace(workspace.id)}
          >
            <div
              className="terminals-tab-group-controls terminals-tab-group-controls--split-workspace"
              style={{ "--terminal-group-color": "var(--accent)" } as CSSProperties}
            >
              <span className="terminals-tab-group-label terminals-tab-group-label--split-workspace">
                <WorkspaceLayoutDropdown
                  workspace={workspace}
                  onArrange={(mode) => {
                    const ids = workspace.tabs.map((tab) => tab.id);
                    saveSplitWorkspace(
                      workspace.id,
                      arrangeTerminalWorkspace(ids, mode),
                      workspace.name,
                    );
                    setActive(activeId != null && ids.includes(activeId) ? activeId : ids[0]);
                  }}
                />
                {workspace.name} · {workspace.tabs.length}
              </span>
            </div>
            {workspace.tabs.map((tab) => renderTab(tab, workspace.id))}
          </div>
        ))}
        {orderedTabs.buckets.map((bucket, gi) => {
          const name = groupNames[gi];
          const visibleBucket = bucket.filter((tab) => !splitMemberIds.has(tab.id));
          if (visibleBucket.length === 0) return null;
          const color = colorForGroup(name);
          const isBroadcasting = broadcastGroups.has(name);
          return (
            <div
              key={`g:${name}`}
              className={`terminals-tab-group${isBroadcasting ? " broadcasting" : ""}`}
              style={{ borderBottom: `2px solid ${color}` }}
              title={`Group: ${name}${isBroadcasting ? "  \u2014 broadcasting to group" : ""}`}
            >
              <div
                className="terminals-tab-group-controls"
                style={{ "--terminal-group-color": color } as CSSProperties}
              >
                <button
                  type="button"
                  className="terminals-tab-group-label"
                  draggable
                  onDragStart={(event) => startTerminalGroupDrag(event, name, bucket)}
                  style={{ color }}
                  onClick={() => {
                    // Click on the group pill = arrange the group in a
                    // grid. Right-click for the full menu.
                    scheduleGroupArrange(name);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearPendingGroupClick();
                    runSessionGroupAction(name, appearance.sessionGroupDoubleClickAction);
                  }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    e.stopPropagation();
                    clearPendingGroupClick();
                    runSessionGroupAction(name, appearance.sessionGroupMiddleClickAction);
                  }}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearPendingGroupClick();
                    setTabMenu({ tabId: bucket[0].id, x: e.clientX, y: e.clientY, groupOnly: name });
                  }}
                  title={`${name} \u2014 click to arrange, double-click: ${sessionGroupActionLabel(appearance.sessionGroupDoubleClickAction)}, middle-click: ${sessionGroupActionLabel(appearance.sessionGroupMiddleClickAction)}`}
                >
                  {isBroadcasting && <NotesIcon name="broadcast" size={14} />}
                  <span>{name} ({visibleBucket.length})</span>
                </button>
                <SessionAccentButton
                  type="button"
                  className="terminals-tab-group-popout"
                  disabled={popoutPendingIds.size > 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    void popOutGroup(name);
                  }}
                  title={popoutPendingIds.size > 0
                    ? `Opening group ${name}…`
                    : `Open group ${name} in external ConneCat window`}
                  aria-label={`Open group ${name} in external ConneCat window`}
                >
                  <NotesIcon name="detach-window" size={15} />
                </SessionAccentButton>
              </div>
              {visibleBucket.map((t) => renderTab(t))}
            </div>
          );
        })}
        {orderedTabs.ungrouped.filter((tab) => !splitMemberIds.has(tab.id)).map((t) => renderTab(t))}
        </div>
        <div className="terminals-tabs-actions" role="toolbar" aria-label="Session workspace actions">
        <button type="button" className="terminals-tab-new" onClick={newLocalShell} title="New local shell" aria-label="New local shell">
          <NotesIcon name="add" size={15} color="var(--accent)" />
        </button>
        <SplitWorkspaceControls
          tabs={[...orderedTabs.buckets.flat(), ...orderedTabs.ungrouped]}
          activeId={activeId}
          workspaces={splitWorkspaces}
          activeWorkspaceId={activeSplitWorkspaceId}
          onActivate={activateSplitWorkspace}
          onApply={(workspaceId, mode, ids) => {
            const nextActiveId = activeId != null && ids.includes(activeId) ? activeId : ids[0];
            saveSplitWorkspace(workspaceId, arrangeTerminalWorkspace(ids, mode));
            setActive(nextActiveId);
          }}
          onDelete={deleteSplitWorkspace}
        />
        <SessionAccentButton
          type="button"
          className={`terminals-tab-broadcast-all${broadcastAll ? " active" : ""}${showToolbarText ? "" : " terminals-toolbar-icon-only"}`}
          onClick={toggleBroadcastAll}
          title={
            broadcastAll
              ? "Broadcasting to all \u2014 click to stop"
              : "Broadcast to all"
          }
          aria-label={broadcastAll ? "Stop broadcasting to all" : "Broadcast to all"}
          aria-pressed={broadcastAll}
        >
          <NotesIcon name="broadcast" size={16} />
          {showToolbarText && <span>Broadcast all</span>}
        </SessionAccentButton>
        <SessionAccentButton
          type="button"
          className={`terminals-tab-find${findOpen ? " active" : ""}${showToolbarText ? "" : " terminals-toolbar-icon-only"}`}
          onClick={() => { if (findOpen) closeFind(); else openFind(activeId ?? undefined); }}
          title="Find in active terminal (Ctrl/Cmd+F)"
          aria-label="Find in active terminal"
          aria-pressed={findOpen}
        >
          <NotesIcon name="find" size={16} />
          {showToolbarText && <span>Find</span>}
        </SessionAccentButton>
        <div ref={notesControlRef} className="terminals-tab-notes-split">
          <SessionAccentButton
            type="button"
            className={`terminals-tab-notes${showToolbarText ? "" : " terminals-toolbar-icon-only"}`}
            onClick={() => { if (activeId != null) captureTabToNotes(activeId); }}
            aria-label="Send selected output to Notes"
            title={notesSection
              ? `Send selected output to ${notesBook?.title ?? "Notes"} / ${notesSection.title}`
              : "Choose a Book and Section for terminal notes"}
          >
            <NotesIcon name="send-to-notes" size={16} />
            {showToolbarText && <span>Notes{notesSection ? ` · ${notesSection.title}` : ""}</span>}
          </SessionAccentButton>
          <SessionAccentButton
            type="button"
            className={`terminals-tab-notes-menu${notesMenuPos ? " active" : ""}`}
            aria-label="Choose Notes book and section"
            title="Choose Notes destination"
            onClick={() => {
              const rect = notesControlRef.current?.getBoundingClientRect();
              setNotesMenuPos(rect
                ? { x: rect.left, y: rect.bottom + 4, width: rect.width }
                : { x: 12, y: 12 });
            }}
          ><NotesIcon name="chevron-down" size={13} color="var(--accent)" /></SessionAccentButton>
        </div>
        {notesCaptureStatus && <span className="terminals-tab-notes-status" role="status">{notesCaptureStatus}</span>}
        </div>
      </div>

      {toolbarMenuPos && (
        <ContextMenu
          position={toolbarMenuPos}
          items={[
            {
              label: "Icons only",
              hint: showToolbarText ? undefined : "✓",
              onClick: () => setUserPrefs({ ...userPrefs, terminalToolbarDisplay: "icons" }),
            },
            {
              label: "Icons and text",
              hint: showToolbarText ? "✓" : undefined,
              onClick: () => setUserPrefs({ ...userPrefs, terminalToolbarDisplay: "iconsAndText" }),
            },
          ]}
          onClose={() => setToolbarMenuPos(null)}
        />
      )}

      {notesMenuPos && (
        <ContextMenu
          position={notesMenuPos}
          items={notesDestinations.length > 0
            ? notesDestinations.map((destination) => ({
                label: destination.book.title,
                icon: <NotesIcon name="notes" size={15} />,
                children: destination.sections.map((section) => ({
                  label: section.title,
                  icon: <NotesIcon name="choose" size={15} />,
                  hint: section.id === notesDestinationId ? "✓" : undefined,
                  onClick: () => rememberNotesSection(section.id),
                })),
              }))
            : [
                { label: "No Books with Sections", disabled: true },
                {
                  label: sessionWindow ? "Open Notes in main ConneCat" : "Open Notes page",
                  onClick: () => sessionWindow ? void openInMainConneCat("/notebooks") : navigate("/notebooks"),
                },
              ]}
          onClose={() => setNotesMenuPos(null)}
          variant="select"
        />
      )}

      {findOpen && (
        <div className="terminals-findbar" role="search">
          <span className="terminals-findbar-label">Find</span>
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runFind(e.shiftKey ? "previous" : "next");
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
            placeholder="Search terminal"
          />
          <button type="button" onClick={() => runFind("previous")} title="Previous match" aria-label="Previous match">
            <NotesIcon name="previous" size={16} />
          </button>
          <button type="button" onClick={() => runFind("next")} title="Next match" aria-label="Next match">
            <NotesIcon name="next" size={16} />
          </button>
          <button
            type="button"
            className={findCaseSensitive ? "active" : ""}
            onClick={() => setFindCaseSensitive((v) => !v)}
            aria-pressed={findCaseSensitive}
            aria-label="Match case"
            title="Match case"
          >
            <NotesIcon name="match-case" size={17} />
          </button>
          <span className="terminals-findbar-count">
            {findQuery
              ? findResult?.resultCount
                ? `${Math.max(0, findResult.resultIndex + 1)} / ${findResult.resultCount}`
                : "No matches"
              : ""}
          </span>
          <button type="button" onClick={closeFind} title="Close find" aria-label="Close find">
            <NotesIcon name="cancel" size={16} />
          </button>
        </div>
      )}

      {tabMenu && (() => {
        const tab = tabById.get(tabMenu.tabId);
        if (!tab) return null;
        const items: ContextMenuItem[] = [];
        // Template submenu builder. Closes the menu, opens the picker
        // targeting either a tab or a group. Reused by per-tab and
        // per-group flows so the indentation pattern stays consistent.
        const pushTemplates = (
          target: { kind: "tab"; id: number; title: string } | { kind: "group"; name: string },
        ) => {
          const templates = buildTemplateMenuItem({
            hint: target.kind === "group" ? target.name : undefined,
            userTemplates,
            onSelect: (template) => setPicker({ template, target }),
            onManage: () => setManagerOpen(true),
          });
          if (templates) items.push({ divider: true }, templates);
        };
        const pushNotebookCapture = (targetTab: TerminalTab) => {
          const selection = targetTab.terminal.getSelection();
          const destinations = notebookDestinations(loadNotebooks())
            .filter((destination) => destination.sections.length > 0);
          items.push({
            label: selection ? "Send selection to Notes" : "Send selection to Notes (no selection)",
            icon: <NotesIcon name="send-to-notes" size={16} />,
            disabled: !selection || destinations.length === 0,
            children: destinations.map((destination) => ({
              label: destination.book.title,
              children: destination.sections.map((section) => ({
                label: section.title,
                onClick: () => { captureTerminalSelection(section.id, targetTab.title, selection); },
              })),
            })),
          });
        };
        // Group-only menu: opened by right-clicking the group pill. Show
        // arrange options for the whole group and a "Ungroup all" entry.
        if (tabMenu.groupOnly) {
          const g = tabMenu.groupOnly;
          items.push({ label: `Group "${g}"`, disabled: true });
          items.push({ divider: true });
          const broadcasting = broadcastGroups.has(g);
          items.push({
            label: broadcasting ? "Stop broadcasting to group" : "Broadcast to group",
            icon: <NotesIcon name="broadcast" size={16} />,
            onClick: () => toggleGroupBroadcast(g),
          });
          items.push({
            label: broadcastAll
              ? "Stop broadcasting to all"
              : "Broadcast to all",
            icon: <NotesIcon name="broadcast" size={16} />,
            onClick: toggleBroadcastAll,
          });
          items.push({ divider: true });
          items.push({ label: "   Arrange:", disabled: true });
          items.push({ label: "      As tabs only", onClick: () => arrangeGroup(g, "tabs") });
          items.push({ label: "      Side by side", onClick: () => arrangeGroup(g, "row") });
          items.push({ label: "      Stacked", onClick: () => arrangeGroup(g, "column") });
          items.push({ label: "      Grid", onClick: () => arrangeGroup(g, "grid") });
          items.push({ divider: true });
          items.push({
            label: "Open group in external ConneCat window",
            disabled: popoutPendingIds.size > 0,
            onClick: () => { void popOutGroup(g); },
          });
          items.push({ divider: true });
          items.push({
            label: "Remove all from group",
            onClick: () => {
              for (const t of tabs) if (t.group === g) setTabGroup(t.id, undefined);
            },
          });
          items.push({
            label: "Close all tabs in group",
            onClick: () => {
              for (const t of tabs) if (t.group === g) void close(t.id);
            },
          });
          pushTemplates({ kind: "group", name: g });
        } else {
          // Per-tab menu.
          items.push({ label: "Reconnect", hint: "double-click", onClick: () => { void reconnect(tabMenu.tabId); } });
          items.push({ label: "Duplicate session", onClick: () => { void duplicate(tabMenu.tabId); } });
          items.push({ label: "Find", icon: <NotesIcon name="find" size={16} />, hint: "Ctrl+F", onClick: () => openFind(tabMenu.tabId) });
          items.push({
            label: "Select all terminal output",
            hint: "Ctrl+A",
            onClick: () => tab.terminal.selectAll(),
          });
          pushNotebookCapture(tab);
          items.push({ label: "Close tab", hint: "middle-click", onClick: () => { void close(tabMenu.tabId); } });
          items.push({ divider: true });
          items.push({
            label: broadcastAll
              ? "Stop broadcasting to all"
              : "Broadcast to all",
            icon: <NotesIcon name="broadcast" size={16} />,
            onClick: toggleBroadcastAll,
          });
          items.push({ divider: true });
          items.push({ label: tab.group ? `Group: ${tab.group}` : "Group: (none)", disabled: true });
          items.push({
            label: "   New group\u2026",
            onClick: () => {
              setGroupRenameText(tab.group ?? "");
              setGroupRenamePrompt({ tabId: tabMenu.tabId, initial: tab.group ?? "" });
            },
          });
          for (const g of groupNames) {
            if (g === tab.group) continue;
            items.push({ label: `   ${g}`, onClick: () => setTabGroup(tabMenu.tabId, g) });
          }
          if (tab.group) {
            items.push({ label: "   (remove from group)", onClick: () => setTabGroup(tabMenu.tabId, undefined) });
            items.push({ divider: true });
            items.push({ label: `Arrange group "${tab.group}":`, disabled: true });
            items.push({ label: "   As tabs only", onClick: () => arrangeGroup(tab.group!, "tabs") });
            items.push({ label: "   Side by side", onClick: () => arrangeGroup(tab.group!, "row") });
            items.push({ label: "   Stacked", onClick: () => arrangeGroup(tab.group!, "column") });
            items.push({ label: "   Grid", onClick: () => arrangeGroup(tab.group!, "grid") });
          }
          pushTemplates({ kind: "tab", id: tabMenu.tabId, title: tab.title });
        }
        return (
          <ContextMenu
            position={{ x: tabMenu.x, y: tabMenu.y }}
            items={items}
            onClose={() => setTabMenu(null)}
          />
        );
      })()}

      <div className="terminals-mosaic">
        {layout != null ? (
          <Mosaic<number>
            className="mosaic-catwalk"
            value={layout}
            onChange={setLayout}
            renderTile={(id, path) => {
              const tab = tabById.get(id);
              if (!tab) return <div />;
              const terminal = (
                <div
                  className={`terminals-tile-wrap${id === activeId ? " active" : ""}`}
                  onMouseDownCapture={() => {
                    if (id !== activeId) setActive(id);
                  }}
                >
                  <TerminalHost
                    tab={tab}
                    tabs={tabs}
                    isActive={id === activeId}
                    renderer={terminalRenderer}
                  />
                </div>
              );
              if (visibleIds.size <= 1) return terminal;
              return (
                <MosaicWindow<number>
                  path={path}
                  title={tab.title}
                  className={`terminals-pane-window${id === activeId ? " active" : ""}`}
                  draggable
                  onDragStart={() => setActive(id)}
                  renderToolbar={() => (
                    <div
                      className="mosaic-window-title terminals-pane-title"
                      title={tab.title}
                      onMouseDown={() => setActive(id)}
                    >
                      {tab.title}
                    </div>
                  )}
                >
                  {terminal}
                </MosaicWindow>
              );
            }}
          />
        ) : (
          <div className="terminals-empty">
            <p>No panes visible. Click a tab above to bring it into view.</p>
          </div>
        )}
      </div>
      {picker && (
        <TemplatePicker
          template={picker.template}
          targetLabel={picker.target.kind === "tab"
            ? `Tab \u201C${picker.target.title}\u201D`
            : `Group \u201C${picker.target.name}\u201D (broadcast)`}
          onCancel={() => setPicker(null)}
          onSend={async (rendered, delay) => {
            const t = picker.target;
            setPicker(null);
            try {
              if (t.kind === "tab") await sendText(t.id, rendered, delay);
              else await broadcastTextToGroup(t.name, rendered, delay);
            } catch {
              // Errors here are swallowed \u2014 pty_write itself only fails
              // on transport-level issues which already surface via the
              // terminal's [process exited] banner.
            }
          }}
        />
      )}
      {managerOpen && (
        <TemplatesManager
          onClose={() => setManagerOpen(false)}
          onChange={() => setUserTplVersion((n) => n + 1)}
        />
      )}
      {paneMenu && (() => {
        const tab = tabById.get(paneMenu.tabId);
        if (!tab) return null;
        const term = tab.terminal;
        const selection = term.getSelection();
        const target = { kind: "tab" as const, id: tab.id, title: tab.title };
        const items: ContextMenuItem[] = [];
        items.push({
          label: selection ? "Copy" : "Copy (no selection)",
          disabled: !selection,
          onClick: () => { clipWriteText(selection).catch(() => {}); },
        });
        items.push({
          label: "Paste",
          onClick: () => {
            clipReadText().then((text) => {
              const plainText = normalizeConsoleText(text);
              if (!plainText) return;
              const enc = new TextEncoder().encode(plainText);
              invoke("pty_write", { id: tab.id, data: Array.from(enc) }).catch(() => {});
            }).catch(() => {});
          },
        });
        items.push({ divider: true });
        items.push({ label: "Select all terminal output", hint: "Ctrl+A", onClick: () => term.selectAll() });
        items.push({
          label: "Clear scrollback",
          onClick: () => {
            term.clear();
            // Also redraw a fresh prompt by sending Ctrl+L equivalent.
            // Skipped: term.clear() already wipes the buffer; sending
            // form-feed could disturb full-screen apps (vim/less).
          },
        });
        items.push({ label: "Find", icon: <NotesIcon name="find" size={16} />, hint: "Ctrl+F", onClick: () => openFind(tab.id) });
        const notebookTargets = notebookDestinations(loadNotebooks());
        items.push({
          label: selection ? "Send selection to Notes" : "Send selection to Notes (no selection)",
          icon: <NotesIcon name="send-to-notes" size={16} />,
          disabled: !selection || notebookTargets.every((destination) => destination.sections.length === 0),
          children: notebookTargets
            .filter((destination) => destination.sections.length > 0)
            .map((destination) => ({
              label: destination.book.title,
              children: destination.sections.map((section) => ({
                label: section.title,
                onClick: () => { captureTerminalSelection(section.id, tab.title, selection); },
              })),
            })),
          onClick: notebookTargets.length === 0
            ? () => sessionWindow ? void openInMainConneCat("/notebooks") : navigate("/notebooks")
            : undefined,
        });
        // Templates submenu — mirrors the tab-strip menu so the user
        // can fire any built-in or user template directly into this
        // pane. Variable-bearing templates open the picker; literal
        // ones still go through the picker for consistency (it shows
        // a single Send button when there are no variables).
        const templates = buildTemplateMenuItem({
          label: "Insert template",
          userTemplates,
          onSelect: (template) => setPicker({ template, target }),
          onManage: () => setManagerOpen(true),
        });
        if (templates) items.push({ divider: true }, templates);
        items.push({ divider: true });
        items.push({
          label: sessionWindow ? "Open Templates in main ConneCat" : "Open Templates page",
          onClick: () => sessionWindow ? void openInMainConneCat("/templates") : navigate("/templates"),
        });
        items.push({
          label: sessionWindow ? "Open Notes in main ConneCat" : "Open Notes page",
          onClick: () => sessionWindow ? void openInMainConneCat("/notebooks") : navigate("/notebooks"),
        });
        items.push({
          label: sessionWindow ? "Open Settings in main ConneCat" : "Settings\u2026",
          onClick: () => sessionWindow ? void openInMainConneCat("/settings") : navigate("/settings"),
        });
        return (
          <ContextMenu
            position={paneMenu.pos}
            items={items}
            onClose={() => setPaneMenu(null)}
          />
        );
      })()}
      {groupRenamePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Set tab group"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setGroupRenamePrompt(null); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = groupRenameText.trim();
              setTabGroup(groupRenamePrompt.tabId, t || undefined);
              setGroupRenamePrompt(null);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 6,
              padding: 16, minWidth: 320, maxWidth: "92vw",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              display: "flex", flexDirection: "column", gap: 10,
            }}
          >
            <label style={{ fontSize: 13, fontWeight: 600 }}>Group name</label>
            <input
              type="text"
              autoFocus
              value={groupRenameText}
              onChange={(e) => setGroupRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); setGroupRenamePrompt(null); }
              }}
              placeholder="Leave blank to remove from group"
              style={{
                background: "var(--input-bg)", color: "var(--fg)",
                border: "1px solid var(--border)", borderRadius: 3,
                padding: "6px 8px", fontSize: 13,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setGroupRenamePrompt(null)}
                style={{
                  background: "var(--input-bg)", color: "var(--fg)",
                  border: "1px solid var(--border)", borderRadius: 3,
                  padding: "5px 14px", fontSize: 12, cursor: "pointer",
                }}
              >Cancel</button>
              <button
                type="submit"
                style={{
                  background: "var(--accent)", color: "#000", borderColor: "var(--accent)",
                  border: "1px solid", borderRadius: 3, fontWeight: 600,
                  padding: "5px 14px", fontSize: 12, cursor: "pointer",
                }}
              >{groupRenamePrompt.initial ? "Rename" : "Create"}</button>
            </div>
          </form>
        </div>
      )}
      </div>
    </div>
  );
}

interface TabSplitControlsProps {
  availableTabs: TerminalTab[];
  selectedTabIds: number[];
  splitActive: boolean;
  onArrange: (mode: TerminalWorkspaceArrange, additionalIds?: number[]) => void;
  onUnsplit: () => void;
  onRemovePane: () => void;
}

interface GroupSplitControlsProps {
  groupName: string;
  tabs: TerminalTab[];
  splitMemberIds: ReadonlySet<number>;
  onApply: (mode: TerminalWorkspaceArrange, ids: number[]) => void;
  onUnsplit: () => void;
}

function GroupSplitControls({ groupName, tabs, splitMemberIds, onApply, onUnsplit }: GroupSplitControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [arrangement, setArrangement] = useState<TerminalWorkspaceArrange>("grid");
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(() => new Set());
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const memberIdsKey = tabs.map((tab) => tab.id).join(",");
  const splitIdsKey = tabs.filter((tab) => splitMemberIds.has(tab.id)).map((tab) => tab.id).join(",");

  const positionMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 156;
    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      top: rect.bottom + 4,
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const selectedMembers = tabs.filter((tab) => splitMemberIds.has(tab.id)).map((tab) => tab.id);
    setSelectedTabIds(new Set(selectedMembers.length > 0 ? selectedMembers : tabs.map((tab) => tab.id)));
    positionMenu();
  }, [menuOpen, memberIdsKey, splitIdsKey, positionMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeIfOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen, positionMenu]);

  const toggleTab = (id: number) => setSelectedTabIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectedIds = tabs.filter((tab) => selectedTabIds.has(tab.id)).map((tab) => tab.id);
  const appliedIds = tabs.filter((tab) => splitMemberIds.has(tab.id)).map((tab) => tab.id);
  const groupIsSplit = appliedIds.length > 0;
  const membershipChanged = appliedIds.length !== selectedIds.length
    || appliedIds.some((id) => !selectedTabIds.has(id));
  const chooseArrangement = (next: TerminalWorkspaceArrange) => {
    setArrangement(next);
    const layoutIds = appliedIds.length > 0
      ? appliedIds
      : selectedIds.length > 0
        ? selectedIds
        : tabs.map((tab) => tab.id);
    if (layoutIds.length > 0) onApply(next, layoutIds);
  };

  return (
    <>
      <SessionAccentButton
        ref={buttonRef}
        type="button"
        className={`terminals-tab-group-split${menuOpen || groupIsSplit ? " active" : ""}`}
        title={`Configure split layout for ${groupName}`}
        aria-label={`Configure split layout for ${groupName}`}
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
      >
        <NotesIcon name="side-by-side" size={14} />
        <NotesIcon name="chevron-down" size={10} />
      </SessionAccentButton>
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="terminals-pane-menu terminals-group-split-menu"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          role="dialog"
          aria-label={`${groupName} split layout`}
        >
          <div className="terminals-pane-menu-label terminals-pane-menu-label--layout">Split layout</div>
          <div className="terminals-pane-direction" role="group" aria-label={`${groupName} workspace layout`}>
            <button type="button" className={arrangement === "row" ? "active" : ""} aria-label="Side by side" title="Side by side" aria-pressed={arrangement === "row"} onClick={() => chooseArrangement("row")}>
              <NotesIcon name="side-by-side" size={15} />
            </button>
            <button type="button" className={arrangement === "column" ? "active" : ""} aria-label="Stacked" title="Stacked" aria-pressed={arrangement === "column"} onClick={() => chooseArrangement("column")}>
              <NotesIcon name="stacked" size={15} />
            </button>
            <button type="button" className={arrangement === "grid" ? "active" : ""} aria-label="Grid" title="Grid" aria-pressed={arrangement === "grid"} onClick={() => chooseArrangement("grid")}>
              <NotesIcon name="grid" size={15} />
            </button>
          </div>
          {groupIsSplit && (
            <div className="terminals-pane-unsplit-actions">
              <button
                type="button"
                className="terminals-pane-unsplit"
                onClick={() => {
                  onUnsplit();
                  setMenuOpen(false);
                }}
              >
                <NotesIcon name="cancel" size={15} /> Unsplit all
              </button>
            </div>
          )}
          <div className="terminals-pane-menu-label terminals-pane-menu-label--sessions">Tabs in group</div>
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={`terminals-pane-menu-item${selectedTabIds.has(tab.id) ? " selected" : ""}`}
              aria-pressed={selectedTabIds.has(tab.id)}
              onClick={() => toggleTab(tab.id)}
            >
              <span className="terminals-pane-menu-check" aria-hidden>{selectedTabIds.has(tab.id) ? "✓" : ""}</span>
              <span>{tab.title}</span>
            </button>
          ))}
          <button
            type="button"
            className="terminals-pane-apply"
            disabled={selectedIds.length === 0 || !membershipChanged}
            onClick={() => {
              onApply(arrangement, selectedIds);
              setMenuOpen(false);
            }}
          >
            Apply sessions{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function TabSplitControls({ availableTabs, selectedTabIds: appliedTabIds, splitActive, onArrange, onUnsplit, onRemovePane }: TabSplitControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [arrangement, setArrangement] = useState<TerminalWorkspaceArrange>("row");
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(() => new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const availableTabIdsKey = availableTabs.map((tab) => tab.id).join(",");

  const positionMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 176;
    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      top: rect.bottom + 4,
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen, positionMenu]);

  useEffect(() => {
    const available = new Set(
      availableTabIdsKey.split(",").filter(Boolean).map((id) => Number(id)),
    );
    setSelectedTabIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
    });
  }, [availableTabIdsKey]);

  const disabled = availableTabs.length === 0 && !splitActive;
  const toggleTab = (id: number) => setSelectedTabIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const applySplit = () => {
    const additionalIds = availableTabs
      .filter((tab) => selectedTabIds.has(tab.id))
      .map((tab) => tab.id);
    onArrange(arrangement, additionalIds);
    setMenuOpen(false);
  };
  const chooseArrangement = (next: TerminalWorkspaceArrange) => {
    setArrangement(next);
    if (splitActive && selectedTabIds.size > 0) onArrange(next, [...selectedTabIds]);
  };

  return (
    <div className="terminals-pane-controls" ref={rootRef}>
      <SessionAccentButton
        ref={buttonRef}
        className={`terminals-pane-toolbtn terminals-pane-layout-btn${menuOpen ? " active" : ""}`}
        title={disabled ? "No other sessions available for a split" : splitActive ? "Change or cancel the split layout" : "Arrange sessions in split panes"}
        aria-label="Arrange split panes"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => {
            if (!open) {
              const initial = appliedTabIds.filter((id) => availableTabs.some((tab) => tab.id === id));
              setSelectedTabIds(new Set(initial.length > 0 ? initial : availableTabs[0] ? [availableTabs[0].id] : []));
              positionMenu();
            }
            return !open;
          });
        }}
        disabled={disabled}
      ><NotesIcon name="side-by-side" size={15} /><NotesIcon name="chevron-down" size={11} /></SessionAccentButton>
      {menuOpen && (availableTabs.length > 0 || splitActive) && createPortal(
        <div
          ref={menuRef}
          className="terminals-pane-menu terminals-group-split-menu"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="terminals-pane-menu-label terminals-pane-menu-label--layout">Split layout</div>
          <div className="terminals-pane-direction" role="group" aria-label="Workspace layout">
            <button type="button" className={arrangement === "row" ? "active" : ""} aria-label="Side by side" title="Side by side" aria-pressed={arrangement === "row"} onClick={() => chooseArrangement("row")}>
              <NotesIcon name="side-by-side" size={15} />
            </button>
            <button type="button" className={arrangement === "column" ? "active" : ""} aria-label="Stacked" title="Stacked" aria-pressed={arrangement === "column"} onClick={() => chooseArrangement("column")}>
              <NotesIcon name="stacked" size={15} />
            </button>
            <button type="button" className={arrangement === "grid" ? "active" : ""} aria-label="Grid" title="Grid" aria-pressed={arrangement === "grid"} onClick={() => chooseArrangement("grid")}>
              <NotesIcon name="grid" size={15} />
            </button>
          </div>
          {splitActive && <div className="terminals-pane-unsplit-actions">
            <button type="button" className="terminals-pane-unsplit" onClick={() => { onRemovePane(); setMenuOpen(false); }}>
              <NotesIcon name="remove" size={15} /> Remove pane
            </button>
            <button type="button" className="terminals-pane-unsplit" onClick={() => { onUnsplit(); setMenuOpen(false); }}>
              <NotesIcon name="cancel" size={15} /> Unsplit all
            </button>
          </div>}
          {availableTabs.length > 0 && <>
            <div className="terminals-pane-menu-label terminals-pane-menu-label--sessions">Sessions</div>
            {availableTabs.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`terminals-pane-menu-item${selectedTabIds.has(t.id) ? " selected" : ""}`}
                aria-pressed={selectedTabIds.has(t.id)}
                onClick={() => toggleTab(t.id)}
              >
                <span className="terminals-pane-menu-check" aria-hidden>{selectedTabIds.has(t.id) ? "✓" : ""}</span>
                <span>{t.title}</span>
              </button>
            ))}
            <button type="button" className="terminals-pane-apply" disabled={selectedTabIds.size === 0} onClick={applySplit}>
              Apply split{selectedTabIds.size > 1 ? ` (${selectedTabIds.size})` : ""}
            </button>
          </>}
        </div>,
        document.body,
      )}
    </div>
  );
}

interface SplitWorkspaceControlsProps {
  tabs: TerminalTab[];
  activeId: number | null;
  workspaces: TerminalSplitWorkspace[];
  activeWorkspaceId: string | null;
  onActivate: (id: string) => void;
  onApply: (workspaceId: string | null, mode: TerminalWorkspaceArrange, ids: number[]) => void;
  onDelete: (id: string) => void;
}

interface WorkspaceLayoutDropdownProps {
  workspace: TerminalSplitWorkspace;
  onArrange: (mode: TerminalWorkspaceArrange) => void;
}

function WorkspaceLayoutDropdown({ workspace, onArrange }: WorkspaceLayoutDropdownProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const current = inferredWorkspaceArrangement(workspace.layout);

  const positionMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 168;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 132)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const closeIfOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  const choose = (mode: TerminalWorkspaceArrange) => {
    onArrange(mode);
    setOpen(false);
  };
  const options: Array<{ mode: TerminalWorkspaceArrange; label: string; icon: "side-by-side" | "stacked" | "grid" }> = [
    { mode: "row", label: "Side by side", icon: "side-by-side" },
    { mode: "column", label: "Stacked", icon: "stacked" },
    { mode: "grid", label: "Grid", icon: "grid" },
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`terminals-workspace-layout-trigger${open ? " open" : ""}`}
        aria-label={`Change layout for ${workspace.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Change ${workspace.name} layout`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <NotesIcon name={options.find((option) => option.mode === current)?.icon ?? "grid"} size={14} />
        <NotesIcon name="chevron-down" size={9} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="terminals-pane-menu terminals-workspace-layout-menu"
          style={{ left: position.left, top: position.top }}
          role="menu"
          aria-label={`${workspace.name} layout`}
          onClick={(event) => event.stopPropagation()}
        >
          {options.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={current === option.mode}
              className={current === option.mode ? "active" : ""}
              onClick={() => choose(option.mode)}
            >
              <NotesIcon name={option.icon} size={15} />
              <span>{option.label}</span>
              {current === option.mode && <span className="terminals-workspace-layout-check" aria-hidden>✓</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function inferredWorkspaceArrangement(layout: MosaicNode<number> | null): TerminalWorkspaceArrange {
  if (layout == null || typeof layout !== "object" || !("direction" in layout)) return "grid";
  if (layout.direction === "column") return "column";
  const hasStackedColumn = [layout.first, layout.second].some((child) => (
    typeof child === "object" && child != null && "direction" in child && child.direction === "column"
  ));
  return hasStackedColumn ? "grid" : "row";
}

function SplitWorkspaceControls({ tabs, activeId, workspaces, activeWorkspaceId, onActivate, onApply, onDelete }: SplitWorkspaceControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [arrangement, setArrangement] = useState<TerminalWorkspaceArrange>("grid");
  const [selectedTabIds, setSelectedTabIds] = useState<Set<number>>(() => new Set());
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const editingWorkspace = workspaces.find((workspace) => workspace.id === editingWorkspaceId) ?? null;
  const appliedIds = terminalWorkspaceIds(editingWorkspace?.layout ?? null).filter((id) => tabs.some((tab) => tab.id === id));
  const splitActive = workspaces.length > 0;
  const tabIdsKey = tabs.map((tab) => tab.id).join(",");
  const workspacesKey = workspaces.map((workspace) => `${workspace.id}:${terminalWorkspaceIds(workspace.layout).join(".")}`).join(",");

  const positionMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 228;
    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8)),
      top: Math.min(rect.bottom + 4, window.innerHeight - 80),
    });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    setEditing(false);
    setEditingWorkspaceId(null);
    setSelectedTabIds(new Set());
    positionMenu();
  // Reset the draft whenever the menu is reopened or workspace membership changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, tabIdsKey, workspacesKey, positionMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeIfOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen, positionMenu]);

  const beginSplit = () => {
    const firstId = activeId != null && tabs.some((tab) => tab.id === activeId)
      ? activeId
      : tabs[0]?.id;
    setSelectedTabIds(new Set(firstId == null ? [] : [firstId]));
    setArrangement("row");
    setEditingWorkspaceId(null);
    setEditing(true);
  };
  const editWorkspace = (workspace: TerminalSplitWorkspace) => {
    onActivate(workspace.id);
    setEditingWorkspaceId(workspace.id);
    setSelectedTabIds(new Set(terminalWorkspaceIds(workspace.layout)));
    setArrangement(inferredWorkspaceArrangement(workspace.layout));
    setEditing(true);
  };
  const selectedIds = tabs.filter((tab) => selectedTabIds.has(tab.id)).map((tab) => tab.id);
  const chooseArrangement = (nextArrangement: TerminalWorkspaceArrange) => {
    setArrangement(nextArrangement);
    // Existing workspace layout buttons are a live preview/apply control.
    // Keep the explicit Update action for membership edits and the Create
    // action for drafts that do not have a workspace id yet.
    if (editingWorkspaceId && selectedIds.length >= 2) {
      onApply(editingWorkspaceId, nextArrangement, selectedIds);
    }
  };
  const toggleTab = (id: number) => setSelectedTabIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <>
      <SessionAccentButton
        ref={buttonRef}
        type="button"
        className={`terminals-tab-split-workspace${menuOpen || splitActive ? " active" : ""}`}
        title={splitActive ? `Split workspaces (${workspaces.length})` : "Split workspaces"}
        aria-label="Split workspaces"
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        disabled={tabs.length < 2 && !splitActive}
      >
        <NotesIcon name="side-by-side" size={15} />
        <NotesIcon name="chevron-down" size={10} />
        {splitActive && <span className="terminals-split-count" aria-hidden>{workspaces.length}</span>}
      </SessionAccentButton>
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="terminals-pane-menu terminals-group-split-menu terminals-workspace-split-menu"
          style={{ left: menuPosition.left, top: menuPosition.top }}
          role="dialog"
          aria-label="Split workspace"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="terminals-split-menu-heading">
            <span><NotesIcon name="side-by-side" size={15} /> Split workspaces</span>
            {splitActive && <small>{workspaces.length}</small>}
          </div>
          {!editing ? (
            <>
              <button type="button" className="terminals-new-split" onClick={beginSplit}>
                <NotesIcon name="add" size={15} />
                <span><strong>New split</strong><small>Choose tabs and a layout</small></span>
              </button>
              {workspaces.length > 0 && <div className="terminals-pane-menu-label terminals-pane-menu-label--sessions">Workspaces</div>}
              {workspaces.map((workspace) => (
                <button
                  type="button"
                  key={workspace.id}
                  className={`terminals-workspace-menu-item${workspace.id === activeWorkspaceId ? " active" : ""}`}
                  onClick={() => editWorkspace(workspace)}
                >
                  <NotesIcon name="side-by-side" size={14} />
                  <span>{workspace.name}<small>{terminalWorkspaceIds(workspace.layout).length} tabs</small></span>
                  <NotesIcon name="next" size={12} />
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="terminals-pane-menu-label terminals-pane-menu-label--layout">Layout</div>
              <div className="terminals-pane-direction" role="group" aria-label="Split workspace layout">
                <button type="button" className={arrangement === "row" ? "active" : ""} aria-label="Side by side" title="Side by side" aria-pressed={arrangement === "row"} onClick={() => chooseArrangement("row")}>
                  <NotesIcon name="side-by-side" size={15} />
                </button>
                <button type="button" className={arrangement === "column" ? "active" : ""} aria-label="Stacked" title="Stacked" aria-pressed={arrangement === "column"} onClick={() => chooseArrangement("column")}>
                  <NotesIcon name="stacked" size={15} />
                </button>
                <button type="button" className={arrangement === "grid" ? "active" : ""} aria-label="Grid" title="Grid" aria-pressed={arrangement === "grid"} onClick={() => chooseArrangement("grid")}>
                  <NotesIcon name="grid" size={15} />
                </button>
              </div>
              <div className="terminals-pane-menu-label terminals-pane-menu-label--sessions">Tabs in workspace</div>
              <div className="terminals-split-tab-list">
                {tabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    className={`terminals-pane-menu-item${selectedTabIds.has(tab.id) ? " selected" : ""}`}
                    aria-pressed={selectedTabIds.has(tab.id)}
                    title={tab.title}
                    onClick={() => toggleTab(tab.id)}
                  >
                    <span className="terminals-pane-menu-check" aria-hidden>{selectedTabIds.has(tab.id) ? "✓" : ""}</span>
                    <span>{tab.title}</span>
                  </button>
                ))}
              </div>
              {selectedIds.length < 2 && <div className="terminals-split-hint">Select at least two tabs.</div>}
              <div className="terminals-split-actions">
                {editingWorkspaceId && (
                  <button type="button" className="terminals-pane-unsplit" onClick={() => { onDelete(editingWorkspaceId); setEditing(false); setEditingWorkspaceId(null); }}>
                    <NotesIcon name="cancel" size={14} /> Delete
                  </button>
                )}
                <button
                  type="button"
                  className="terminals-pane-apply"
                  disabled={selectedIds.length < 2}
                  onClick={() => {
                    onApply(editingWorkspaceId, arrangement, selectedIds);
                    setMenuOpen(false);
                  }}
                >
                  {editingWorkspaceId ? "Update split" : "Create split"}{selectedIds.length > 1 ? ` (${selectedIds.length})` : ""}
                </button>
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

interface HostProps {
  tab: TerminalTab;
  tabs: TerminalTab[];
  isActive: boolean;
  renderer: ResolvedTerminalRenderer;
}

const MAX_RETAINED_WEBGL_RENDERERS = 2;
const WEBGL_REUSE_WINDOW_MS = 30_000;
let webglUseSequence = 0;

function fitVisibleTerminal(tab: TerminalTab, pane: HTMLDivElement): boolean {
  if (!pane.isConnected) return false;
  const rect = pane.getBoundingClientRect();
  if (!isUsableTerminalGeometry(rect.width, rect.height)) return false;
  try {
    // FitAddon measures the xterm element's parent. Give that persistent
    // host explicit pixel dimensions so WebKit cannot leave it resolved to
    // the 100-column size used before the pane was attached.
    const style = window.getComputedStyle(pane);
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const width = Math.max(0, pane.clientWidth - horizontalPadding);
    const height = Math.max(0, pane.clientHeight - verticalPadding);
    tab.host.style.width = `${Math.floor(width)}px`;
    tab.host.style.height = `${Math.floor(height)}px`;

    const dimensions = tab.fit.proposeDimensions();
    if (!dimensions || !isUsableTerminalGrid(dimensions.cols, dimensions.rows)) return false;
    if (tab.terminal.cols !== dimensions.cols || tab.terminal.rows !== dimensions.rows) {
      tab.terminal.resize(dimensions.cols, dimensions.rows);
    }
    tab.terminal.refresh(0, dimensions.rows - 1);
    return true;
  } catch {
    return false;
  }
}

function attachWebglAddon(tab: TerminalTab, tabs: readonly TerminalTab[]) {
  if (tab.webglDetachTimer != null) {
    window.clearTimeout(tab.webglDetachTimer);
    tab.webglDetachTimer = null;
  }
  tab.webglLastUsedAt = ++webglUseSequence;
  if (tab.webglAddon) return;

  const retained = tabs
    .filter((candidate) => candidate !== tab && candidate.webglAddon)
    .sort((left, right) => left.webglLastUsedAt - right.webglLastUsedAt);
  while (retained.length >= MAX_RETAINED_WEBGL_RENDERERS) {
    const evicted = retained.shift();
    if (evicted) detachWebglAddon(evicted, false);
  }
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => {
      if (tab.webglAddon !== addon) return;
      try { addon.dispose(); } catch {}
      tab.webglAddon = null;
      try { tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1)); } catch {}
    });
    tab.terminal.loadAddon(addon);
    tab.webglAddon = addon;
    tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1));
  } catch {
    // Falls back to xterm's default DOM renderer if WebGL2 is unavailable or
    // WebKit refuses the GPU context.
  }
}

function scheduleWebglDetach(tab: TerminalTab) {
  if (!tab.webglAddon) return;
  if (tab.webglDetachTimer != null) return;
  // Keep recently used GPU state long enough for normal tab switching while
  // still releasing it when the user leaves a terminal in the background.
  tab.webglDetachTimer = window.setTimeout(() => {
    tab.webglDetachTimer = null;
    detachWebglAddon(tab, false);
  }, WEBGL_REUSE_WINDOW_MS);
}

function detachWebglAddon(tab: TerminalTab, refreshFallback = true) {
  if (tab.webglDetachTimer != null) {
    window.clearTimeout(tab.webglDetachTimer);
    tab.webglDetachTimer = null;
  }
  if (!tab.webglAddon) return;
  const canvases = captureCanvasBackingStores(tab.host);
  const backingPixels = canvasBackingStorePixels(canvases);
  disposeWebglAddonAndContext(tab.webglAddon);
  tab.webglAddon = null;
  releaseCanvasBackingStores(canvases, true);
  diagnosticEvent("ssh_tunnel", "debug", "catwalk.terminal-memory", "Inactive terminal WebGL backing stores released", {
    tab_id: tab.id,
    canvas_count: canvases.length,
    backing_pixels: backingPixels,
    remaining_canvas_count: document.querySelectorAll("canvas").length,
  });
  // Refresh only when the pane remains mounted and needs the DOM fallback.
  // Refreshing during unmount makes WebKit allocate a complete fallback
  // renderer immediately before the persistent host is detached.
  if (refreshFallback) {
    try { tab.terminal.refresh(0, Math.max(0, tab.terminal.rows - 1)); } catch {}
  }
}

function TerminalHost({ tab, tabs, isActive, renderer }: HostProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Persistent host pattern: each tab owns the DOM node xterm renders into,
  // and we re-parent that node into the current pane on (re)mount. xterm's
  // renderer is bound to whichever element we first call `terminal.open()`
  // on, so the element must survive Mosaic's drag-driven remounts.
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    pane.appendChild(tab.host);
    if (!tab.opened) {
      tab.terminal.open(tab.host);
      tab.opened = true;
    }
    // Keep a tiny LRU of accelerated renderers so quick switches reuse their
    // WebGL contexts instead of making WebKit churn IOSurfaces.
    if (renderer === "webgl" && isActive) attachWebglAddon(tab, tabs);
    else if (renderer === "webgl") scheduleWebglDetach(tab);
    else detachWebglAddon(tab);
    let cancelled = false;
    const safeFit = () => !cancelled && fitVisibleTerminal(tab, pane);
    // Double-rAF gives the browser a frame to settle layout before we
    // measure the host element. Without this, FitAddon can read 0x0
    // dimensions or stale font metrics on first mount.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        safeFit();
        if (isActive) tab.terminal.focus();
      });
    });
    // Web fonts (JetBrains Mono / Menlo / etc.) often finish loading
    // AFTER the initial render. xterm.js measures the cell width once
    // at open() time using whatever font is active right then \u2014 if
    // that's a fallback font with different metrics, the computed cols
    // will be slightly off and long remote-shell output will clip past
    // the right edge instead of wrapping. Re-fit when the font is
    // actually available so the cols/rows handed to the remote PTY
    // match the visible pane.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(safeFit).catch(() => {});
    }
    // Last-chance refit \u2014 catches any layout settling we missed
    // (mosaic drag-end transitions, scroll-bar appearance, etc.).
    const lateRefit = window.setTimeout(safeFit, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(lateRefit);
      // A same-session remount can reuse this context. The timeout and LRU cap
      // still bound resources when the terminal remains hidden.
      if (renderer === "webgl") scheduleWebglDetach(tab);
      else detachWebglAddon(tab, false);
      try { pane.removeChild(tab.host); } catch {}
    };
    // isActive intentionally omitted: a focus shift shouldn't re-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, renderer]);

  // Split panes remain mounted when focus moves, so update their renderer
  // recency without immediately destroying the context that just lost focus.
  useEffect(() => {
    if (renderer === "dom") {
      detachWebglAddon(tab);
      return;
    }
    if (isActive) attachWebglAddon(tab, tabs);
    else scheduleWebglDetach(tab);
  }, [isActive, renderer, tab, tabs]);

  // A terminal can remain mounted while another tab or app page is active.
  // Refit it when it becomes visible again; its ResizeObserver may not fire
  // when only visibility changed.
  useEffect(() => {
    if (!isActive) return;
    const pane = ref.current;
    if (!pane) return;
    const first = requestAnimationFrame(() => {
      fitVisibleTerminal(tab, pane);
      requestAnimationFrame(() => fitVisibleTerminal(tab, pane));
    });
    return () => cancelAnimationFrame(first);
  }, [isActive, tab]);

  // Re-fit whenever the pane geometry changes (mosaic drag, window resize).
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    // Debounce so a rapid drag doesn't issue one pty_resize per frame
    // (each one triggers a SIGWINCH round-trip to the remote shell).
    let pending: number | null = null;
    const refit = () => {
      if (pending != null) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        pending = null;
        fitVisibleTerminal(tab, pane);
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(pane);
    window.addEventListener("resize", refit);
    return () => {
      if (pending != null) cancelAnimationFrame(pending);
      ro.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [tab]);

  return <div ref={ref} className="terminals-pane-body" />;
}

function collectLeaves(
  node: MosaicNode<number> | null,
  into: Set<number> = new Set(),
): Set<number> {
  if (node == null) return into;
  if (typeof node !== "object") {
    into.add(node);
    return into;
  }
  collectLeaves(node.first, into);
  collectLeaves(node.second, into);
  return into;
}

async function guessShell(): Promise<string> {
  // macOS / Linux default. zsh is fine for both.
  return "/bin/zsh";
}
