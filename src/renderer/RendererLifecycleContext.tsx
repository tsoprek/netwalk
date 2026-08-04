import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTerminals } from "../terminals/TerminalsContext";
import { useConsoles } from "../consoles/useConsoles";
import { diagnosticEvent } from "../api/diagnostics";
import {
  clearRendererHandoff,
  consumeRestoredRendererHandoff,
  createRendererHandoff,
  getRendererLifecycleStatus,
  isTauriRuntime,
  markRendererAutoReset,
  newRendererResetId,
  rendererAutoRateLimited,
  rendererAutoRecoveryEnabled,
  rendererChurnScore,
  resetMainRenderer,
  setRendererAutoRecoveryEnabled,
  setRendererChurnScore,
  storeRendererHandoff,
  type RendererBlocker,
  type RendererLifecycleStatus,
  type RendererResetResponse,
} from "../api/rendererLifecycle";
import { automaticRendererResetEligible, frontendRendererBlockers } from "./rendererLifecyclePolicy";

const BACKGROUND_RESET_DELAY_MS = 5 * 60_000;
const LARGE_RESIZE_RATIO = 0.10;

interface RendererLifecycleContextValue {
  status: RendererLifecycleStatus | null;
  autoEnabled: boolean;
  resetting: boolean;
  churnScore: number;
  refreshStatus: () => Promise<RendererLifecycleStatus>;
  setAutoEnabled: (enabled: boolean) => void;
  reset: (reason: "manual" | "background_idle", settingsDirty?: boolean) => Promise<RendererResetResponse>;
}

const Context = createContext<RendererLifecycleContextValue | null>(null);

function openApplicationDialog(): boolean {
  return [...document.querySelectorAll<HTMLElement>("[role='dialog'], .app-dialog-backdrop, .modal-backdrop")]
    .some((element) => !element.closest("[data-renderer-reset-dialog]"));
}

function rejected(resetId: string, blockers: RendererBlocker[], message?: string): RendererResetResponse {
  return { accepted: false, resetId, blockers, message };
}

