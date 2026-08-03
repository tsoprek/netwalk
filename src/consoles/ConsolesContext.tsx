import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import SftpBrowser from "../pages/SftpBrowser";
import type { SessionWindowLaunch } from "../api/sessionWindow";
import {
  ConsolesContext,
  destroyConsoleTabOnce,
  type ConsoleTab,
  type ConsolesContextValue,
} from "./ConsolesContextCore";
import { getConsoleStash } from "./consoleStash";

function newHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "console-persistent-host";
  host.style.width = "100%";
  host.style.height = "100%";
  getConsoleStash().appendChild(host);
  return host;
}

export function ConsolesProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<ConsoleTab[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const nextId = useRef(1);
  const tabsRef = useRef<ConsoleTab[]>([]);
  const destroyed = useRef(new WeakSet<ConsoleTab>());
  tabsRef.current = tabs;

  const updateHealth = useCallback((id: number, status: string, error = "", disconnected = false) => {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, status, error, disconnected } : tab));
  }, []);

  const openBrowser = useCallback((url: string, label?: string): number => {
    const existing = tabsRef.current.find((tab) => tab.kind === "browser" && tab.browserUrl === url);
    if (existing) { setActiveId(existing.id); return existing.id; }
    const id = nextId.current++;
    const host = newHost();
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.title = label || url;
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.border = "0";
    host.appendChild(frame);
    const tab: ConsoleTab = {
      id,
      kind: "browser",
      title: label || new URL(url).hostname,
      browserUrl: url,
      host,
      status: "Open",
      error: "",
      disconnected: false,
      reconnect: () => { frame.src = url; },
      focusBrowser: () => frame.focus(),
      destroy: () => { frame.src = "about:blank"; frame.remove(); },
    };
    setTabs((current) => [...current, tab]);
    setActiveId(id);
    return id;
  }, []);

  const openSftp = useCallback((options: Parameters<ConsolesContextValue["openSftp"]>[0]): number => {
    const id = nextId.current++;
    const host = newHost();
    let reconnect = () => {};
    const tab: ConsoleTab = {
      id,
      kind: "sftp",
      title: options.title,
      sftpHost: options.host,
      sftpPort: options.port,
      sftpUser: options.user,
      sftpKeyPath: options.keyPath,
      sftpPassword: options.password,
      sftpAutoConnect: options.autoConnect,
      host,
      status: "Ready",
      error: "",
      disconnected: false,
      reconnect: () => reconnect(),
      reportHealth: (status, error, disconnected) => updateHealth(id, status, error, disconnected),
      destroy: () => {},
    };
    reconnect = () => updateHealth(id, "Reconnect requested", "", false);
    setTabs((current) => [...current, tab]);
    setActiveId(id);
    return id;
  }, [updateHealth]);

  const close = useCallback((id: number) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (tab) destroyConsoleTabOnce(tab, destroyed.current);
    setTabs((current) => {
      const next = current.filter((item) => item.id !== id);
      setActiveId((active) => active === id ? next[next.length - 1]?.id ?? null : active);
      return next;
    });
  }, []);

  const release = useCallback((id: number) => close(id), [close]);

  useEffect(() => () => {
    for (const tab of tabsRef.current) destroyConsoleTabOnce(tab, destroyed.current);
  }, []);

  const unavailable = useCallback(() => -1, []);
  const value = useMemo<ConsolesContextValue>(() => ({
    tabs,
    activeId,
    setActive: setActiveId,
    reorderTab: (draggedId, targetId, placement = "before") => setTabs((current) => {
      const dragged = current.find((tab) => tab.id === draggedId);
      if (!dragged) return current;
      const rest = current.filter((tab) => tab.id !== draggedId);
      if (targetId == null) return [...rest, dragged];
      const index = rest.findIndex((tab) => tab.id === targetId);
      if (index < 0) return [...rest, dragged];
      rest.splice(index + (placement === "after" ? 1 : 0), 0, dragged);
      return rest;
    }),
    openVm: unavailable,
    openCml: unavailable,
    openRdp: unavailable,
    openBrowser,
    openSftp,
    adoptBrowser: async (_webviewLabel, url, label) => openBrowser(url, label),
    adoptEngine: async (_webviewLabel: string, _launch: SessionWindowLaunch) => {
      throw new Error("Broker console engines are not part of standalone ConneCat.");
    },
    close,
    release,
  }), [activeId, close, openBrowser, openSftp, release, tabs, unavailable]);

  return <ConsolesContext.Provider value={value}>
    {children}
    {tabs.filter((tab) => tab.kind === "sftp").map((tab) => createPortal(
      <SftpBrowser
        embedded
        host={tab.sftpHost}
        port={tab.sftpPort}
        user={tab.sftpUser}
        keyPath={tab.sftpKeyPath}
        initialPassword={tab.sftpPassword}
        autoConnect={tab.sftpAutoConnect}
        name={tab.title}
        onClose={() => close(tab.id)}
        onHealthChange={tab.reportHealth}
      />,
      tab.host,
      tab.id,
    ))}
  </ConsolesContext.Provider>;
}
