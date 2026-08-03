import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import AppTooltip from "./components/AppTooltip";
import ContextMenu, {
  captureContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "./components/ContextMenu";
import NotesIcon, { type NotesIconName } from "./components/NotesIcon";
import { reloadAppWindow, useNavMenuItems } from "./components/navMenu";
import { AppearanceProvider, useAppearance } from "./appearance/AppearanceContext";
import { ViewModeProvider } from "./appearance/ViewModeContext";
import { TerminalsProvider, useTerminals } from "./terminals/TerminalsContext";
import { ConsolesProvider } from "./consoles/ConsolesContext";
import { useConsoles } from "./consoles/useConsoles";
import { DirectRdpProvider } from "./api/directRdp";
import { RendererLifecycleProvider } from "./renderer/RendererLifecycleContext";
import { installEditableControlCharacterGuard } from "./utils/editableText";
import { installEscapeDialogDismiss } from "./utils/escapeDialog";
import Connections from "./pages/Sessions";
import Terminals from "./pages/Terminals";
import Consoles from "./pages/Consoles";
import Templates from "./pages/Templates";
import Notebooks from "./pages/Notebooks";
import Identities from "./pages/Identities";
import Settings from "./pages/Settings";
import SftpBrowser from "./pages/SftpBrowser";

const NAVIGATION: Array<{ path: string; label: string; icon: NotesIconName }> = [
  { path: "/connections", label: "Connections", icon: "connections" },
  { path: "/sessions", label: "Sessions", icon: "sessions" },
  { path: "/remote-access", label: "Remote Access", icon: "remote-access" },
  { path: "/templates", label: "Templates", icon: "templates" },
  { path: "/notes", label: "Notes", icon: "notes" },
  { path: "/identities", label: "Identities", icon: "identities" },
];

function NavigationLink({
  path,
  label,
  icon,
  suffix,
  iconsOnly,
}: {
  path: string;
  label: string;
  icon: NotesIconName;
  suffix?: string;
  iconsOnly: boolean;
}) {
  const location = useLocation();
  const active = location.pathname === path || location.pathname.startsWith(`${path}/`);
  const accessibleLabel = `${label}${suffix ?? ""}`;
  const count = suffix?.replace(/\D/g, "");
  return (
    <Link
      className={`topbar-primary-link${active ? " active" : ""}${iconsOnly ? " topbar-primary-link--icon-only" : ""}`}
      to={path}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <NotesIcon name={icon} size={21} />
      {!iconsOnly && <span>{accessibleLabel}</span>}
      {iconsOnly && count && <span className="topbar-nav-count">{count}</span>}
    </Link>
  );
}

function Shell() {
  const { appearance, userPrefs, setUserPrefs } = useAppearance();
  const { tabs } = useTerminals();
  const { tabs: remoteTabs } = useConsoles();
  const configuredIconsOnly = appearance.topNavigationDisplay === "icons";
  const [autoCompact, setAutoCompact] = useState(false);
  const iconsOnly = configuredIconsOnly || autoCompact;
  const topbarRef = useRef<HTMLElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const navLeftRef = useRef<HTMLElement>(null);
  const navRightRef = useRef<HTMLElement>(null);
  const expandedWidthRef = useRef(0);
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const navItems = useNavMenuItems();

  useEffect(() => {
    document.title = "ConneCat";
  }, []);

  useLayoutEffect(() => {
    if (configuredIconsOnly) {
      setAutoCompact(false);
      return;
    }
    const topbar = topbarRef.current;
    const brand = brandRef.current;
    const navLeft = navLeftRef.current;
    const navRight = navRightRef.current;
    if (!topbar || !brand || !navLeft || !navRight) return;

    const expandedWidth = () => {
      const style = getComputedStyle(topbar);
      const gap = parseFloat(style.columnGap || style.gap) || 0;
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      return padding + brand.scrollWidth + navLeft.scrollWidth + navRight.scrollWidth + gap * 2;
    };
    const update = () => {
      if (!autoCompact) {
        const required = expandedWidth();
        expandedWidthRef.current = required;
        if (required > topbar.clientWidth) setAutoCompact(true);
      } else if (topbar.clientWidth >= expandedWidthRef.current + 8) {
        setAutoCompact(false);
      }
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(topbar);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [autoCompact, configuredIconsOnly, remoteTabs.length, tabs.length]);

  const openTopbarMenu = (event: React.MouseEvent) => {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        ...navItems,
        { divider: true },
        {
          label: "Top navigation",
          icon: <NotesIcon name="legend" size={16} />,
          children: [
            {
              label: `${configuredIconsOnly ? "" : "✓ "}Icons and text`,
              disabled: !configuredIconsOnly,
              onClick: () => setUserPrefs({ ...userPrefs, topNavigationDisplay: "iconsAndText" }),
            },
            {
              label: `${configuredIconsOnly ? "✓ " : ""}Icons only`,
              disabled: configuredIconsOnly,
              onClick: () => setUserPrefs({ ...userPrefs, topNavigationDisplay: "icons" }),
            },
          ],
        },
        { divider: true },
        { label: "Reload window", onClick: reloadAppWindow },
      ],
    });
  };

  return (
    <div className="app">
      <header ref={topbarRef} className="topbar" data-tauri-drag-region onContextMenu={openTopbarMenu}>
        <div ref={brandRef} className="brand-wrap">
          <img className="brand-logo" src="/connecat.png" alt="" />
          <span className="brand">ConneCat</span>
        </div>
        <nav ref={navLeftRef} className="nav-left">
          {NAVIGATION.map((item) => (
            <NavigationLink
              key={item.path}
              {...item}
              iconsOnly={iconsOnly}
              suffix={item.path === "/sessions" && tabs.length
                ? ` (${tabs.length})`
                : item.path === "/remote-access" && remoteTabs.length
                  ? ` (${remoteTabs.length})`
                  : undefined}
            />
          ))}
        </nav>
        <nav ref={navRightRef} className="nav-right">
          <NavigationLink path="/settings" label="Settings" icon="settings" iconsOnly={iconsOnly} />
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/connections" replace />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/sessions" element={<Terminals />} />
          <Route path="/remote-access" element={<Consoles />} />
          <Route path="/sftp" element={<SftpBrowser />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/notes" element={<Notebooks />} />
          <Route path="/notebooks" element={<Navigate to="/notes" replace />} />
          <Route path="/identities" element={<Identities />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/connections" replace />} />
        </Routes>
      </main>
      <footer className="statusbar">
        <span>Standalone · local data only · v{__APP_VERSION__}</span>
        <span style={{ marginLeft: "auto" }}>{appearance.colorScheme}</span>
      </footer>
      {menu && <ContextMenu position={menu.pos} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function AppSurface() {
  useEffect(() => installEditableControlCharacterGuard(), []);
  useEffect(() => installEscapeDialogDismiss(), []);
  return <Shell />;
}

export default function App() {
  return (
    <AppearanceProvider>
      <ViewModeProvider>
        <TerminalsProvider>
          <ConsolesProvider>
            <DirectRdpProvider>
              <RendererLifecycleProvider>
                <AppSurface />
                <AppTooltip />
              </RendererLifecycleProvider>
            </DirectRdpProvider>
          </ConsolesProvider>
        </TerminalsProvider>
      </ViewModeProvider>
    </AppearanceProvider>
  );
}
