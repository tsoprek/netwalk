import { createContext } from "react";
import type { Terminal } from "@xterm/xterm";

export type ConsoleKind = "vm" | "cml" | "rdp" | "browser" | "sftp";
export type RdpKeyboardLayout = "failsafe" | "en-us-qwerty" | "guacd-default";
export type RdpCompatibilityMode = "standard" | "xrdp-safe";

export interface ConsoleViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConsoleTab {
  id: number;
  kind: ConsoleKind;
  title: string;
  /// VM tabs only.
  vmId?: string;
  vmUsername?: string;
  /// CML tabs only.
  labId?: number;
  nodeId?: string;
  /// RDP tabs only.
  deviceId?: string;
  rdpUsername?: string;
  rdpKeyboardLayout?: RdpKeyboardLayout;
  rdpCompatibilityMode?: RdpCompatibilityMode;
  /// Browser tabs only.
  browserUrl?: string;
  /// SFTP tabs only - connection target (a device id, or a direct host).
  sftpDeviceId?: string;
  sftpHost?: string;
  sftpPort?: number;
  sftpUser?: string;
  sftpKeyPath?: string;
  sftpPassword?: string;
  sftpAutoConnect?: boolean;
  /// Persistent DOM element the widget renders into. Reparented by the
  /// Consoles page when active; stays in the stash otherwise so the
  /// widget keeps its dimensions and event handlers across navigations.
  host: HTMLDivElement;
  status: string;
  error: string;
  disconnected: boolean;
  /// Force a fresh ticket + reconnect. Safe to call any time.
  reconnect: () => void;
  /// Embedded surfaces such as SFTP report their connection lifecycle back to
  /// the owning tab so Remote Access can display the shared session health UI.
  reportHealth?: (status: string, error?: string, disconnected?: boolean) => void;
  /// VM/RDP tabs only - synthesise a Ctrl+Alt+Del keystroke.
  sendCtrlAltDel?: () => void;
  /// CML tabs only - the live xterm.js instance backing the host.
  /// Exposed so the Consoles page can read selection / clear scrollback
  /// directly from its context menu.
  term?: Terminal;
  /// CML tabs only - send a buffer to the upstream WebSocket. When
  /// `lineDelayMs > 0`, splits on newlines and paces lines with a CR
  /// between them (mirrors the Sessions pane's template send).
  sendText?: (text: string, lineDelayMs?: number) => Promise<void>;
  /// VM/RDP tabs only - paste local plain text into the remote session.
  sendClipboardText?: (text: string) => void;
  /// VM tabs only - satisfy a pending vCenter login prompt before WebMKS
  /// exists. Returns false when no login prompt is currently waiting.
  submitLoginCredentials?: (credentials: { username: string; password: string }) => boolean;
  /// RDP tabs only - change the server keyboard layout and reconnect.
  setRdpKeyboardLayout?: (layout: RdpKeyboardLayout) => void;
  /// RDP tabs only - change RDP compatibility flags and reconnect.
  setRdpCompatibilityMode?: (mode: RdpCompatibilityMode) => void;
  /// CML tabs only - returns the last non-empty selection captured
  /// from xterm's `onSelectionChange`. Right-click clears xterm's own
  /// internal selection synchronously, so the menu reads this cache.
  getLastSelection?: () => string;
  /// Re-fit the console to the host's current size. Called after the
  /// host is reparented into the visible viewport so mouse hit-testing
  /// and display scaling match the new geometry.
  refit?: (bounds?: ConsoleViewportBounds) => void | Promise<void>;
  /// Activate/deactivate expensive rendering when the tab becomes active or
  /// the Remote Access page unmounts. Native sessions show/hide their child
  /// webview; CML switches between the canvas and DOM xterm renderers.
  setVisible?: (visible: boolean) => void | Promise<void>;
  /// Tell an embedded ConnCat engine which visible shell owns its drop area.
  /// Tauri's current-window label remains stale after WebView reparenting.
  setDropTargetShell?: (shellId: string | null) => void;
  /// Reserve space on the right for application-shell popovers such as Help
  /// and Notifications. Native child WebViews cannot sit behind DOM overlays.
  setShellOverlayOpen?: (open: boolean) => void | Promise<void>;
  /// Browser tabs only - move focus into the embedded browser surface.
  focusBrowser?: () => void;
  /// Browser tabs only - clear webview browsing data/cookies and reload.
  clearBrowserData?: () => void;
  /// Label of the live native webview. Browser, VM, CML and RDP sessions use
  /// this to transfer ownership without reloading/reconnecting.
  nativeWebviewLabel?: string;
  /// Tear down the connection and free engine resources. Called by close().
  destroy: () => void;
}

export interface ConsolesContextValue {
  tabs: ConsoleTab[];
  activeId: number | null;
  setActive: (id: number) => void;
  reorderTab: (draggedId: number, targetId?: number, placement?: "before" | "after") => void;
  /// Open (or focus an existing) VM console tab. Returns the tab id.
  openVm: (vmId: string, label?: string, username?: string, password?: string) => number;
  /// Open (or focus an existing) CML node console tab. Returns the tab id.
  openCml: (labId: number, nodeId: string, label?: string, username?: string, password?: string) => number;
  /// Open (or focus an existing) in-app RDP console tab. Returns the tab id.
  openRdp: (deviceId: string, label?: string, username?: string, password?: string) => number;
  /// Open (or focus an existing) in-app browser tab. Returns the tab id.
  openBrowser: (url: string, label?: string) => number;
  /// Open (or focus an existing) in-app SFTP file-browser tab. Returns the
  /// tab id. The provider keeps the React SFTP browser mounted in a detached
  /// host (no native webview), so connections and transfers survive navigation.
  openSftp: (opts: {
    deviceId?: string;
    host?: string;
    port?: number;
    user?: string;
    keyPath?: string;
    password?: string;
    autoConnect?: boolean;
    title: string;
  }) => number;
  /// Adopt an already-running browser webview into this ConnCat window.
  /// The page, cookies, JavaScript state, and authenticated session survive.
  adoptBrowser: (webviewLabel: string, url: string, label?: string) => Promise<number>;
  adoptEngine: (webviewLabel: string, launch: import("../api/sessionWindow").SessionWindowLaunch) => Promise<number>;
  close: (id: number) => void;
  /// Remove local tab ownership without destroying its live engine.
  release: (id: number) => void;
}

export function destroyConsoleTabOnce(
  tab: ConsoleTab,
  destroyedTabs: WeakSet<ConsoleTab>,
): boolean {
  if (destroyedTabs.has(tab)) return false;
  destroyedTabs.add(tab);
  try { tab.destroy(); } catch { /* best-effort cleanup continues below */ }
  try { tab.host.remove(); } catch { /* host already detached */ }
  return true;
}

export const ConsolesContext = createContext<ConsolesContextValue | null>(null);
