import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ViewMode = "list" | "compact" | "focus";

const STORAGE_KEY = "catwalk.viewMode";

interface Ctx {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
}

const ViewModeContext = createContext<Ctx | null>(null);

export function useViewMode(): Ctx {
  const c = useContext(ViewModeContext);
  if (!c) throw new Error("ViewModeProvider missing");
  return c;
}

function load(): ViewMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === "focus" || raw === "compact" ? raw : "list";
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => load());

  // Reflect tab-to-tab changes (e.g. opening Settings in two windows). The
  // storage event only fires for OTHER documents, so this is a no-op when
  // the user uses the in-app toggle.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setViewModeState(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setViewMode = useCallback((m: ViewMode) => {
    setViewModeState(m);
    if (m === "list") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, m);
  }, []);

  const value = useMemo(() => ({ viewMode, setViewMode }), [viewMode, setViewMode]);
  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}