export function RendererLifecycleProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { tabs: terminalTabs } = useTerminals();
  const { tabs: consoleTabs } = useConsoles();
  const deploy = { busy: false, activeDeployments: 0, modalOpen: false, historyOpen: false };
  const [status, setStatus] = useState<RendererLifecycleStatus | null>(null);
  const [autoEnabled, setAutoEnabledState] = useState(rendererAutoRecoveryEnabled);
  const [resetting, setResetting] = useState(false);
  const [churnScore, setChurnScoreState] = useState(rendererChurnScore);
  const routeRef = useRef(`${location.pathname}${location.search}${location.hash}`);
  const pathnameRef = useRef(location.pathname);
  const windowFocusedRef = useRef(document.hasFocus());
  const backgroundSinceRef = useRef<number | null>(
    document.visibilityState === "hidden" || !document.hasFocus() ? Date.now() : null,
  );
  const autoTimerRef = useRef<number | null>(null);
  const previousPathRef = useRef(location.pathname);
  const previousSizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });

  const updateChurn = useCallback((increment: number) => {
    setChurnScoreState((current) => {
      const next = Math.min(100, current + increment);
      setRendererChurnScore(next);
      return next;
    });
  }, []);

  useEffect(() => {
    routeRef.current = `${location.pathname}${location.search}${location.hash}`;
    pathnameRef.current = location.pathname;
    if (previousPathRef.current !== location.pathname) {
      previousPathRef.current = location.pathname;
      updateChurn(1);
    }
  }, [location.hash, location.pathname, location.search, updateChurn]);

  useEffect(() => {
    let timer = 0;
    const resized = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const previous = previousSizeRef.current;
        const next = { width: window.innerWidth, height: window.innerHeight };
        previousSizeRef.current = next;
        const widthRatio = Math.abs(next.width - previous.width) / Math.max(1, previous.width);
        const heightRatio = Math.abs(next.height - previous.height) / Math.max(1, previous.height);
        if (Math.max(widthRatio, heightRatio) >= LARGE_RESIZE_RATIO) updateChurn(1);
      }, 500);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
      window.clearTimeout(timer);
    };
  }, [updateChurn]);

  const refreshStatus = useCallback(async () => {
    const next = await getRendererLifecycleStatus();
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    void refreshStatus().catch((error) => {
      diagnosticEvent("core_ui", "warn", "renderer.lifecycle", "Could not read renderer reset status", {
        error: String(error),
      });
    });
  }, [refreshStatus]);

  useEffect(() => {
    const handoff = consumeRestoredRendererHandoff();
    if (!handoff) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        const content = document.querySelector<HTMLElement>(".app > main");
        if (content) content.scrollTo(handoff.scrollX, handoff.scrollY);
        else window.scrollTo(handoff.scrollX, handoff.scrollY);
      });
    });
    diagnosticEvent("core_ui", "info", "renderer.lifecycle", "Renderer handoff restored", {
      reset_id: handoff.resetId,
      restored_route: handoff.route,
      handoff_age_ms: Date.now() - handoff.timestamp,
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);

  const reset = useCallback(async (
    reason: "manual" | "background_idle",
    settingsDirty = false,
  ): Promise<RendererResetResponse> => {
    const resetId = newRendererResetId();
    const frontendBlockers = frontendRendererBlockers({
      terminalTabs: terminalTabs.length,
      consoleTabs: consoleTabs.length,
      deploymentBusy: deploy.busy,
      activeDeployments: deploy.activeDeployments,
      deploymentDialogs: deploy.modalOpen || deploy.historyOpen,
      settingsDirty,
      dialogOpen: openApplicationDialog(),
    });
    if (frontendBlockers.length > 0) {
      return rejected(resetId, frontendBlockers, "Renderer memory cannot be reclaimed while ConnCat has active work.");
    }

    let nativeStatus: RendererLifecycleStatus;
    try {
      nativeStatus = await refreshStatus();
    } catch (error) {
      return rejected(resetId, [{ code: "status_unavailable", count: 1, message: String(error) }]);
    }
    if (!nativeStatus.supported) {
      return rejected(resetId, [{ code: "unsupported_platform", count: 1, message: "Available only on macOS" }]);
    }
    if (nativeStatus.resetInProgress || nativeStatus.blockers.length > 0) {
      return rejected(resetId, nativeStatus.blockers.length > 0 ? nativeStatus.blockers : [{
        code: "reset_in_progress",
        count: 1,
        message: "A renderer reset is already in progress",
      }]);
    }

    const handoff = createRendererHandoff(resetId);
    storeRendererHandoff(handoff);
    diagnosticEvent("core_ui", "info", "renderer.lifecycle", "Renderer reset requested", {
      reset_id: resetId,
      reason,
      route: handoff.route,
      churn_score: churnScore,
      terminal_tabs: terminalTabs.length,
      remote_tabs: consoleTabs.length,
      active_deployments: deploy.activeDeployments,
      native_blockers: nativeStatus.blockers.length,
    });
    try {
      const response = await resetMainRenderer({
        resetId,
        reason,
        route: handoff.route,
        churnScore,
      });
      if (!response.accepted) {
        clearRendererHandoff();
        setStatus((current) => current ? { ...current, blockers: response.blockers } : current);
        return response;
      }
      setResetting(true);
      setRendererChurnScore(0);
      setChurnScoreState(0);
      if (reason === "background_idle") markRendererAutoReset();
      return response;
    } catch (error) {
      clearRendererHandoff();
      diagnosticEvent("core_ui", "error", "renderer.lifecycle", "Renderer reset request failed", {
        reset_id: resetId,
        error: String(error),
      });
      return rejected(resetId, [{ code: "request_failed", count: 1, message: String(error) }]);
    }
  }, [churnScore, consoleTabs.length, deploy.activeDeployments, deploy.busy, deploy.historyOpen, deploy.modalOpen, refreshStatus, terminalTabs.length]);

  const resetRef = useRef(reset);
  const autoEnabledRef = useRef(autoEnabled);
  const churnRef = useRef(churnScore);
  useEffect(() => { resetRef.current = reset; }, [reset]);
  useEffect(() => { autoEnabledRef.current = autoEnabled; }, [autoEnabled]);
  useEffect(() => { churnRef.current = churnScore; }, [churnScore]);

  useEffect(() => {
    let disposed = false;
    let stopNativeFocusListener: (() => void) | undefined;
    const clearTimer = () => {
      if (autoTimerRef.current != null) window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    };
    const isBackground = () =>
      document.visibilityState === "hidden" || !windowFocusedRef.current;
    const schedule = () => {
      clearTimer();
      if (!autoEnabledRef.current || !isBackground()) return;
      backgroundSinceRef.current ??= Date.now();
      const elapsed = Date.now() - backgroundSinceRef.current;
      autoTimerRef.current = window.setTimeout(async () => {
        if (!isBackground()) return;
        const backgroundForMs = Date.now() - (backgroundSinceRef.current ?? Date.now());
        const routeDirty = document.querySelector('[data-renderer-reset-dirty="true"]') !== null;
        const baseBlockers = frontendRendererBlockers({
          terminalTabs: terminalTabs.length,
          consoleTabs: consoleTabs.length,
          deploymentBusy: deploy.busy,
          activeDeployments: deploy.activeDeployments,
          deploymentDialogs: deploy.modalOpen || deploy.historyOpen,
          settingsDirty: routeDirty,
          dialogOpen: openApplicationDialog(),
        });
        if (!automaticRendererResetEligible({
          enabled: autoEnabledRef.current,
          backgroundForMs,
          route: pathnameRef.current,
          churnScore: churnRef.current,
          rateLimited: rendererAutoRateLimited(),
          blockerCount: baseBlockers.length,
        })) return;
        await resetRef.current("background_idle", routeDirty);
      }, Math.max(0, BACKGROUND_RESET_DELAY_MS - elapsed));
    };
    const backgroundChanged = () => {
      if (isBackground()) {
        backgroundSinceRef.current ??= Date.now();
        schedule();
      } else {
        backgroundSinceRef.current = null;
        clearTimer();
      }
    };
    const focused = () => {
      windowFocusedRef.current = true;
      backgroundChanged();
    };
    const blurred = () => {
      windowFocusedRef.current = false;
      backgroundChanged();
    };

    document.addEventListener("visibilitychange", backgroundChanged);
    window.addEventListener("focus", focused);
    window.addEventListener("blur", blurred);
    if (isTauriRuntime()) {
      const appWindow = getCurrentWindow();
      void appWindow.isFocused().then((isFocused) => {
        if (disposed) return;
        windowFocusedRef.current = isFocused;
        backgroundChanged();
      });
      void appWindow.onFocusChanged(({ payload: isFocused }) => {
        windowFocusedRef.current = isFocused;
        backgroundChanged();
      }).then((unlisten) => {
        if (disposed) unlisten();
        else stopNativeFocusListener = unlisten;
      });
    }
    backgroundChanged();
    return () => {
      disposed = true;
      stopNativeFocusListener?.();
      document.removeEventListener("visibilitychange", backgroundChanged);
      window.removeEventListener("focus", focused);
      window.removeEventListener("blur", blurred);
      clearTimer();
    };
  }, [autoEnabled, consoleTabs.length, deploy.activeDeployments, deploy.busy, deploy.historyOpen, deploy.modalOpen, terminalTabs.length]);

  const setAutoEnabled = useCallback((enabled: boolean) => {
    setRendererAutoRecoveryEnabled(enabled);
    setAutoEnabledState(enabled);
  }, []);

  const value = useMemo<RendererLifecycleContextValue>(() => ({
    status,
    autoEnabled,
    resetting,
    churnScore,
    refreshStatus,
    setAutoEnabled,
    reset,
  }), [autoEnabled, churnScore, refreshStatus, reset, resetting, setAutoEnabled, status]);

  return (
    <Context.Provider value={value}>
      {children}
      {resetting && (
        <div className="renderer-reset-overlay" role="status" aria-live="assertive">
          <span className="spinner" aria-hidden="true" />
          <strong>Reclaiming renderer memory…</strong>
        </div>
      )}
    </Context.Provider>
  );
}

export function useRendererLifecycle(): RendererLifecycleContextValue {
  const context = useContext(Context);
  if (!context) throw new Error("RendererLifecycleProvider missing");
  return context;
}
