import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getUsername,
  getSshKeyPath,
  sftpDisconnect,
  sftpList,
  sftpRealpath,
  sftpDownload,
  sftpUpload,
  sftpCancelTransfer,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  SftpEntry,
} from "../api/standalone";
import { diagnosticEvent } from "../api/diagnostics";
import NotesIcon, { type NotesIconName } from "../components/NotesIcon";
import ContextMenu, {
  captureContextMenu,
  type ContextMenuPosition,
} from "../components/ContextMenu";
import PasswordInput from "../components/PasswordInput";
import { useAppearance } from "../appearance/AppearanceContext";
import {
  filterAndSortSftpEntries,
  type SftpSortDirection,
  type SftpSortKey,
} from "../sftp/entryView";

// Standalone builds intentionally keep transfer telemetry on-device only.
const trackConneCatUsageEvent = (_event: unknown) => {};

/// Two-pane SFTP browser. Left pane = remote (via russh-sftp). Right pane
/// is intentionally light: a recent transfers log. For downloads we save
/// to a user-chosen folder via the native save dialog so the user picks
/// the destination once per file. Same loopback tunnel as the SSH session.
interface SftpBrowserProps {
  /// When embedded as a Remote Access tab, the connection comes from props
  /// instead of the route, and the in-page "Back" link is hidden.
  embedded?: boolean;
  deviceId?: string;
  host?: string;
  port?: number;
  user?: string;
  keyPath?: string;
  initialPassword?: string;
  autoConnect?: boolean;
  name?: string;
  onClose?: () => void;
  onHealthChange?: (status: string, error?: string, disconnected?: boolean) => void;
}

interface SftpProgressEvent {
  transferId: string;
  transferred: number;
  total: number;
}

interface ActiveTransfer extends SftpProgressEvent {
  name: string;
  direction: "upload" | "download";
  startedAt: number;
  sampledAt: number;
  sampledBytes: number;
  bytesPerSecond: number;
  fileIndex: number;
  fileCount: number;
  state: "transferring" | "cancelling" | "complete" | "failed" | "cancelled";
}

