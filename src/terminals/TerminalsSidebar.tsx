import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import ContextMenu, {
  captureContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "../components/ContextMenu";
import {
  effectiveSessionConnections,
  listGroups,
  listSessions,
  reorderGroup,
  reorderSession,
  type SavedSession,
  type SessionGroup,
} from "../api/sessions";
import { useSidebarLaunchers } from "./sidebarLaunchers";
import { isSidebarGroupDragging } from "./sidebarGroupState";

type Dock = "left" | "right" | "top" | "bottom";
type GroupBucket = { key: string; label: string; group?: SessionGroup; items: SavedSession[] };

const WIDTH_KEY = "catwalk.terminalsSidebar.width";
const HEIGHT_KEY = "catwalk.terminalsSidebar.height";
const COLLAPSED_KEY = "catwalk.terminalsSidebar.collapsed";
const COLLAPSED_GROUPS_KEY = "catwalk.terminalsSidebar.collapsedGroups";
const DOCK_KEY = "catwalk.terminalsSidebar.dock";
const DEFAULT_WIDTH = 260;
const DEFAULT_HEIGHT = 220;

function readNumber(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readSet(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function readDock(): Dock {
  const value = localStorage.getItem(DOCK_KEY);
  return value === "right" || value === "top" || value === "bottom" ? value : "left";
}

function groupColor(bucket: GroupBucket): string {
  return bucket.group?.color || bucket.items.find((session) => session.color)?.color || "var(--accent)";
}

export default function TerminalsSidebar() {
  const [sessions, setSessions] = useState(listSessions);
  const [groups, setGroups] = useState(listGroups);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const [collapsedGroups, setCollapsedGroups] = useState(() => readSet(COLLAPSED_GROUPS_KEY));
  const [dock, setDock] = useState<Dock>(readDock);
  const [width, setWidth] = useState(() => Math.min(520, Math.max(180, readNumber(WIDTH_KEY, DEFAULT_WIDTH))));
  const [height, setHeight] = useState(() => Math.min(600, Math.max(120, readNumber(HEIGHT_KEY, DEFAULT_HEIGHT))));
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const [groupDrag, setGroupDrag] = useState<{ from: string; over: string | null; before: boolean } | null>(null);
  const [itemDrag, setItemDrag] = useState<{ from: string; over: string | null; before: boolean } | null>(null);
  const [docking, setDocking] = useState(false);
  const [dockHover, setDockHover] = useState<Dock | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const shellRectRef = useRef<DOMRect | null>(null);
  const launchers = useSidebarLaunchers(setError);
  const vertical = dock === "left" || dock === "right";

  useEffect(() => {
    const reload = () => { setSessions(listSessions()); setGroups(listGroups()); };
    window.addEventListener("catwalk:sessions-changed", reload);
    return () => window.removeEventListener("catwalk:sessions-changed", reload);
  }, []);
  useEffect(() => { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); }, [collapsed]);
  useEffect(() => { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsedGroups])); }, [collapsedGroups]);
  useEffect(() => { localStorage.setItem(DOCK_KEY, dock); }, [dock]);
  useEffect(() => { localStorage.setItem(WIDTH_KEY, String(Math.round(width))); }, [width]);
  useEffect(() => { localStorage.setItem(HEIGHT_KEY, String(Math.round(height))); }, [height]);

  const visible = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    return sessions.filter((session) => !query || [session.name, session.host, session.username]
      .some((value) => value.toLocaleLowerCase().includes(query)));
  }, [filter, sessions]);

  const buckets = useMemo<GroupBucket[]>(() => {
    const byGroup = new Map(groups.map((group) => [group.id, [] as SavedSession[]]));
    const ungrouped: SavedSession[] = [];
    for (const session of visible) {
      const destination = session.groupId ? byGroup.get(session.groupId) : undefined;
      if (destination) destination.push(session); else ungrouped.push(session);
    }
    const result: GroupBucket[] = groups.map((group) => ({
      key: `g:${group.id}`,
      label: group.name,
      group,
      items: [...(byGroup.get(group.id) ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
    if (ungrouped.length || groups.length === 0) result.push({
      key: "ungrouped",
      label: "Ungrouped",
      items: ungrouped.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    });
    return result;
  }, [groups, visible]);

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function groupMenu(event: React.MouseEvent, bucket: GroupBucket) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: bucket.label, disabled: true },
        { divider: true },
        { label: collapsedGroups.has(bucket.key) ? "Expand group" : "Collapse group", onClick: () => toggleGroup(bucket.key) },
        {
          label: "Open all in terminal group",
          disabled: bucket.items.length === 0,
          onClick: () => bucket.items.forEach((session) => { void launchers.launchSessionSsh(session, undefined, bucket.label); }),
        },
      ],
    });
  }

  function sessionMenu(event: React.MouseEvent, session: SavedSession) {
    const protocols = effectiveSessionConnections(session);
    const items: ContextMenuItem[] = [];
    if (protocols.ssh || session.protocol === "shell") items.push({ label: session.protocol === "shell" ? "Open local shell" : `SSH as ${session.username || "(no user)"}`, onClick: () => launchers.launchSessionSsh(session) });
    if (protocols.rdp) items.push({ label: "Open RDP", onClick: () => launchers.launchSessionRdp(session) });
    if (protocols.sftp) {
      items.push({ divider: true });
      items.push({ label: "Open SFTP in terminal", onClick: () => launchers.launchSessionSftpInApp(session) });
      items.push({ label: "Open SFTP in app browser", onClick: () => launchers.launchSessionSftpBrowser(session) });
    }
    setMenu({ pos: captureContextMenu(event), items });
  }

  function startResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const move = (pointer: MouseEvent) => {
      if (dock === "left") setWidth(Math.min(520, Math.max(180, pointer.clientX)));
      else if (dock === "right") setWidth(Math.min(520, Math.max(180, window.innerWidth - pointer.clientX)));
      else if (dock === "top") setHeight(Math.min(600, Math.max(120, pointer.clientY)));
      else setHeight(Math.min(600, Math.max(120, window.innerHeight - pointer.clientY)));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop, { once: true });
  }

  function closestDock(clientX: number, clientY: number, rect: DOMRect): Dock {
    const distances: Array<[Dock, number]> = [
      ["left", Math.abs(clientX - rect.left)],
      ["right", Math.abs(rect.right - clientX)],
      ["top", Math.abs(clientY - rect.top)],
      ["bottom", Math.abs(rect.bottom - clientY)],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  }

  function startDockDrag(event: React.MouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const shell = sidebarRef.current?.closest(".terminals-shell");
    if (!(shell instanceof HTMLElement)) return;
    const rect = shell.getBoundingClientRect();
    shellRectRef.current = rect;
    setDocking(true);
    const move = (pointer: MouseEvent) => setDockHover(closestDock(pointer.clientX, pointer.clientY, rect));
    const stop = (pointer: MouseEvent) => {
      const next = closestDock(pointer.clientX, pointer.clientY, rect);
      setDock(next);
      setDockHover(null);
      setDocking(false);
      shellRectRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop, { once: true });
  }

  function groupDragProps(bucket: GroupBucket) {
    if (!bucket.group) return {};
    return {
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `connecat-sidebar-group:${bucket.group!.id}`);
        setGroupDrag({ from: bucket.group!.id, over: null, before: false });
      },
      onDragOver: (event: React.DragEvent) => {
        if (!groupDrag || groupDrag.from === bucket.group!.id) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const before = vertical ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2;
        setGroupDrag({ ...groupDrag, over: bucket.group!.id, before });
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const from = groupDrag?.from;
        if (from && from !== bucket.group!.id) {
          reorderGroup(from, bucket.group!.id);
          setGroups(listGroups());
        }
        setGroupDrag(null);
      },
      onDragEnd: () => setGroupDrag(null),
    };
  }

  function itemDragProps(session: SavedSession, bucket: GroupBucket) {
    return {
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", `connecat-sidebar-session:${session.id}`);
        setItemDrag({ from: session.id, over: null, before: false });
      },
      onDragOver: (event: React.DragEvent) => {
        if (!itemDrag || itemDrag.from === session.id) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setItemDrag({ ...itemDrag, over: session.id, before: event.clientY < rect.top + rect.height / 2 });
      },
      onDrop: (event: React.DragEvent) => {
        if (!itemDrag || itemDrag.from === session.id) return;
        event.preventDefault();
        event.stopPropagation();
        reorderSession(itemDrag.from, session.id, bucket.items.map((item) => item.id));
        setSessions(listSessions());
        setItemDrag(null);
      },
      onDragEnd: () => setItemDrag(null),
    };
  }

  const dropOverlay = docking && shellRectRef.current ? <div className="terminals-sidebar-dropzones" style={{ position: "fixed", inset: `${shellRectRef.current.top}px ${window.innerWidth - shellRectRef.current.right}px ${window.innerHeight - shellRectRef.current.bottom}px ${shellRectRef.current.left}px`, pointerEvents: "none", zIndex: 999 }}>
    {(["left", "right", "top", "bottom"] as Dock[]).map((side) => <div key={side} className={`terminals-sidebar-dropzone${dockHover === side ? " hover" : ""}${dock === side ? " current" : ""}`} style={{ position: "absolute", ...(side === "left" ? { left: 0, top: 0, width: "30%", height: "100%" } : side === "right" ? { right: 0, top: 0, width: "30%", height: "100%" } : side === "top" ? { left: 0, top: 0, width: "100%", height: "30%" } : { left: 0, bottom: 0, width: "100%", height: "30%" }) }} />)}
  </div> : null;

  if (collapsed) return <aside ref={sidebarRef} className={`terminals-sidebar collapsed dock-${dock}`} style={vertical ? { width: 28, flexShrink: 0 } : { height: 24, width: "100%", flexShrink: 0 }}>
    <button type="button" className="terminals-sidebar-expand" onClick={() => setCollapsed(false)} title="Expand sidebar" aria-label="Expand sidebar">{vertical ? (dock === "left" ? "›" : "‹") : (dock === "top" ? "▾" : "▴")}</button>
  </aside>;

  return <aside ref={sidebarRef} className={`terminals-sidebar dock-${dock}`} style={vertical ? { width, flexShrink: 0 } : { height, width: "100%", flexShrink: 0 }}>
    <div className="terminals-sidebar-tabs">
      <button type="button" className="terminals-sidebar-grip" onMouseDown={startDockDrag} title="Drag to dock left / right / top / bottom" aria-label="Drag to re-dock sidebar">⋮⋮</button>
      <button type="button" className="active" title="Connections">Connections</button>
      <button type="button" className="terminals-sidebar-collapse" onClick={() => setCollapsed(true)} title="Collapse sidebar" aria-label="Collapse sidebar">{vertical ? (dock === "left" ? "‹" : "›") : (dock === "top" ? "▴" : "▾")}</button>
    </div>
    <div className="terminals-sidebar-filter"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter…" aria-label="Filter connections" /></div>
    <div className="terminals-sidebar-body">
      {error && <div className="error-banner" role="alert">{error}<button type="button" onClick={() => setError(null)}>×</button></div>}
      {buckets.map((bucket) => {
        const open = !collapsedGroups.has(bucket.key);
        const drop = bucket.group && groupDrag?.over === bucket.group.id && groupDrag.from !== bucket.group.id;
        const dragging = isSidebarGroupDragging(bucket.group?.id, groupDrag?.from);
        const className = `terminals-sidebar-group${open ? " open" : ""}${dragging ? " dragging" : ""}${drop ? ` drop-${groupDrag.before ? "before" : "after"}${vertical ? " drop-v" : " drop-h"}` : ""}`;
        return <section key={bucket.key} className={className} style={{ "--terminals-group-edge": groupColor(bucket) } as CSSProperties} {...groupDragProps(bucket)}>
          <button type="button" className="terminals-sidebar-group-header" onClick={() => toggleGroup(bucket.key)} onContextMenu={(event) => groupMenu(event, bucket)} title={bucket.group ? "Click to expand/collapse · drag to reorder" : "Click to expand/collapse"}>
            <span className="caret">{open ? "▾" : "▸"}</span><span className="label">{bucket.label}</span><span className="count">{bucket.items.length}</span>
          </button>
          {open && <div className="terminals-sidebar-list">
            {bucket.items.map((session) => {
              const over = itemDrag?.over === session.id && itemDrag.from !== session.id;
              return <div key={session.id} className="terminals-sidebar-item" style={{ ...(session.color ? { borderLeftColor: session.color } : {}), ...(itemDrag?.from === session.id ? { opacity: .5 } : {}), ...(over ? { boxShadow: `inset 0 ${itemDrag.before ? "2px" : "-2px"} 0 var(--accent)` } : {}) }} {...itemDragProps(session, bucket)} onClick={() => void launchers.launchSessionSsh(session)} onContextMenu={(event) => sessionMenu(event, session)} title={`${session.name} (${session.host}) · drag to reorder`}>
                <span className="name">{session.name}</span><span className="sub">{session.protocol === "shell" ? "Local shell" : session.host}</span>
              </div>;
            })}
            {bucket.items.length === 0 && <div className="terminals-sidebar-empty">No connections in this group.</div>}
          </div>}
        </section>;
      })}
      {buckets.length === 0 && <div className="terminals-sidebar-empty">No saved connections.</div>}
    </div>
    <div className="terminals-sidebar-resizer" onMouseDown={startResize} title="Drag to resize" />
    {menu && <ContextMenu position={menu.pos} items={menu.items} onClose={() => setMenu(null)} />}
    {dropOverlay}
  </aside>;
}
