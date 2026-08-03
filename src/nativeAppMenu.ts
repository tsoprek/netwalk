import type { WorkspaceDesign } from "./api/appearance";
import type { ViewMode } from "./appearance/ViewModeContext";

export interface NativeAppMenuOptions {
  viewMode: ViewMode;
  workspaceDesign: WorkspaceDesign;
  topNavigationDisplay: "icons" | "iconsAndText";
  terminalToolbarDisplay: "icons" | "iconsAndText";
  connectionsToolbarDisplay: "icons" | "iconsAndText";
  onSettings: () => void;
  onReload: () => void;
  onViewMode: (mode: ViewMode) => void;
  onWorkspaceDesign: (design: WorkspaceDesign) => void;
  onTopNavigationDisplay: (mode: "icons" | "iconsAndText") => void;
  onTerminalToolbarDisplay: (mode: "icons" | "iconsAndText") => void;
  onConnectionsToolbarDisplay: (mode: "icons" | "iconsAndText") => void;
}

export async function installNativeAppMenu(options: NativeAppMenuOptions) {
  const {
    CheckMenuItem,
    Menu,
    MenuItem,
    PredefinedMenuItem,
    Submenu,
  } = await import("@tauri-apps/api/menu");

  const separator = () => PredefinedMenuItem.new({ item: "Separator" });
  const item = (id: string, text: string, action: () => void, accelerator?: string) =>
    MenuItem.new({ id, text, action, accelerator });
  const check = (
    id: string,
    text: string,
    checked: boolean,
    action: () => void,
  ) => CheckMenuItem.new({ id, text, checked, action });

  const appMenu = await Submenu.new({
    id: "connecat-menu",
    text: "ConneCat",
    items: [
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: "ConneCat",
            version: __APP_VERSION__,
            comments: "Local-first standalone remote access workspace",
          },
        },
        text: "About ConneCat",
      }),
      await separator(),
      await item("connecat-settings", "Settings…", options.onSettings, "CmdOrCtrl+,"),
      await separator(),
      await PredefinedMenuItem.new({ item: "Services" }),
      await separator(),
      await PredefinedMenuItem.new({ item: "Hide", text: "Hide ConneCat" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await separator(),
      await PredefinedMenuItem.new({ item: "Quit", text: "Quit ConneCat" }),
    ],
  });

  const editMenu = await Submenu.new({
    id: "edit-menu",
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await separator(),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
    ],
  });

  const workspaceMenu = await Submenu.new({
    id: "view-workspace-menu",
    text: "Workspace",
    items: [
      await check(
        "view-workspace-quiet",
        "Quiet Workspace",
        options.workspaceDesign === "quiet",
        () => options.onWorkspaceDesign("quiet"),
      ),
      await check(
        "view-workspace-structured",
        "Structured Split Pane",
        options.workspaceDesign === "structured",
        () => options.onWorkspaceDesign("structured"),
      ),
      await check(
        "view-workspace-command-center",
        "Compact Command Center",
        options.workspaceDesign === "commandCenter",
        () => options.onWorkspaceDesign("commandCenter"),
      ),
    ],
  });

  const viewModeMenu = await Submenu.new({
    id: "view-mode-menu",
    text: "Layout",
    items: [
      await check("view-layout-list", "List", options.viewMode === "list", () => options.onViewMode("list")),
      await check("view-layout-compact", "Compact List", options.viewMode === "compact", () => options.onViewMode("compact")),
      await check("view-layout-focus", "Focus Cards", options.viewMode === "focus", () => options.onViewMode("focus")),
    ],
  });

  const topNavigationMenu = await Submenu.new({
    id: "view-top-navigation-menu",
    text: "Top Navigation",
    items: [
      await check(
        "view-top-navigation-icons-text",
        "Icons and Text",
        options.topNavigationDisplay === "iconsAndText",
        () => options.onTopNavigationDisplay("iconsAndText"),
      ),
      await check(
        "view-top-navigation-icons",
        "Icons Only",
        options.topNavigationDisplay === "icons",
        () => options.onTopNavigationDisplay("icons"),
      ),
    ],
  });

  const terminalToolbarMenu = await Submenu.new({
    id: "view-terminal-toolbar-menu",
    text: "Session Toolbar",
    items: [
      await check(
        "view-terminal-toolbar-icons-text",
        "Icons and Text",
        options.terminalToolbarDisplay === "iconsAndText",
        () => options.onTerminalToolbarDisplay("iconsAndText"),
      ),
      await check(
        "view-terminal-toolbar-icons",
        "Icons Only",
        options.terminalToolbarDisplay === "icons",
        () => options.onTerminalToolbarDisplay("icons"),
      ),
    ],
  });

  const connectionsToolbarMenu = await Submenu.new({
    id: "view-connections-toolbar-menu",
    text: "Connection Toolbar",
    items: [
      await check(
        "view-connections-toolbar-icons-text",
        "Icons and Text",
        options.connectionsToolbarDisplay === "iconsAndText",
        () => options.onConnectionsToolbarDisplay("iconsAndText"),
      ),
      await check(
        "view-connections-toolbar-icons",
        "Icons Only",
        options.connectionsToolbarDisplay === "icons",
        () => options.onConnectionsToolbarDisplay("icons"),
      ),
    ],
  });

  const viewMenu = await Submenu.new({
    id: "view-menu",
    text: "View",
    items: [
      workspaceMenu,
      viewModeMenu,
      topNavigationMenu,
      terminalToolbarMenu,
      connectionsToolbarMenu,
      await separator(),
      await item("view-reload", "Reload ConneCat", options.onReload, "CmdOrCtrl+R"),
      await PredefinedMenuItem.new({ item: "Fullscreen" }),
    ],
  });

  const windowMenu = await Submenu.new({
    id: "window-menu",
    text: "Window",
    items: [
      await PredefinedMenuItem.new({ item: "Minimize" }),
      await PredefinedMenuItem.new({ item: "Maximize", text: "Zoom" }),
      await separator(),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
      await PredefinedMenuItem.new({ item: "BringAllToFront" }),
    ],
  });

  const menu = await Menu.new({
    id: "connecat-app-menu",
    items: [appMenu, editMenu, viewMenu, windowMenu],
  });
  const previous = await menu.setAsAppMenu();
  await windowMenu.setAsWindowsMenuForNSApp();
  if (previous) await previous.close();
  return menu;
}