export default function SftpBrowser(props: SftpBrowserProps = {}) {
  const { appearance, userPrefs, setUserPrefs } = useAppearance();
  const [qs] = useSearchParams();
  // Direct-host mode: props (embedded) or ?host=&port=&user=&name= from My Connections.
  const directHost = props.host ?? qs.get("host") ?? "";
  const directPort = props.port ?? (parseInt(qs.get("port") || "22", 10) || 22);
  const directUser = props.user ?? qs.get("user") ?? "";
  const directName = props.name ?? qs.get("name") ?? "";
  const directKeyPath = props.keyPath ?? qs.get("keyPath") ?? "";
  const isDirect = !!directHost;
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [username, setUsername] = useState(directUser || getUsername() || "");
  const [password, setPassword] = useState(props.initialPassword ?? "");
  const [cwd, setCwd] = useState<string>(".");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SftpSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SftpSortDirection>("asc");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [toolbarMenuPos, setToolbarMenuPos] = useState<ContextMenuPosition | null>(null);
  const [log, setLog] = useState<{ when: number; line: string; ok: boolean }[]>([]);
  const [transfer, setTransfer] = useState<ActiveTransfer | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const autoConnectStarted = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const sessionIdRef = useRef<number | null>(null);

  function trackConnectionEnd() {
    if (connectedAtRef.current == null) return;
    connectedAtRef.current = null;
  }

  async function disconnectSession(reason: "tab_close" | "user_disconnect" | "connect_cancelled" | "connect_failed") {
    const activeSessionId = sessionIdRef.current;
    if (activeSessionId == null) return;
    sessionIdRef.current = null;
    diagnosticEvent("sftp", "info", "catwalk.sftp", "SFTP disconnect requested", {
      session_id: activeSessionId,
      reason,
    });
    try {
      await sftpDisconnect(activeSessionId);
      diagnosticEvent("sftp", "info", "catwalk.sftp", "SFTP disconnect completed", {
        session_id: activeSessionId,
        reason,
      });
    } catch (error) {
      diagnosticEvent("sftp", "warn", "catwalk.sftp", "SFTP disconnect failed", {
        session_id: activeSessionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      trackConnectionEnd();
    }
  }

  useEffect(() => {
    // Embedded browsers remain mounted across routes. Explicit tab close (or
    // app teardown) now closes the native session even if the React state
    // update that normally publishes its id has not completed yet.
    return () => {
      mountedRef.current = false;
      void disconnectSession("tab_close");
    };
    // The cleanup intentionally reads refs so it always sees the latest
    // native session without re-running during a normal state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SftpProgressEvent>("sftp://transfer-progress", ({ payload }) => {
      setTransfer((current) => {
        if (!current || current.transferId !== payload.transferId) return current;
        const now = Date.now();
        const elapsed = Math.max((now - current.sampledAt) / 1000, 0.001);
        const sampleSpeed = Math.max(0, payload.transferred - current.sampledBytes) / elapsed;
        const bytesPerSecond = current.bytesPerSecond > 0
          ? current.bytesPerSecond * 0.65 + sampleSpeed * 0.35
          : sampleSpeed;
        return {
          ...current,
          transferred: payload.transferred,
          total: payload.total,
          sampledAt: now,
          sampledBytes: payload.transferred,
          bytesPerSecond,
        };
      });
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function pushLog(line: string, ok: boolean) {
    setLog((l) => [{ when: Date.now(), line, ok }, ...l].slice(0, 50));
  }

  async function connect() {
    if (!isDirect) return;
    setBusy(true);
    setErr(null);
    const connectingStatus = "Connecting…";
    setStatus(connectingStatus);
    props.onHealthChange?.(connectingStatus);
    try {
      const sid = await invoke<number>("sftp_connect", {
        host: directHost,
        port: directPort,
        username: username || directUser || "admin",
        keyPath: directKeyPath || getSshKeyPath() || undefined,
        password: password || undefined,
      });
      const p = directPort;
      if (!mountedRef.current) {
        sessionIdRef.current = sid;
        await disconnectSession("connect_cancelled");
        return;
      }
      sessionIdRef.current = sid;
      setSessionId(sid);
      setPort(p);
      const home = await sftpRealpath(sid, ".").catch(() => ".");
      if (!mountedRef.current) return;
      setCwd(home);
      const list = await sftpList(sid, home);
      if (!mountedRef.current) return;
      setEntries(list);
      const connectedStatus = `Connected to ${directHost}:${p}.`;
      setStatus(connectedStatus);
      props.onHealthChange?.(connectedStatus);
      pushLog(`Connected as ${username || "admin"} (cwd=${home})`, true);
      connectedAtRef.current = Date.now();
    } catch (e: any) {
      if (!mountedRef.current) return;
      await disconnectSession("connect_failed");
      if (!mountedRef.current) return;
      setSessionId(null);
      setPort(null);
      const msg = e.message ?? String(e);
      if (props.initialPassword) setPassword("");
      setErr(msg);
      setStatus(null);
      props.onHealthChange?.("Disconnected.", msg, true);
      pushLog(`Connect failed: ${msg}`, false);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!props.autoConnect || autoConnectStarted.current) return;
    if (!isDirect) return;
    autoConnectStarted.current = true;
    void connect();
  }, [isDirect, props.autoConnect]);

  async function refresh(target?: string) {
    if (sessionId == null) return;
    setBusy(true);
    setErr(null);
    try {
      const path = target ?? cwd;
      const list = await sftpList(sessionId, path);
      setEntries(list);
      setCwd(path);
      setSelection(new Set());
    } catch (e: any) {
      const msg = e.message ?? String(e);
      setErr(msg);
      pushLog(`List failed: ${msg}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function enter(entry: SftpEntry) {
    if (!entry.is_dir || sessionId == null) return;
    await refresh(entry.path);
  }

  async function goUp() {
    if (sessionId == null) return;
    const parts = cwd.split("/").filter(Boolean);
    if (cwd.startsWith("/")) {
      parts.pop();
      const next = "/" + parts.join("/");
      await refresh(next === "/" ? "/" : next);
    } else {
      await refresh("..");
    }
  }

  function toggleSelect(p: string, multi: boolean) {
    setSelection((sel) => {
      const next = new Set(multi ? sel : []);
      if (sel.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function downloadSelected() {
    if (sessionId == null || selection.size === 0) return;
    const items = entries.filter((e) => selection.has(e.path) && !e.is_dir);
    if (items.length === 0) {
      pushLog("Folder downloads aren't supported yet — select files only.", false);
      return;
    }
    setBusy(true);
    let activeTransferId: string | null = null;
    try {
      const jobs: { item: SftpEntry; destination: string }[] = [];
      if (items.length === 1) {
        const item = items[0];
        const dst = await saveDialog({ defaultPath: item.name });
        if (!dst) return;
        jobs.push({ item, destination: dst });
      } else {
        const dir = await openDialog({ directory: true, multiple: false });
        if (!dir || typeof dir !== "string") return;
        jobs.push(...items.map((item) => ({ item, destination: `${dir}/${item.name}` })));
      }
      for (let index = 0; index < jobs.length; index += 1) {
        const { item, destination } = jobs[index];
        activeTransferId = crypto.randomUUID?.() ?? `${Date.now()}-download-${index}`;
        const startedAt = Date.now();
        setTransfer({
          transferId: activeTransferId,
          name: item.name,
          direction: "download",
          transferred: 0,
          total: item.size,
          startedAt,
          sampledAt: startedAt,
          sampledBytes: 0,
          bytesPerSecond: 0,
          fileIndex: index + 1,
          fileCount: jobs.length,
          state: "transferring",
        });
        trackConneCatUsageEvent({ action_id: "transfer.start", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "started", metadata: { transfer_direction: "download" } });
        const n = await sftpDownload(sessionId, item.path, destination, activeTransferId);
        setTransfer((current) => current?.transferId === activeTransferId
          ? { ...current, transferred: n, total: current.total || n, state: "complete" }
          : current);
        pushLog(`↓ ${item.name} (${human(n)}) → ${destination}`, true);
        trackConneCatUsageEvent({ action_id: "transfer.success", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "success", quantity_name: "bytes", quantity_value: n, metadata: { transfer_direction: "download" } });
      }
    } catch (e: any) {
      const msg = e.message ?? String(e);
      const cancelled = msg.toLowerCase().includes("transfer cancelled");
      setTransfer((current) => current && (!activeTransferId || current.transferId === activeTransferId)
        ? { ...current, state: cancelled ? "cancelled" : "failed" }
        : current);
      if (cancelled) {
        pushLog("Download cancelled.", false);
      } else {
        setErr(msg);
        pushLog(`Download failed: ${msg}`, false);
        trackConneCatUsageEvent({ action_id: "transfer.failure", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "failure", metadata: { transfer_direction: "download" } });
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadPicked() {
    if (sessionId == null) return;
    const picked = await openDialog({ multiple: true });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    await uploadPaths(list as string[]);
  }

  async function uploadPaths(paths: string[]) {
    if (sessionId == null || paths.length === 0) return;
    setBusy(true);
    let activeTransferId: string | null = null;
    try {
      for (let index = 0; index < paths.length; index += 1) {
        const local = paths[index];
        const name = local.split(/[\\/]/).pop() || "upload";
        const remote = cwd.endsWith("/") ? `${cwd}${name}` : `${cwd}/${name}`;
        const transferId = crypto.randomUUID?.() ?? `${Date.now()}-${index}`;
        activeTransferId = transferId;
        const startedAt = Date.now();
        setTransfer({
          transferId,
          name,
          direction: "upload",
          transferred: 0,
          total: 0,
          startedAt,
          sampledAt: startedAt,
          sampledBytes: 0,
          bytesPerSecond: 0,
          fileIndex: index + 1,
          fileCount: paths.length,
          state: "transferring",
        });
        trackConneCatUsageEvent({ action_id: "transfer.start", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "started", metadata: { transfer_direction: "upload" } });
        const n = await sftpUpload(sessionId, local, remote, transferId);
        setTransfer((current) => current?.transferId === transferId
          ? { ...current, transferred: n, total: current.total || n, state: "complete" }
          : current);
        pushLog(`↑ ${name} (${human(n)}) → ${remote}`, true);
        trackConneCatUsageEvent({ action_id: "transfer.success", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "success", quantity_name: "bytes", quantity_value: n, metadata: { transfer_direction: "upload" } });
      }
      await refresh();
    } catch (e: any) {
      const msg = e.message ?? String(e);
      const cancelled = msg.toLowerCase().includes("transfer cancelled");
      setTransfer((current) => current && (!activeTransferId || current.transferId === activeTransferId)
        ? { ...current, state: cancelled ? "cancelled" : "failed" }
        : current);
      if (cancelled) {
        pushLog("Upload cancelled.", false);
      } else {
        setErr(msg);
        pushLog(`Upload failed: ${msg}`, false);
        trackConneCatUsageEvent({ action_id: "transfer.failure", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "failure", metadata: { transfer_direction: "upload" } });
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelTransfer() {
    if (!transfer || (transfer.state !== "transferring" && transfer.state !== "cancelling")) return;
    const transferId = transfer.transferId;
    trackConneCatUsageEvent({ action_id: "transfer.cancel", component_id: "catwalk.sftp", feature_id: "sftp", outcome: "cancelled", metadata: { transfer_direction: transfer.direction } });
    setTransfer((current) => current?.transferId === transferId
      ? { ...current, state: "cancelling" }
      : current);
    try {
      await sftpCancelTransfer(transferId);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      setErr(message);
      setTransfer((current) => current?.transferId === transferId
        ? { ...current, state: "failed" }
        : current);
    }
  }

  async function makeDir() {
    if (sessionId == null) return;
    const name = window.prompt("New folder name");
    if (!name) return;
    const path = cwd.endsWith("/") ? `${cwd}${name}` : `${cwd}/${name}`;
    try {
      await sftpMkdir(sessionId, path);
      pushLog(`+ ${path}/`, true);
      await refresh();
    } catch (e: any) {
      pushLog(`mkdir failed: ${e.message ?? e}`, false);
    }
  }

  async function deleteSelected() {
    if (sessionId == null || selection.size === 0) return;
    const items = entries.filter((e) => selection.has(e.path));
    if (!window.confirm(`Delete ${items.length} item(s)?`)) return;
    setBusy(true);
    try {
      for (const it of items) {
        await sftpRemove(sessionId, it.path, it.is_dir);
        pushLog(`× ${it.path}`, true);
      }
      await refresh();
    } catch (e: any) {
      pushLog(`Delete failed: ${e.message ?? e}`, false);
    } finally {
      setBusy(false);
    }
  }

  async function renameSelected() {
    if (sessionId == null || selection.size !== 1) return;
    const item = entries.find((e) => selection.has(e.path));
    if (!item) return;
    const next = window.prompt("New name", item.name);
    if (!next || next === item.name) return;
    const to = cwd.endsWith("/") ? `${cwd}${next}` : `${cwd}/${next}`;
    try {
      await sftpRename(sessionId, item.path, to);
      pushLog(`↻ ${item.name} → ${next}`, true);
      await refresh();
    } catch (e: any) {
      pushLog(`Rename failed: ${e.message ?? e}`, false);
    }
  }

  const breadcrumb = useMemo(() => {
    if (!cwd.startsWith("/")) return [{ label: cwd, path: cwd }];
    const parts = cwd.split("/").filter(Boolean);
    const out = [{ label: "/", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      out.push({ label: p, path: acc });
    }
    return out;
  }, [cwd]);

  const visibleEntries = useMemo(
    () => filterAndSortSftpEntries(entries, findQuery, findCaseSensitive, sortKey, sortDirection),
    [entries, findCaseSensitive, findQuery, sortDirection, sortKey],
  );

  function openFind() {
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }

  function closeFind() {
    setFindOpen(false);
    setFindQuery("");
  }

  function changeSort(nextKey: SftpSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "mtime" ? "desc" : "asc");
  }

  function sortAria(key: SftpSortKey): React.AriaAttributes["aria-sort"] {
    if (sortKey !== key) return "none";
    return sortDirection === "asc" ? "ascending" : "descending";
  }

  if (!isDirect) return <p>SFTP requires a saved connection host.</p>;

  const title = directName || `${directHost}:${directPort}`;
  const backLink = "/connections";
  const backLabel = "← Back to Connections";
  const showToolbarText = appearance.connectionsToolbarDisplay === "iconsAndText";

  return (
    <div
      className="sftp-browser"
      style={props.embedded ? { padding: 12, height: "100%", boxSizing: "border-box", position: "relative" } : undefined}
      onKeyDown={(event) => {
        if (sessionId != null && (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
          event.preventDefault();
          openFind();
        }
      }}
    >
      {props.embedded ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>SFTP — {title}</h2>
        </div>
      ) : (
        <>
          <Link to={backLink} className="btn-secondary btn-small">{backLabel}</Link>
          <h2 style={{ marginTop: 12 }}>SFTP — {title}</h2>
        </>
      )}

      {toolbarMenuPos && (
        <ContextMenu
          position={toolbarMenuPos}
          items={[
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
          ]}
          onClose={() => setToolbarMenuPos(null)}
        />
      )}

      {sessionId == null ? (
        props.embedded ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(6, 12, 20, 0.82)",
              zIndex: 5,
              color: "#e5eef7",
            }}
          >
            <form
              onSubmit={(e) => { e.preventDefault(); if (!busy) void connect(); }}
              style={{
                width: "min(360px, calc(100% - 32px))",
                display: "grid",
                gap: 10,
                padding: 18,
                border: "1px solid rgba(148, 163, 184, 0.35)",
                borderRadius: 8,
                background: "#0f172a",
                boxShadow: "0 18px 60px rgba(0, 0, 0, 0.35)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "1rem" }}>SFTP Login — {title}</div>
              <input
                autoFocus={!username.trim()}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                autoComplete="username"
                style={{ padding: "9px 10px", borderRadius: 6, border: "1px solid rgba(148, 163, 184, 0.45)", background: "#020617", color: "#f8fafc" }}
              />
              <PasswordInput
                autoFocus={Boolean(username.trim())}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (blank = use private key)"
                autoComplete="current-password"
                style={{ padding: "9px 10px", borderRadius: 6, border: "1px solid rgba(148, 163, 184, 0.45)", background: "#020617", color: "#f8fafc" }}
              />
              {status && <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{status}</div>}
              {err && <div style={{ color: "salmon", fontSize: "0.85rem" }}>{err}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn-secondary btn-small" onClick={() => props.onClose?.()}>Cancel</button>
                <button type="submit" className="btn-primary btn-small" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
              </div>
            </form>
          </div>
        ) : (
          <div className="card">
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Opens a direct SFTP session and lets you browse, upload, download,
              create folders, rename, and delete files in-app.
            </p>
            <div className="form-row">
              <label>SSH username</label>
              <input autoFocus={!username.trim()} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
            </div>
            <div className="form-row">
              <label>Password (optional)</label>
              <PasswordInput
                autoFocus={Boolean(username.trim())}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="leave blank to use private key"
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect"}</button>
              <button
                className="btn-secondary"
                onClick={() => navigate(backLink)}
              >Cancel</button>
            </div>
            {status && <p style={{ color: "var(--muted)" }}>{status}</p>}
            {err && <p style={{ color: "salmon" }}>{err}</p>}
          </div>
        )
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 12 }}>
          <div className="card" style={{ minHeight: 400 }}>
            <div
              className="sftp-actions-toolbar"
              onContextMenu={(event) => setToolbarMenuPos(captureContextMenu(event))}
            >
              <SftpActionButton icon="up" label="Up" showText={showToolbarText} onClick={goUp} disabled={busy} />
              <SftpActionButton icon="sync" label="Refresh" showText={showToolbarText} onClick={() => refresh()} disabled={busy} />
              <SftpActionButton icon="new-folder" label="New folder" showText={showToolbarText} onClick={makeDir} disabled={busy} />
              <SftpActionButton icon="upload" label="Upload" showText={showToolbarText} onClick={uploadPicked} disabled={busy} />
              <SftpActionButton icon="download" label="Download" showText={showToolbarText} onClick={downloadSelected} disabled={busy || selection.size === 0} />
              <SftpActionButton icon="rename" label="Rename" showText={showToolbarText} onClick={renameSelected} disabled={busy || selection.size !== 1} />
              <SftpActionButton icon="delete" label="Delete" showText={showToolbarText} onClick={deleteSelected} disabled={busy || selection.size === 0} danger />
              <SftpActionButton
                icon="find"
                label="Find"
                showText={showToolbarText}
                onClick={() => { if (findOpen) closeFind(); else openFind(); }}
                ariaExpanded={findOpen}
                shortcut="Ctrl/Cmd+F"
              />
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.85rem" }}>
              {isDirect ? `${directHost}:${port}` : `tunnel 127.0.0.1:${port}`}
            </span>
            </div>
            <div style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: 8 }}>
              {breadcrumb.map((b, i) => (
                <span key={b.path}>
                  {i > 0 && " / "}
                  <a href="#" onClick={(e) => { e.preventDefault(); refresh(b.path); }}>{b.label}</a>
                </span>
              ))}
            </div>
            {findOpen && (
              <div className="terminals-findbar sftp-findbar" role="search">
                <span className="terminals-findbar-label">Find</span>
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeFind();
                    }
                  }}
                  placeholder="Search this folder"
                  aria-label="Find files in this folder"
                />
                <button
                  type="button"
                  className={findCaseSensitive ? "active" : ""}
                  onClick={() => setFindCaseSensitive((current) => !current)}
                  aria-pressed={findCaseSensitive}
                  title="Match case"
                >
                  Aa
                </button>
                <span className="terminals-findbar-count">
                  {findQuery ? `${visibleEntries.length} / ${entries.length}` : ""}
                </span>
                <button type="button" onClick={closeFind} title="Close find" aria-label="Close find">
                  ×
                </button>
              </div>
            )}
            <div className="sftp-entry-list">
              <table className="sftp-entry-table">
                <thead>
                  <tr style={{ background: "var(--panel)", position: "sticky", top: 0 }}>
                    <th style={th}></th>
                    <th style={th} aria-sort={sortAria("name")}>
                      <SortButton label="Name" active={sortKey === "name"} direction={sortDirection} onClick={() => changeSort("name")} />
                    </th>
                    <th style={{ ...th, textAlign: "right" }} aria-sort={sortAria("size")}>
                      <SortButton label="Size" active={sortKey === "size"} direction={sortDirection} onClick={() => changeSort("size")} align="right" />
                    </th>
                    <th style={th} aria-sort={sortAria("mtime")}>
                      <SortButton label="Modified" active={sortKey === "mtime"} direction={sortDirection} onClick={() => changeSort("mtime")} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 12, color: "var(--muted)" }}>{findQuery ? "No matching files" : "(empty)"}</td></tr>
                  )}
                  {visibleEntries.map((e) => {
                    const sel = selection.has(e.path);
                    return (
                      <tr
                        key={e.path}
                        className={`sftp-entry-row${sel ? " selected" : ""}`}
                        aria-selected={sel}
                        onClick={(ev) => toggleSelect(e.path, ev.metaKey || ev.ctrlKey)}
                        onDoubleClick={() => enter(e)}
                        style={{
                          cursor: e.is_dir ? "pointer" : "default",
                        }}
                      >
                        <td style={td}>{e.is_dir ? "📁" : "📄"}</td>
                        <td style={td}>{e.name}</td>
                        <td style={{ ...td, textAlign: "right" }}>{e.is_dir ? "—" : human(e.size)}</td>
                        <td style={td}>{e.mtime ? new Date(e.mtime * 1000).toLocaleString() : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {err && <p style={{ color: "salmon", marginTop: 8 }}>{err}</p>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="card">
              <h4 style={{ marginTop: 0 }}>Transfers</h4>
              {transfer && (
                <div style={{ marginBottom: log.length > 0 ? 12 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={transfer.name}>
                      {transfer.name}
                    </strong>
                    <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {transfer.fileCount > 1 ? `${transfer.fileIndex}/${transfer.fileCount} · ` : ""}
                      {transfer.state === "transferring"
                        ? `${transferPercent(transfer)}%`
                        : transfer.state === "cancelling"
                          ? "Cancelling…"
                          : transfer.state === "complete"
                            ? "Complete"
                            : transfer.state === "cancelled"
                              ? "Cancelled"
                              : "Failed"}
                    </span>
                    {(transfer.state === "transferring" || transfer.state === "cancelling") && (
                      <button
                        type="button"
                        className="sftp-transfer-cancel"
                        onClick={() => { void cancelTransfer(); }}
                        disabled={transfer.state === "cancelling"}
                        title={`Cancel ${transfer.direction}`}
                        aria-label={`Cancel ${transfer.direction} of ${transfer.name}`}
                      >
                        <NotesIcon name="cancel" size={14} />
                        Cancel
                      </button>
                    )}
                  </div>
                  <progress
                    value={transfer.total > 0 ? transfer.transferred : undefined}
                    max={transfer.total || 1}
                    style={{ width: "100%", height: 8, accentColor: "var(--accent)" }}
                    aria-label={`${transfer.direction === "upload" ? "Upload" : "Download"} progress for ${transfer.name}`}
                  />
                  <div style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: 5 }}>
                    {human(transfer.transferred)}{transfer.total > 0 ? ` / ${human(transfer.total)}` : ""}
                    {transfer.state === "transferring" && transfer.bytesPerSecond > 0 && (
                      <> · {human(transfer.bytesPerSecond)}/s · {formatEta(transfer)}</>
                    )}
                  </div>
                </div>
              )}
              {log.length === 0 ? (
                !transfer && <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.85rem" }}>(none yet)</p>
              ) : (
                <ul style={{ paddingLeft: 16, margin: 0, fontSize: "0.85rem", maxHeight: 280, overflow: "auto" }}>
                  {log.map((l, i) => (
                    <li key={i} style={{ color: l.ok ? "inherit" : "salmon" }}>
                      <span style={{ color: "var(--muted)" }}>
                        {new Date(l.when).toLocaleTimeString()}
                      </span>{" "}
                      {l.line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              className="btn-secondary sftp-disconnect-button"
              onClick={async () => {
                await disconnectSession("user_disconnect");
                if (!mountedRef.current) return;
                setSessionId(null);
                setPort(null);
                setEntries([]);
              }}
            >Disconnect</button>
          </div>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 10px",
  fontWeight: 600,
  fontSize: "0.85rem",
  borderBottom: "1px solid var(--border)",
};
const td: React.CSSProperties = {
  padding: "4px 10px",
  borderBottom: "1px solid var(--border)",
};

function human(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function transferPercent(transfer: ActiveTransfer): number {
  if (transfer.total <= 0) return 0;
  return Math.min(100, Math.round((transfer.transferred / transfer.total) * 100));
}

function formatEta(transfer: ActiveTransfer): string {
  if (transfer.total <= transfer.transferred || transfer.bytesPerSecond <= 0) return "ETA calculating";
  const seconds = Math.ceil((transfer.total - transfer.transferred) / transfer.bytesPerSecond);
  if (seconds < 60) return `ETA ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `ETA ${minutes}m ${remaining}s`;
  return `ETA ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function SortButton({
  label,
  active,
  direction,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: SftpSortDirection;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      className="sftp-sort-button"
      onClick={onClick}
      style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}
      title={`Sort by ${label.toLocaleLowerCase()}`}
    >
      <span>{label}</span>
      <span className="sftp-sort-direction" aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
}

function SftpActionButton({
  icon,
  label,
  showText,
  onClick,
  disabled = false,
  danger = false,
  shortcut,
  ariaExpanded,
}: {
  icon: NotesIconName;
  label: string;
  showText: boolean;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  ariaExpanded?: boolean;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={`btn-secondary btn-small sftp-action-button${showText ? " sftp-action-button--text" : ""}${danger ? " sftp-action-button--danger" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-expanded={ariaExpanded}
    >
      <NotesIcon name={icon} size={17} />
      {showText && <span>{label}</span>}
    </button>
  );
}
