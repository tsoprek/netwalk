import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AppearanceConfig,
  ResolvedAppearance,
  applyThemeSchedule,
  applyToDocument,
  loadUserPrefs,
  resolveAppearance,
  saveUserPrefs,
} from "../api/appearance";
import { PRODUCTION_THEME_SCHEME_OVERRIDES } from "../theme/productionThemeSchemes";

const STANDALONE_APPEARANCE_CONFIG: AppearanceConfig = {
  themeSchemeOverrides: PRODUCTION_THEME_SCHEME_OVERRIDES,
};

interface Ctx {
  appearance: ResolvedAppearance;
  serverConfig: AppearanceConfig;
  userPrefs: AppearanceConfig;
  setUserPrefs: (next: AppearanceConfig) => void;
  refreshServer: () => Promise<void>;
}

const AppearanceContext = createContext<Ctx | null>(null);

export function useAppearance(): Ctx {
  const c = useContext(AppearanceContext);
  if (!c) throw new Error("AppearanceProvider missing");
  return c;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [userPrefs, setUserPrefsState] = useState<AppearanceConfig>(() => loadUserPrefs());
  const [serverConfig, setServerConfig] = useState<AppearanceConfig>(STANDALONE_APPEARANCE_CONFIG);
  const [scheduleClock, setScheduleClock] = useState(() => Date.now());

  const refreshServer = useCallback(async () => {
    // ConneCat has no broker or remote configuration source. Keep the local
    // production-palette mirror as the standalone server configuration.
    setServerConfig(STANDALONE_APPEARANCE_CONFIG);
  }, []);

  useEffect(() => {
    if (!userPrefs.themeSchedule?.enabled) return;
    const refreshClock = () => setScheduleClock(Date.now());
    refreshClock();
    const timer = window.setInterval(refreshClock, 30_000);
    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", refreshClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", refreshClock);
    };
  }, [userPrefs.themeSchedule?.enabled]);

  const effectiveUserPrefs = useMemo(
    () => applyThemeSchedule(userPrefs, new Date(scheduleClock)),
    [scheduleClock, userPrefs],
  );

  const appearance = useMemo(
    () => resolveAppearance(serverConfig, effectiveUserPrefs),
    [effectiveUserPrefs, serverConfig],
  );

  useEffect(() => {
    applyToDocument(appearance);

    // The standard macOS title bar can follow Aqua/Dark Aqua, but cannot be
    // assigned ConneCat's arbitrary brand palette. Keep native traffic lights,
    // title text, menus, and window chrome aligned with the selected scheme;
    // Medium intentionally uses dark native chrome.
    const isTauri = typeof window !== "undefined"
      && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    const isMac = typeof navigator !== "undefined"
      && /Macintosh|Mac OS X/i.test(navigator.userAgent);
    if (!isTauri || !isMac) return;

    let cancelled = false;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        if (cancelled) return;
        await getCurrentWindow().setTheme(appearance.colorScheme === "light" ? "light" : "dark");
      })
      .catch(() => {
        // Browser previews and older native runtimes may not expose window
        // theming. The CSS theme remains fully functional in that case.
      });
    return () => {
      cancelled = true;
    };
  }, [appearance]);

  const setUserPrefs = useCallback((next: AppearanceConfig) => {
    setUserPrefsState(next);
    saveUserPrefs(next);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ appearance, serverConfig, userPrefs, setUserPrefs, refreshServer }),
    [appearance, serverConfig, userPrefs, setUserPrefs, refreshServer],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
