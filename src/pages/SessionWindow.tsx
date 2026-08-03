import { useEffect, useMemo, useRef, useState } from "react";
import Consoles from "./Consoles";
import Terminals from "./Terminals";
import { useConsoles } from "../consoles/useConsoles";
import { useTerminals, type SpawnOpts } from "../terminals/TerminalsContext";
import {
  clearSessionWindowLaunch,
  markSessionWindowAdopted,
  reportSessionWindowAdoptionFailure,
  takeSessionWindowLaunch,
  type SessionWindowLaunch,
} from "../api/sessionWindow";

export default function SessionWindow() {
  const isEngineView = useMemo(() => new URLSearchParams(window.location.search).get("catwalkEngine") === "1", []);
  const token = useMemo(() => new URLSearchParams(window.location.search).get("launch") ?? "", []);
  const launchRef = useRef<SessionWindowLaunch | null>(null);
  if (launchRef.current == null && token) {
    const cacheKey = `catwalk.sessionWindowCache.${token}`;
    const transferred = takeSessionWindowLaunch(token);
    if (transferred) {
      launchRef.current = transferred;
      try { sessionStorage.setItem(cacheKey, JSON.stringify(transferred)); } catch { /* transient cache only */ }
    } else {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        launchRef.current = cached ? JSON.parse(cached) as SessionWindowLaunch : null;
      } catch {
        launchRef.current = null;
      }
    }
  }
  const launch = launchRef.current;
  const terminals = useTerminals();
  const consoles = useConsoles();
  const consolesRef = useRef(consoles);
  consolesRef.current = consoles;
  const started = useRef(false);
  const [error, setError] = useState(launch ? "" : "Session launch information is unavailable.");

  useEffect(() => {
    if (!launch) return;
    const timer = window.setTimeout(() => clearSessionWindowLaunch(token), 10_000);
    return () => window.clearTimeout(timer);
  }, [launch, token]);

  useEffect(() => {
    if (!launch || started.current) return;
    started.current = true;
    const open = async () => {
      if (launch.kind === "terminal") {
        if (launch.ptyId != null) {
          await terminals.adopt(launch.options as unknown as SpawnOpts, launch.ptyId);
          await markSessionWindowAdopted(token);
        } else {
          await terminals.open(launch.options as unknown as SpawnOpts);
        }
      } else if (launch.kind === "terminal_group") {
        for (let index = 0; index < launch.options.length; index += 1) {
          const options = launch.options[index] as unknown as SpawnOpts;
          const ptyId = launch.ptyIds?.[index];
          if (ptyId != null) await terminals.adopt(options, ptyId);
          else await terminals.open(options);
        }
        if (launch.ptyIds?.length) await markSessionWindowAdopted(token);
      } else if (launch.kind === "vm") {
        if (launch.webviewLabel && !isEngineView) {
          await consoles.adoptEngine(launch.webviewLabel, launch);
          await markSessionWindowAdopted(token);
        } else consoles.openVm(launch.vmId, launch.title, launch.username, launch.password);
      } else if (launch.kind === "cml") {
        if (launch.webviewLabel && !isEngineView) {
          await consoles.adoptEngine(launch.webviewLabel, launch);
          await markSessionWindowAdopted(token);
        } else consoles.openCml(launch.labId, launch.nodeId, launch.title, launch.username, launch.password);
      } else if (launch.kind === "browser") {
        if (launch.webviewLabel) {
          await consoles.adoptBrowser(launch.webviewLabel, launch.url, launch.title);
          await markSessionWindowAdopted(token);
        } else {
          consoles.openBrowser(launch.url, launch.title);
        }
      } else {
        if (launch.webviewLabel && !isEngineView) {
          await consoles.adoptEngine(launch.webviewLabel, launch);
          await markSessionWindowAdopted(token);
        } else consoles.openRdp(launch.deviceId, launch.title, launch.username, launch.password);
      }
    };
    void open().catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      void reportSessionWindowAdoptionFailure(token, reason).catch(() => {});
    });
  }, [consoles, isEngineView, launch, terminals, token]);

  useEffect(() => {
    if (!isEngineView) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const unlisten = await listen<{
        command?: string;
        text?: string;
        width?: number;
        height?: number;
      }>("catwalk:remote-engine-command", (event) => {
        const currentConsoles = consolesRef.current;
        const active = currentConsoles.tabs.find((tab) => tab.id === currentConsoles.activeId);
        if (!active) return;
        if (event.payload.command === "resize") {
          window.dispatchEvent(new Event("resize"));
          active.refit?.();
          window.requestAnimationFrame(() => active.refit?.());
          window.setTimeout(() => active.refit?.(), 80);
        } else if (event.payload.command === "reconnect") active.reconnect();
        else if (event.payload.command === "ctrl-alt-del") active.sendCtrlAltDel?.();
        else if (event.payload.command === "paste" && event.payload.text) {
          active.sendClipboardText?.(event.payload.text);
        }
      });
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [isEngineView]);

  if (error) {
    return <div style={{ padding: 20, color: "var(--danger, #ff6b6b)" }}>{error}</div>;
  }
  return launch?.kind === "terminal" || launch?.kind === "terminal_group"
    ? <Terminals />
    : <Consoles />;
}
