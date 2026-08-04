import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAppearance } from "../appearance/AppearanceContext";
import {
  AppearanceConfig,
  ColorScheme,
  DEFAULTS,
  clearUserPrefs,
  disableThemeSchedule,
  ThemePreset,
  type ScheduledThemeTarget,
  type ThemeSchedule,
  type EntityDoubleClickAction,
  type IconEffect,
  type IconPresentationStyle,
  type PageTitleColor,
  type PageTitleStyle,
  type RdpOpenMode,
  type SessionGroupDoubleClickAction,
  type SessionGroupMiddleClickAction,
  type TerminalSidebarClickBehavior,
  type TerminalRenderer,
  type VmPowerControlStyle,
  type SwitchButtonStyle,
  type WorkspaceDesign,
} from "../api/appearance";
import Switch from "../components/Switch";
import ContextMenu, {
  type ContextMenuItem,
  type ContextMenuPosition,
  captureContextMenu,
} from "../components/ContextMenu";
import { useNavMenuItems, reloadAppWindow } from "../components/navMenu";
import NotesIcon from "../components/NotesIcon";
import FieldInfo from "../components/FieldInfo";
import ThemedSelect from "../components/ThemedSelect";
import VmPowerControls from "../components/VmPowerControls";
import LazyDetails from "../components/LazyDetails";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getClientPlatformTag } from "../api/standalone";
import {
  clearDiagnosticLogs,
  exportDiagnosticBundle,
  getDiagnosticStatus,
  setLocalDiagnosticChannels,
  type DiagnosticStatus,
} from "../api/diagnostics";
import gotSwatch from "../../src-tauri/icons/dragon.png";
import { GOT_HOUSE_THEMES } from "../theme/gotHouseThemes";
import { useRendererLifecycle } from "../renderer/RendererLifecycleContext";

function SettingLabel({
  children,
  info,
  style,
}: {
  children: React.ReactNode;
  info?: string;
  style?: CSSProperties;
}) {
  return (
    <span className="setting-label" style={{ display: "inline-flex", alignItems: "center", gap: 4, ...style }}>
      {children}
      {info && <FieldInfo label={String(children)} text={info} />}
    </span>
  );
}

function SwitchStyleSample({ style }: { style: SwitchButtonStyle }) {
  return (
    <span className="catwalk-switch catwalk-switch--checked switch-style-sample" data-switch-button-style={style} aria-hidden="true">
      <span className="catwalk-switch__control">
        <span className="catwalk-switch__option catwalk-switch__option--off">OFF</span>
        <span className="catwalk-switch__option catwalk-switch__option--on">ON</span>
      </span>
    </span>
  );
}

/// Built-in terminal palette presets. Server config can ship more by writing
/// a full `terminal.theme` object; this list is just a quick picker.
const TERMINAL_PRESETS: { id: string; label: string; theme: Record<string, string> }[] = [
  { id: "default", label: "ConnCat (Default)", theme: DEFAULTS.terminal.theme as Record<string, string> },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    theme: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#93a1a1",
      selectionBackground: "#073642",
      black: "#073642",
      brightBlack: "#586e75",
      red: "#dc322f",
      brightRed: "#cb4b16",
      green: "#859900",
      brightGreen: "#586e75",
      yellow: "#b58900",
      brightYellow: "#657b83",
      blue: "#268bd2",
      brightBlue: "#839496",
      magenta: "#d33682",
      brightMagenta: "#6c71c4",
      cyan: "#2aa198",
      brightCyan: "#93a1a1",
      white: "#eee8d5",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      brightBlack: "#6272a4",
      red: "#ff5555",
      brightRed: "#ff6e6e",
      green: "#50fa7b",
      brightGreen: "#69ff94",
      yellow: "#f1fa8c",
      brightYellow: "#ffffa5",
      blue: "#bd93f9",
      brightBlue: "#d6acff",
      magenta: "#ff79c6",
      brightMagenta: "#ff92df",
      cyan: "#8be9fd",
      brightCyan: "#a4ffff",
      white: "#f8f8f2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "light",
    label: "Light",
    theme: {
      background: "#ffffff",
      foreground: "#24292e",
      cursor: "#24292e",
      selectionBackground: "#c8e1ff",
      black: "#24292e",
      brightBlack: "#586069",
      red: "#d73a49",
      brightRed: "#cb2431",
      green: "#22863a",
      brightGreen: "#28a745",
      yellow: "#b08800",
      brightYellow: "#dbab09",
      blue: "#005cc5",
      brightBlue: "#0366d6",
      magenta: "#6f42c1",
      brightMagenta: "#5a32a3",
      cyan: "#1b7c83",
      brightCyan: "#3192aa",
      white: "#6a737d",
      brightWhite: "#959da5",
    },
  },
  {
    // Deep navy palette with a warm copper cursor and accent.
    id: "midnight-copper",
    label: "Midnight Copper",
    theme: {
      background: "#222e45",
      foreground: "#d6deea",
      cursor: "#fb7c32",
      selectionBackground: "#344766",
      black: "#1a2336",
      brightBlack: "#4a5b7a",
      red: "#ff6b6b",
      brightRed: "#ff8585",
      green: "#7cd0a6",
      brightGreen: "#9ee0bd",
      yellow: "#fb7c32",
      brightYellow: "#ffa569",
      blue: "#6aa6ff",
      brightBlue: "#8cc0ff",
      magenta: "#c490e0",
      brightMagenta: "#d6abee",
      cyan: "#6fd8e0",
      brightCyan: "#8de4ea",
      white: "#c0c9d6",
      brightWhite: "#ffffff",
    },
  },
  {
    // Lighter steel-blue variant of the company palette. Still a deep blue,
    // just less inky than Navy. Same orange accent.
    id: "steel-horizon",
    label: "Steel Horizon",
    theme: {
      background: "#324a6b",
      foreground: "#e3e9f2",
      cursor: "#fb7c32",
      selectionBackground: "#4a6485",
      black: "#1f3050",
      brightBlack: "#5d7396",
      red: "#ff7a7a",
      brightRed: "#ff9494",
      green: "#86d7af",
      brightGreen: "#a6e4c4",
      yellow: "#fb7c32",
      brightYellow: "#ffb37a",
      blue: "#86b8ff",
      brightBlue: "#a4ccff",
      magenta: "#cea1e6",
      brightMagenta: "#dbb6ef",
      cyan: "#80dde5",
      brightCyan: "#9be7ed",
      white: "#cfd6e1",
      brightWhite: "#ffffff",
    },
  },
  {
    // Pride: dark plum background with the rainbow mapped onto ANSI colors.
    // High-contrast and readable while still flying the flag.
    id: "pride",
    label: "Pride",
    theme: {
      background: "#1a1426",
      foreground: "#f5ecff",
      cursor: "#ffd166",
      selectionBackground: "#3a2a52",
      black: "#241a36",
      brightBlack: "#6e5b8a",
      red: "#e63946",          // red stripe
      brightRed: "#ff5a6a",
      green: "#3aaa5a",        // green stripe
      brightGreen: "#5fd17e",
      yellow: "#ffb703",       // yellow stripe
      brightYellow: "#ffd166",
      blue: "#3a86ff",         // blue stripe
      brightBlue: "#6fa6ff",
      magenta: "#8338ec",      // violet stripe
      brightMagenta: "#a566ff",
      cyan: "#ff8c42",         // orange stripe (mapped to cyan slot)
      brightCyan: "#ffae66",
      white: "#e6dcf2",
      brightWhite: "#ffffff",
    },
  },
  {
    // Game of Thrones: charred castle stone background with Targaryen
    // dragon-fire red as the dominant accent and Lannister gold highlights.
    // ANSI colors lean into house sigils (Stark grey, Tyrell green, Tully blue).
    id: "got",
    label: "Game of Thrones",
    theme: {
      background: "#15110d",
      foreground: "#e8dcc4",
      cursor: "#c8102e",
      selectionBackground: "#3a2a1a",
      black: "#0a0805",
      brightBlack: "#6a5a48",
      red: "#c8102e",          // Targaryen / blood red
      brightRed: "#ff3b4a",
      green: "#4f7a3a",        // Tyrell green
      brightGreen: "#7aa85c",
      yellow: "#d4a017",       // Lannister gold
      brightYellow: "#f4c842",
      blue: "#2a5a8a",         // Tully blue
      brightBlue: "#5a8ec0",
      magenta: "#8a2a4a",      // Bolton flayed pink-red
      brightMagenta: "#b5476e",
      cyan: "#3a7a8a",         // Greyjoy sea-grey-teal
      brightCyan: "#6aa8b8",
      white: "#c8b896",
      brightWhite: "#f5ead0",
    },
  },
  {
    // Ocean Blue: deep navy background with a clear blue cursor and accents.
    id: "ocean-blue",
    label: "Ocean Blue",
    theme: {
      background: "#00253d",
      foreground: "#e5f1f8",
      cursor: "#049fd9",
      selectionBackground: "#0a4a73",
      black: "#001a2a",
      brightBlack: "#4a6378",
      red: "#e94f4f",
      brightRed: "#ff7a7a",
      green: "#6fcf97",
      brightGreen: "#8fe0b0",
      yellow: "#f2c94c",
      brightYellow: "#ffd76b",
      blue: "#049fd9",
      brightBlue: "#5cc8f0",
      magenta: "#bb6bd9",
      brightMagenta: "#d29be8",
      cyan: "#56ccf2",
      brightCyan: "#7ddcf5",
      white: "#cfdce6",
      brightWhite: "#ffffff",
    },
  },
  {
    // Star Wars — Jedi: parchment / Tatooine sand with Luke's blue saber.
    id: "jedi",
    label: "Jedi Order",
    theme: {
      background: "#f5ecd2",
      foreground: "#2b1f0e",
      cursor: "#3aa7e8",
      selectionBackground: "#e6d7a8",
      black: "#2b1f0e",
      brightBlack: "#6a5530",
      red: "#a32e1a",
      brightRed: "#c8412a",
      green: "#3f7a3a",        // Yoda green
      brightGreen: "#5fa05c",
      yellow: "#caa12a",       // desert sun
      brightYellow: "#e6bd3e",
      blue: "#2872a8",         // Luke saber blue
      brightBlue: "#3aa7e8",
      magenta: "#8a3a5e",
      brightMagenta: "#b2547f",
      cyan: "#1f8a8a",
      brightCyan: "#3ab0b0",
      white: "#6a5530",
      brightWhite: "#2b1f0e",
    },
  },
  {
    // Star Wars — Sith: void-black, blood-red saber, scorched accents.
    id: "sith",
    label: "Sith",
    theme: {
      background: "#0a0306",
      foreground: "#f0d6d6",
      cursor: "#ff1a1a",
      selectionBackground: "#3a0a0f",
      black: "#000000",
      brightBlack: "#5a3a3e",
      red: "#ff1a1a",          // Sith saber
      brightRed: "#ff5a5a",
      green: "#6b8a4a",
      brightGreen: "#8ea968",
      yellow: "#d4842a",
      brightYellow: "#ffb35a",
      blue: "#5e2a8a",         // dark side purple
      brightBlue: "#8a4ec0",
      magenta: "#b80f4a",
      brightMagenta: "#e8336e",
      cyan: "#6a5e8a",
      brightCyan: "#8a7ea8",
      white: "#a89898",
      brightWhite: "#f0d6d6",
    },
  },
  {
    // Squid Game: tracksuit teal background, hot pink jumpsuit accents,
    // cream foreground for the geometric symbols (◯ △ ▢).
    id: "squid",
    label: "Squid Game",
    theme: {
      background: "#0d2724",
      foreground: "#f8e8ec",
      cursor: "#ed1b76",
      selectionBackground: "#1f4a45",
      black: "#0a1c1a",
      brightBlack: "#4a6a66",
      red: "#ed1b76",          // pink jumpsuit
      brightRed: "#ff4a96",
      green: "#00a19a",        // tracksuit teal
      brightGreen: "#34c6c0",
      yellow: "#f5d36b",
      brightYellow: "#ffe48a",
      blue: "#4a90c8",
      brightBlue: "#6fb3e0",
      magenta: "#b8377a",
      brightMagenta: "#d65b9a",
      cyan: "#00a19a",
      brightCyan: "#34c6c0",
      white: "#d6c8cc",
      brightWhite: "#ffffff",
    },
  },
  {
    // Galactic — deep space black + saber yellow + Tatooine sand fg.
    id: "galactic-dark",
    label: "Galactic Dark",
    theme: {
      background: "#0d0f14",
      foreground: "#e6e0c9",
      cursor: "#ffe81f",
      selectionBackground: "#1f2633",
      black: "#11151c",
      brightBlack: "#4b5563",
      red: "#ff5f56",
      brightRed: "#ff7b72",
      green: "#2ff924",
      brightGreen: "#7dff6b",
      yellow: "#ffe81f",
      brightYellow: "#fff27a",
      blue: "#4dabff",
      brightBlue: "#7dc1ff",
      magenta: "#b388ff",
      brightMagenta: "#c9a6ff",
      cyan: "#63f2ff",
      brightCyan: "#9df8ff",
      white: "#d9dde7",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "galactic-light",
    label: "Galactic Light",
    theme: {
      background: "#f7f3e8",
      foreground: "#2b2f36",
      cursor: "#c49b00",
      selectionBackground: "#dfe7f2",
      black: "#1f2430",
      brightBlack: "#6b7280",
      red: "#d94c3d",
      brightRed: "#ef6b5b",
      green: "#2f9e44",
      brightGreen: "#55b96a",
      yellow: "#c49b00",
      brightYellow: "#e1bc32",
      blue: "#2f6feb",
      brightBlue: "#5b8cff",
      magenta: "#8e63d2",
      brightMagenta: "#aa82e6",
      cyan: "#138a9e",
      brightCyan: "#39a9ba",
      white: "#d5dbe5",
      brightWhite: "#ffffff",
    },
  },
  {
    // Matrix — phosphor-green-on-black, drips on demand.
    id: "matrix-dark",
    label: "Matrix Dark",
    theme: {
      background: "#0a0f0a",
      foreground: "#8aff80",
      cursor: "#39ff14",
      selectionBackground: "#16301a",
      black: "#050805",
      brightBlack: "#3d5a40",
      red: "#3f8f3f",
      brightRed: "#56b956",
      green: "#39ff14",
      brightGreen: "#7dff6b",
      yellow: "#9dff57",
      brightYellow: "#c8ff8a",
      blue: "#2bbf6a",
      brightBlue: "#55d98c",
      magenta: "#49b36b",
      brightMagenta: "#6fd18d",
      cyan: "#60ffb0",
      brightCyan: "#8affca",
      white: "#b7d9b2",
      brightWhite: "#eaffea",
    },
  },
  {
    id: "matrix-light",
    label: "Matrix Light",
    theme: {
      background: "#f3fff3",
      foreground: "#1f3320",
      cursor: "#1ea83a",
      selectionBackground: "#d8f0d8",
      black: "#1a241a",
      brightBlack: "#667566",
      red: "#4a7a4a",
      brightRed: "#5e9660",
      green: "#1ea83a",
      brightGreen: "#43c55f",
      yellow: "#7ea63a",
      brightYellow: "#9bc65f",
      blue: "#2f8f57",
      brightBlue: "#56ad78",
      magenta: "#4d8a5f",
      brightMagenta: "#6aa879",
      cyan: "#2ca57c",
      brightCyan: "#57c39c",
      white: "#dbe8db",
      brightWhite: "#ffffff",
    },
  },
  {
    // Grid — TRON light-cycle neon: cyan/magenta on inky blue.
    id: "grid-dark",
    label: "Grid Dark",
    theme: {
      background: "#0a0f1f",
      foreground: "#b8e6ff",
      cursor: "#00d9ff",
      selectionBackground: "#173055",
      black: "#05070d",
      brightBlack: "#4b5d7a",
      red: "#ff5c8a",
      brightRed: "#ff7aa2",
      green: "#00f7a5",
      brightGreen: "#57ffc4",
      yellow: "#ffd166",
      brightYellow: "#ffe08f",
      blue: "#00d9ff",
      brightBlue: "#63e6ff",
      magenta: "#b388ff",
      brightMagenta: "#c7a6ff",
      cyan: "#66f2ff",
      brightCyan: "#99f7ff",
      white: "#dcefff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "grid-light",
    label: "Grid Light",
    theme: {
      background: "#f4fbff",
      foreground: "#223047",
      cursor: "#009cc2",
      selectionBackground: "#d9ecf7",
      black: "#1a2230",
      brightBlack: "#6c7a90",
      red: "#d65276",
      brightRed: "#eb7896",
      green: "#00a878",
      brightGreen: "#39c998",
      yellow: "#cc9a2e",
      brightYellow: "#e0b75f",
      blue: "#009cc2",
      brightBlue: "#46b7d6",
      magenta: "#8d69d4",
      brightMagenta: "#a88ae5",
      cyan: "#2ca9bc",
      brightCyan: "#59c6d4",
      white: "#dbe7f0",
      brightWhite: "#ffffff",
    },
  },
  {
    // Upside Down — Hawkins shadow-realm: bruised purple + Eleven-nosebleed red.
    id: "upside-down-dark",
    label: "Upside Down Dark",
    theme: {
      background: "#16121c",
      foreground: "#e8dde3",
      cursor: "#ff4d5a",
      selectionBackground: "#3a2230",
      black: "#0f0b14",
      brightBlack: "#66586a",
      red: "#ff4d5a",
      brightRed: "#ff7a84",
      green: "#78c27b",
      brightGreen: "#98d79a",
      yellow: "#ff9f43",
      brightYellow: "#ffbe73",
      blue: "#6a8dff",
      brightBlue: "#91acff",
      magenta: "#c678dd",
      brightMagenta: "#d89ae8",
      cyan: "#67d4e8",
      brightCyan: "#8fe0ef",
      white: "#d7cfd6",
      brightWhite: "#fff8fb",
    },
  },
  {
    id: "upside-down-light",
    label: "Upside Down Light",
    theme: {
      background: "#fff6f8",
      foreground: "#352a33",
      cursor: "#d64552",
      selectionBackground: "#f2dce3",
      black: "#241d24",
      brightBlack: "#7b6d77",
      red: "#d64552",
      brightRed: "#ea6672",
      green: "#5b9f61",
      brightGreen: "#7fbb84",
      yellow: "#d98b36",
      brightYellow: "#edaa63",
      blue: "#5e7de0",
      brightBlue: "#7f99ec",
      magenta: "#a865c1",
      brightMagenta: "#c087d4",
      cyan: "#4eb7c7",
      brightCyan: "#77cbd7",
      white: "#e6dfe5",
      brightWhite: "#ffffff",
    },
  },
  {
    // Arrakis — Dune spice: ochre sand + stillsuit blue + worm-shadow brown.
    id: "arrakis-dark",
    label: "Arrakis Dark",
    theme: {
      background: "#1a1410",
      foreground: "#f2dfc8",
      cursor: "#f6ad55",
      selectionBackground: "#4a3425",
      black: "#120d0a",
      brightBlack: "#6e5a4d",
      red: "#e07a5f",
      brightRed: "#f09578",
      green: "#a3be8c",
      brightGreen: "#bfd4a8",
      yellow: "#f6ad55",
      brightYellow: "#f9c784",
      blue: "#7fb3d5",
      brightBlue: "#a3c9e2",
      magenta: "#c39bd3",
      brightMagenta: "#d7b6e2",
      cyan: "#76c7c0",
      brightCyan: "#9adbd6",
      white: "#e6d5c3",
      brightWhite: "#fff7ed",
    },
  },
  {
    id: "arrakis-light",
    label: "Arrakis Light",
    theme: {
      background: "#fff8ee",
      foreground: "#3b2f26",
      cursor: "#d98c3f",
      selectionBackground: "#f0dfc8",
      black: "#2a211c",
      brightBlack: "#7d6c5f",
      red: "#c96d55",
      brightRed: "#de8a72",
      green: "#7f9f68",
      brightGreen: "#9cba86",
      yellow: "#d98c3f",
      brightYellow: "#ebb167",
      blue: "#6798bb",
      brightBlue: "#89b4d1",
      magenta: "#a980ba",
      brightMagenta: "#bf9bd0",
      cyan: "#5daea7",
      brightCyan: "#7fc5bf",
      white: "#e9dfd2",
      brightWhite: "#ffffff",
    },
  },
  ...GOT_HOUSE_THEMES.map((house) => ({
    id: house.id,
    label: `${house.label} — ${house.motto}`,
    theme: {
      background: house.window.bg,
      foreground: house.window.fg,
      cursor: house.accent,
      selectionBackground: house.window.border,
      black: house.darkWindow.bg,
      brightBlack: house.window.muted,
      red: "#d04a4a",
      brightRed: "#ef6b6b",
      green: "#5f9b69",
      brightGreen: "#82bb89",
      yellow: "#c9a43b",
      brightYellow: "#ebca62",
      blue: "#4c78a8",
      brightBlue: "#72a0cf",
      magenta: "#8f5b8f",
      brightMagenta: "#b47ab4",
      cyan: "#4d8f92",
      brightCyan: "#71b3b6",
      white: house.window.fg,
      brightWhite: "#ffffff",
    },
  })),
];

const SESSION_GROUP_DOUBLE_CLICK_OPTIONS: Array<{ value: SessionGroupDoubleClickAction; label: string }> = [
  { value: "reconnect", label: "Reconnect all tabs" },
  { value: "closeAll", label: "Close all tabs" },
  { value: "none", label: "Do nothing" },
  { value: "ungroup", label: "Ungroup all tabs" },
];

const SESSION_GROUP_MIDDLE_CLICK_OPTIONS: Array<{ value: SessionGroupMiddleClickAction; label: string }> = [
  { value: "closeAll", label: "Close all tabs" },
  { value: "ungroup", label: "Ungroup all tabs" },
  { value: "none", label: "Do nothing" },
  { value: "reconnect", label: "Reconnect all tabs" },
];

const ENTITY_DOUBLE_CLICK_OPTIONS: Array<{ value: EntityDoubleClickAction; label: string }> = [
  { value: "connect", label: "Connect" },
  { value: "none", label: "Do nothing" },
];

const TERMINAL_SIDEBAR_CLICK_OPTIONS: Array<{ value: TerminalSidebarClickBehavior; label: string }> = [
  { value: "singleClickOpen", label: "Single click opens connection" },
  { value: "doubleClickOpen", label: "Double click opens connection" },
  { value: "selectOnly", label: "Single click selects only" },
  { value: "none", label: "Do nothing" },
];

const TERMINAL_FONT_OPTIONS: { label: string; value: string; hint: string }[] = [
  {
    label: "Default (recommended)",
    value: DEFAULTS.terminal.fontFamily,
    hint: "Current stable ConnCat terminal stack.",
  },
  {
    label: "Menlo / Monaco",
    value: "Menlo, Monaco, 'Courier New', monospace",
    hint: "macOS classic monospace stack.",
  },
  {
    label: "SF Mono",
    value: "'SFMono-Regular', 'SF Mono', Menlo, Monaco, monospace",
    hint: "macOS system developer font when available.",
  },
  {
    label: "Consolas",
    value: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
    hint: "Windows classic terminal font.",
  },
  {
    label: "Cascadia Mono",
    value: "'Cascadia Mono', Consolas, 'Courier New', monospace",
    hint: "Modern Windows terminal font when available.",
  },
  {
    label: "Liberation Mono",
    value: "'Liberation Mono', 'DejaVu Sans Mono', monospace",
    hint: "Linux-friendly monospace stack.",
  },
  {
    label: "DejaVu Sans Mono",
    value: "'DejaVu Sans Mono', 'Liberation Mono', monospace",
    hint: "Common Linux monospace font.",
  },
  {
    label: "JetBrains Mono",
    value: "'JetBrains Mono', Menlo, Consolas, monospace",
    hint: "Only applies when installed locally.",
  },
];

/// One-click brand presets that set accent + matching terminal theme together.
const BRAND_PRESETS: {
  id: string;
  label: string;
  accent: string;
  swatch?: string;
  brandName?: string;
  logoUrl?: string;
  motto?: string;
  colorScheme: ColorScheme;
  terminalPresetId: string;
  /// Optional window palette. When set, the whole app (not just the terminal)
  /// adopts these colors. Omit to fall back to the selected surface defaults.
  window?: {
    bg?: string;
    panel?: string;
    fg?: string;
    muted?: string;
    border?: string;
    inputBg?: string;
    btnFg?: string;
  };
}[] = [
    {
      id: "midnight-copper",
      label: "Midnight Copper",
      accent: "#fb7c32",
      colorScheme: "dark",
      terminalPresetId: "midnight-copper",
      window: {
        bg: "#1a2336",
        panel: "#222e45",
        fg: "#d6deea",
        muted: "#8a99b3",
        border: "#344766",
        inputBg: "#1f2b40",
        btnFg: "#0e1422",
      },
    },
    {
      id: "steel-horizon",
      label: "Steel Horizon",
      accent: "#fb7c32",
      colorScheme: "dark",
      terminalPresetId: "steel-horizon",
      window: {
        bg: "#2a3e5c",
        panel: "#324a6b",
        fg: "#e3e9f2",
        muted: "#9cadc7",
        border: "#4a6485",
        inputBg: "#304866",
        btnFg: "#0e1422",
      },
    },
    {
      id: "pride",
      label: "Pride",
      accent: "#ffb703",
      swatch: "linear-gradient(90deg, #e63946 0%, #ff8c42 18%, #ffb703 36%, #3aaa5a 54%, #3a86ff 72%, #8338ec 90%)",
      colorScheme: "dark",
      terminalPresetId: "pride",
      window: {
        bg: "#1a1426",
        panel: "#2a1a4d",
        fg: "#f8f0ff",
        muted: "#c8a5e8",
        border: "#8338ec",
        inputBg: "#120e1c",
        btnFg: "#1a1426",
      },
    },
    {
      id: "got",
      label: "Game of Thrones",
      accent: "#c8102e",
      swatch: `url(${gotSwatch}) center / cover no-repeat`,
      colorScheme: "dark",
      terminalPresetId: "got",
      window: {
        bg: "#15110d",
        panel: "#241a12",
        fg: "#e8dcc4",
        muted: "#9a8868",
        border: "#5a3a1a",
        inputBg: "#0d0a07",
        btnFg: "#f5ead0",
      },
    },
    {
      id: "ocean-blue",
      label: "Ocean Blue",
      accent: "#049fd9",
      colorScheme: "medium",
      terminalPresetId: "ocean-blue",
      window: {
        bg: "#00253d",
        panel: "#003459",
        fg: "#e5f1f8",
        muted: "#7d9bb8",
        border: "#004d7a",
        inputBg: "#253c4b",
        btnFg: "#ffffff",
      },
    },
    {
      id: "connecat",
      label: "ConnCat",
      accent: "#049fd9",
      brandName: "ConnCat",
      logoUrl: "/connecat.png",
      colorScheme: "dark",
      terminalPresetId: "ocean-blue",
      window: {
        bg: "#00253d",
        panel: "#003459",
        fg: "#e5f1f8",
        muted: "#7d9bb8",
        border: "#004d7a",
        inputBg: "#253c4b",
        btnFg: "#ffffff",
      },
    },
    {
      id: "jedi",
      label: "Jedi Order",
      accent: "#3aa7e8",
      colorScheme: "light",
      terminalPresetId: "jedi",
      window: {
        bg: "#f5ecd2",
        panel: "#fffbe9",
        fg: "#2b1f0e",
        muted: "#8a6a3a",
        border: "#c7a96d",
        inputBg: "#fffaf0",
        btnFg: "#ffffff",
      },
    },
    {
      id: "sith",
      label: "Sith",
      accent: "#ff1a1a",
      colorScheme: "dark",
      terminalPresetId: "sith",
      window: {
        bg: "#0a0306",
        panel: "#16070b",
        fg: "#f0d6d6",
        muted: "#8a5a5e",
        border: "#5a1620",
        inputBg: "#060102",
        btnFg: "#16070b",
      },
    },
    {
      id: "squid",
      label: "Squid Game",
      accent: "#ed1b76",
      swatch: "linear-gradient(135deg, #ed1b76 0 33%, #f8e8ec 33% 66%, #00a19a 66% 100%)",
      colorScheme: "dark",
      terminalPresetId: "squid",
      window: {
        bg: "#0d2724",
        panel: "#134641",
        fg: "#f8e8ec",
        muted: "#a3938a",
        border: "#ed1b76",
        inputBg: "#061412",
        btnFg: "#0d2724",
      },
    },
    {
      id: "galactic-dark",
      label: "Galactic Dark",
      accent: "#ffe81f",
      colorScheme: "dark",
      terminalPresetId: "galactic-dark",
      window: {
        bg: "#0d0f14",
        panel: "#161922",
        fg: "#e6e0c9",
        muted: "#4b5563",
        border: "#1f2633",
        inputBg: "#08090d",
        btnFg: "#0d0f14",
      },
    },
    {
      id: "galactic-light",
      label: "Galactic Light",
      accent: "#c49b00",
      colorScheme: "light",
      terminalPresetId: "galactic-light",
      window: {
        bg: "#f7f3e8",
        panel: "#fffdf6",
        fg: "#2b2f36",
        muted: "#6b7280",
        border: "#dfe7f2",
        inputBg: "#ffffff",
        btnFg: "#ffffff",
      },
    },
    {
      id: "matrix-dark",
      label: "Matrix Dark",
      accent: "#39ff14",
      colorScheme: "dark",
      terminalPresetId: "matrix-dark",
      window: {
        bg: "#0a0f0a",
        panel: "#111811",
        fg: "#8aff80",
        muted: "#3d5a40",
        border: "#16301a",
        inputBg: "#050805",
        btnFg: "#0a0f0a",
      },
    },
    {
      id: "matrix-light",
      label: "Matrix Light",
      accent: "#1ea83a",
      colorScheme: "light",
      terminalPresetId: "matrix-light",
      window: {
        bg: "#f3fff3",
        panel: "#f9fff9",
        fg: "#1f3320",
        muted: "#667566",
        border: "#d8f0d8",
        inputBg: "#ffffff",
        btnFg: "#ffffff",
      },
    },
    {
      id: "grid-dark",
      label: "Grid Dark",
      accent: "#00d9ff",
      colorScheme: "dark",
      terminalPresetId: "grid-dark",
      window: {
        bg: "#0a0f1f",
        panel: "#121826",
        fg: "#b8e6ff",
        muted: "#4b5d7a",
        border: "#173055",
        inputBg: "#05070d",
        btnFg: "#0a0f1f",
      },
    },
    {
      id: "grid-light",
      label: "Grid Light",
      accent: "#009cc2",
      colorScheme: "light",
      terminalPresetId: "grid-light",
      window: {
        bg: "#f4fbff",
        panel: "#fbffff",
        fg: "#223047",
        muted: "#6c7a90",
        border: "#d9ecf7",
        inputBg: "#ffffff",
        btnFg: "#ffffff",
      },
    },
    {
      id: "upside-down-dark",
      label: "Upside Down Dark",
      accent: "#ff4d5a",
      colorScheme: "dark",
      terminalPresetId: "upside-down-dark",
      window: {
        bg: "#16121c",
        panel: "#1d1825",
        fg: "#e8dde3",
        muted: "#66586a",
        border: "#3a2230",
        inputBg: "#0f0b14",
        btnFg: "#16121c",
      },
    },
    {
      id: "upside-down-light",
      label: "Upside Down Light",
      accent: "#d64552",
      colorScheme: "light",
      terminalPresetId: "upside-down-light",
      window: {
        bg: "#fff6f8",
        panel: "#fffdfe",
        fg: "#352a33",
        muted: "#7b6d77",
        border: "#f2dce3",
        inputBg: "#ffffff",
        btnFg: "#ffffff",
      },
    },
    {
      id: "arrakis-dark",
      label: "Arrakis Dark",
      accent: "#f6ad55",
      colorScheme: "dark",
      terminalPresetId: "arrakis-dark",
      window: {
        bg: "#1a1410",
        panel: "#221a14",
        fg: "#f2dfc8",
        muted: "#6e5a4d",
        border: "#4a3425",
        inputBg: "#120d0a",
        btnFg: "#1a1410",
      },
    },
    {
      id: "arrakis-light",
      label: "Arrakis Light",
      accent: "#d98c3f",
      colorScheme: "light",
      terminalPresetId: "arrakis-light",
      window: {
        bg: "#fff8ee",
        panel: "#fffdf8",
        fg: "#3b2f26",
        muted: "#7d6c5f",
        border: "#f0dfc8",
        inputBg: "#ffffff",
        btnFg: "#ffffff",
      },
    },
    ...GOT_HOUSE_THEMES.map((house) => ({
      id: house.id,
      label: house.label,
      brandName: house.brandName,
      logoUrl: house.logoUrl,
      motto: house.motto,
      accent: house.accent,
      swatch: `linear-gradient(135deg, ${house.window.bg} 0 46%, ${house.window.panel} 46% 76%, ${house.accent} 76% 100%)`,
      colorScheme: "medium" as ColorScheme,
      terminalPresetId: house.id,
      window: house.window,
    })),
  ];

type WindowPrefs = NonNullable<NonNullable<AppearanceConfig["brand"]>["window"]>;

const LEGACY_SPLIT_THEME_PRESET_IDS = new Set([
  "game-of-thrones-medium", "game-of-thrones-dark",
  "pride-medium", "pride-dark",
  "squid-game-medium", "squid-game-dark",
]);

export default function Settings() {
  const { userPrefs, setUserPrefs, serverConfig, appearance, refreshServer } = useAppearance();
  const [draft, setDraft] = useState<AppearanceConfig>(() => structuredClone(userPrefs));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const navItems = useNavMenuItems();
  const [diagnostics, setDiagnostics] = useState<DiagnosticStatus | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const [showClearDiagnosticsConfirm, setShowClearDiagnosticsConfirm] = useState(false);
  const [showVmPowerIconPreview, setShowVmPowerIconPreview] = useState(false);
  const [showSessionIconPreview, setShowSessionIconPreview] = useState(false);
  const [showButtonIconPreview, setShowButtonIconPreview] = useState(false);
  const [showSwitchButtonPreview, setShowSwitchButtonPreview] = useState(false);
  const rendererLifecycle = useRendererLifecycle();
  const [showRendererResetConfirm, setShowRendererResetConfirm] = useState(false);
  const [rendererResetMessage, setRendererResetMessage] = useState("");

  useEffect(() => {
    void getDiagnosticStatus().then(setDiagnostics).catch((error) => {
      setDiagnosticsMessage(`Could not load diagnostics: ${String(error)}`);
    });
  }, []);

  async function saveDiagnosticChannels(channels: string[]) {
    setDiagnosticsBusy(true);
    setDiagnosticsMessage("");
    try {
      setDiagnostics(await setLocalDiagnosticChannels(channels));
    } catch (error) {
      setDiagnosticsMessage(`Could not update diagnostics: ${String(error)}`);
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function exportDiagnostics() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = await saveDialog({ defaultPath: `ConnCat-diagnostics-${stamp}.zip` });
    if (!destination) return;
    setDiagnosticsBusy(true);
    setDiagnosticsMessage("");
    try {
      const bytes = await exportDiagnosticBundle(destination, getClientPlatformTag());
      setDiagnosticsMessage(`Exported ${Math.max(1, Math.round(bytes / 1024))} KiB diagnostic bundle.`);
      setDiagnostics(await getDiagnosticStatus());
    } catch (error) {
      setDiagnosticsMessage(`Could not export diagnostics: ${String(error)}`);
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function clearDiagnostics() {
    const previousBytes = diagnostics?.log_bytes ?? 0;
    setShowClearDiagnosticsConfirm(false);
    setDiagnosticsBusy(true);
    setDiagnosticsMessage("");
    try {
      setDiagnostics(await clearDiagnosticLogs());
      setDiagnosticsMessage(`Cleared ${Math.max(1, Math.round(previousBytes / 1024))} KiB of diagnostic logs.`);
    } catch (error) {
      setDiagnosticsMessage(`Could not clear diagnostics: ${String(error)}`);
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function reclaimRendererMemory() {
    setShowRendererResetConfirm(false);
    setRendererResetMessage("");
    const result = await rendererLifecycle.reset("manual", dirty);
    if (!result.accepted) {
      setRendererResetMessage(result.blockers.map((item) => item.message).join("; ")
        || result.message
        || "Renderer memory could not be reclaimed.");
    }
  }

  // Scroll the matching section header into view. `label` is the H3
  // text we render inside `<section className="card">` blocks.
  const jumpToSection = (label: string) => {
    const headings = document.querySelectorAll<HTMLHeadingElement>(".card h3");
    for (const h of headings) {
      if (h.textContent?.trim() === label) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  };

  const openPageMenu = (e: React.MouseEvent) => {
    setMenu({
      pos: captureContextMenu(e),
      items: [
        { label: "Jump to section", disabled: true, onClick: () => {} },
        { label: "   App Appearance", onClick: () => jumpToSection("App Appearance") },
        { label: "   Terminal Appearance", onClick: () => jumpToSection("Terminal Appearance") },
        { label: "   App Behavior", onClick: () => jumpToSection("App Behavior") },
        { divider: true },
        { label: "Reload window", onClick: reloadAppWindow },
        { divider: true },
        ...navItems,
      ],
    });
  };

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(userPrefs),
    [draft, userPrefs],
  );

  function setBrand<K extends keyof NonNullable<AppearanceConfig["brand"]>>(
    key: K,
    val: NonNullable<AppearanceConfig["brand"]>[K] | undefined,
  ) {
    setDraft((d) => {
      const brand: Record<string, unknown> = { ...(d.brand ?? {}) };
      if (val === undefined || val === "") delete brand[key as string];
      else brand[key as string] = val;
      const next = { ...d, brand: brand as AppearanceConfig["brand"] };
      if (Object.keys(brand).length === 0) delete next.brand;
      return next;
    });
  }

  function setWindow<K extends keyof WindowPrefs>(
    key: K,
    val: WindowPrefs[K] | undefined,
  ) {
    setDraft((d) => {
      const brand = { ...(d.brand ?? {}) };
      const windowPrefs: Record<string, unknown> = { ...(brand.window ?? {}) };
      if (val === undefined || (typeof val === "string" && val === "")) {
        delete windowPrefs[key as string];
      } else {
        windowPrefs[key as string] = val;
      }
      if (Object.keys(windowPrefs).length > 0) brand.window = windowPrefs as WindowPrefs;
      else delete brand.window;
      const next = { ...d, brand: brand as AppearanceConfig["brand"] };
      if (Object.keys(brand).length === 0) delete next.brand;
      return next;
    });
  }

  function setTerm<K extends keyof NonNullable<AppearanceConfig["terminal"]>>(
    key: K,
    val: NonNullable<AppearanceConfig["terminal"]>[K] | undefined,
  ) {
    setDraft((d) => {
      const term: Record<string, unknown> = { ...(d.terminal ?? {}) };
      if (val === undefined) delete term[key as string];
      else term[key as string] = val;
      const next = { ...d, terminal: term as AppearanceConfig["terminal"] };
      if (Object.keys(term).length === 0) delete next.terminal;
      return next;
    });
  }

  function applyColorScheme(base: AppearanceConfig, v: ColorScheme | ""): AppearanceConfig {
      const next = { ...base };
      if (!v) delete next.colorScheme;
      else next.colorScheme = v;
      // Brand presets can carry custom window vars (--bg/--panel/--fg) that
      // are inline-set on :root and therefore win over [data-theme="light"].
      // Drop only window colors so the chosen scheme can take effect, while
      // keeping brand id/accent for brand-specific styling.
      if (next.brand) {
        const b = { ...next.brand };
        const builtInPreset = b.identity !== "custom"
          ? BRAND_PRESETS.find((preset) => preset.id === b.id)
          : undefined;
        const customPreset = b.identity === "custom" && Array.isArray(serverConfig.customPresets)
          ? serverConfig.customPresets.find((preset) => preset.id === b.id)
          : undefined;
        const portalSchemeWindow = v
          ? serverConfig.themeSchemeOverrides?.[b.id || ""]?.schemes?.[v]?.window
          : undefined;
        const houseTheme = GOT_HOUSE_THEMES.find((house) => house.id === b.id);
        const localHouseSchemeWindow = v && houseTheme
          ? v === "light"
            ? houseTheme.lightWindow
            : v === "dark"
              ? houseTheme.darkWindow
              : houseTheme.window
          : undefined;
        const authoredSchemeWindow = portalSchemeWindow ?? localHouseSchemeWindow;
        const nativeScheme = builtInPreset?.colorScheme ?? customPreset?.colorScheme;
        const nativeWindow = builtInPreset?.window ?? customPreset?.brand?.window;
        if (authoredSchemeWindow) {
          b.window = { ...authoredSchemeWindow };
        } else if (v && nativeScheme && v === nativeScheme) {
          // Returning to a preset's native mode restores its authored window
          // palette (for example Pride purple or Ocean Blue navy).
          b.window = { ...(nativeWindow ?? {}) };
        } else {
          delete b.window;
        }
        if (Object.keys(b).length === 0) delete next.brand;
        else next.brand = b;
      }
      return next;
  }

  function setScheme(v: ColorScheme | "") {
    const apply = (base: AppearanceConfig) => applyColorScheme(disableThemeSchedule(base), v);
    setDraft(apply);
    setUserPrefs(apply(userPrefs));
    setSavedAt(Date.now());
  }

  // Auto-save helper for boolean toggles. Switches take effect immediately
  // and persist on the same tick — no Save button required (matches the
  // expectation that flipping a switch *is* the action).
  function setBoolPref<K extends keyof AppearanceConfig>(
    key: K,
    val: AppearanceConfig[K],
  ) {
    const apply = (base: AppearanceConfig): AppearanceConfig => {
      const next = { ...base };
      // Store explicitly (don't delete) so an explicit "off" survives even
      // when the default is "on" — the resolved appearance picks up our
      // value rather than falling back to the default.
      (next as Record<string, unknown>)[key as string] = val;
      return next;
    };
    setDraft(apply);
    setUserPrefs(apply(userPrefs));
    setSavedAt(Date.now());
  }

  function setImmediatePref<K extends keyof AppearanceConfig>(key: K, val: AppearanceConfig[K]) {
    setBoolPref(key, val);
  }

  function setTerminalAnsiAccent(val: string | undefined) {
    setDraft((d) => {
      const next = { ...d };
      if (val === undefined || val === "") delete next.terminalAnsiAccent;
      else next.terminalAnsiAccent = val;
      return next;
    });
  }

  function save() {
    setUserPrefs(draft);
    setSavedAt(Date.now());
  }

  function reset() {
    clearUserPrefs();
    setUserPrefs({});
    setDraft({});
    setSavedAt(Date.now());
  }

  function applyBrandPresetTo(base: AppearanceConfig, id: string): AppearanceConfig {
    const p = BRAND_PRESETS.find((x) => x.id === id);
    if (!p) return base;
    const term = TERMINAL_PRESETS.find((t) => t.id === p.terminalPresetId);
    const schemeOverride = serverConfig.themeSchemeOverrides?.[p.id];
    const presetScheme = schemeOverride?.defaultScheme ?? p.colorScheme;
    const presetWindow = schemeOverride?.schemes?.[presetScheme]?.window ?? p.window;
      const next: AppearanceConfig = { ...base };
      next.brand = {
        ...(base.brand ?? {}),
        id: p.id,
        identity: "default",
        name: p.brandName ?? "ConnCat",
        logoUrl: p.logoUrl ?? "",
        accent: p.accent,
      };
      if (presetWindow) {
        next.brand.window = { ...presetWindow };
      } else {
        delete next.brand.window;
      }
      next.colorScheme = presetScheme;
      if (term) {
        next.terminal = { ...(base.terminal ?? {}), theme: term.theme };
      }
      return next;
  }

  function applyBrandPreset(id: string) {
    const apply = (base: AppearanceConfig) => applyBrandPresetTo(disableThemeSchedule(base), id);
    setDraft(apply);
    setUserPrefs(apply(userPrefs));
    setSavedAt(Date.now());
  }

  function applyCustomPresetTo(base: AppearanceConfig, preset: ThemePreset): AppearanceConfig {
    const schemeOverride = serverConfig.themeSchemeOverrides?.[preset.id];
    const presetScheme = schemeOverride?.defaultScheme ?? preset.colorScheme;
    const presetWindow = presetScheme
      ? schemeOverride?.schemes?.[presetScheme]?.window ?? preset.brand?.window
      : preset.brand?.window;
      const next: AppearanceConfig = { ...base };
      const brand: NonNullable<AppearanceConfig["brand"]> = {
        ...(base.brand ?? {}),
        id: preset.id,
        identity: "custom",
        name: preset.brand?.name || "ConnCat",
        logoUrl: preset.brand?.logoUrl || "",
      };
      if (preset.brand?.accent) brand.accent = preset.brand.accent;
      if (presetWindow) {
        brand.window = { ...presetWindow };
      } else {
        delete brand.window;
      }
      next.brand = brand;
      if (presetScheme) next.colorScheme = presetScheme;
      if (preset.terminal) {
        const t: NonNullable<AppearanceConfig["terminal"]> = { ...(base.terminal ?? {}) };
        if (preset.terminal.theme) t.theme = preset.terminal.theme;
        if (preset.terminal.fontFamily) t.fontFamily = preset.terminal.fontFamily;
        if (typeof preset.terminal.fontSize === "number") t.fontSize = preset.terminal.fontSize;
        next.terminal = t;
      }
      return next;
  }

  function applyCustomPreset(preset: ThemePreset) {
    const apply = (base: AppearanceConfig) => applyCustomPresetTo(disableThemeSchedule(base), preset);
    setDraft(apply);
    setUserPrefs(apply(userPrefs));
    setSavedAt(Date.now());
  }

  function clearBrandThemeFrom(base: AppearanceConfig): AppearanceConfig {
      const next: AppearanceConfig = { ...base };
      // Keep an explicit default brand id so Shell can reliably render
      // default-brand UI bits (e.g. walking cat logo) after reset.
      next.brand = { id: "default", identity: "default" };
      delete next.terminal;
      delete next.colorScheme;
      return next;
  }

  function clearBrandTheme() {
    const apply = (base: AppearanceConfig) => clearBrandThemeFrom(disableThemeSchedule(base));
    setDraft(apply);
    setUserPrefs(apply(userPrefs));
    setSavedAt(Date.now());
  }

  const presetId =
    TERMINAL_PRESETS.find(
      (p) => JSON.stringify(p.theme) === JSON.stringify(draft.terminal?.theme),
    )?.id ?? (draft.terminal?.theme ? "custom" : "");
  const activeTerminalFontFamily = draft.terminal?.fontFamily ?? appearance.terminal.fontFamily;
  const selectedTerminalFont = TERMINAL_FONT_OPTIONS.find((f) => f.value === activeTerminalFontFamily);
  const terminalFontSelectValue = selectedTerminalFont ? selectedTerminalFont.value : "__custom__";

  const activeBrandId = draft.brand?.id ?? appearance.brand.id;
  const activeColorScheme = draft.colorScheme ?? appearance.colorScheme;
  const customThemePresets = Array.isArray(serverConfig.customPresets)
    ? serverConfig.customPresets.filter((preset) => !LEGACY_SPLIT_THEME_PRESET_IDS.has(preset.id))
    : [];
  const activeBuiltInTheme = BRAND_PRESETS.find((preset) => preset.id === activeBrandId);
  const activeCustomTheme = customThemePresets.find((preset) => preset.id === activeBrandId);
  const activeAppThemeValue = activeBrandId === "default"
    ? "builtin:default"
    : activeBuiltInTheme
      ? `builtin:${activeBuiltInTheme.id}`
      : activeCustomTheme
        ? `custom:${activeCustomTheme.id}`
        : "builtin:default";
  const activeAppThemeSource = activeCustomTheme ? "Site preset" : activeBrandId === "default" ? "Default" : "Built-in preset";
  const activeAppThemeScheme = activeColorScheme;
  const showWinterHint = activeBrandId === "got" && activeColorScheme === "dark";
  const appThemeOptions = [
    ...BRAND_PRESETS.map((preset) => ({
      value: `builtin:${preset.id}`,
      label: preset.label,
      color: preset.swatch ?? preset.accent,
    })),
    {
      value: "builtin:default",
      label: "Default",
      color: "linear-gradient(135deg, var(--bg), var(--panel))",
    },
    ...customThemePresets.map((preset) => ({
      value: `custom:${preset.id}`,
      label: `${preset.label} · Site preset`,
      color: preset.swatch ?? preset.brand?.accent ?? "#888",
    })),
  ];
  const colorSchemeOptions = [
    { value: "light", label: "Light" },
    { value: "medium", label: "Medium" },
    { value: "dark", label: "Dark" },
  ];

  function buildScheduledThemeTarget(
    themeValue: string,
    colorScheme: ColorScheme,
  ): ScheduledThemeTarget {
    const base: AppearanceConfig = { ...userPrefs };
    delete base.themeSchedule;
    let themed = base;
    if (themeValue === "builtin:default") {
      themed = clearBrandThemeFrom(themed);
    } else if (themeValue.startsWith("builtin:")) {
      themed = applyBrandPresetTo(themed, themeValue.slice("builtin:".length));
    } else if (themeValue.startsWith("custom:")) {
      const preset = customThemePresets.find(
        (candidate) => candidate.id === themeValue.slice("custom:".length),
      );
      if (preset) themed = applyCustomPresetTo(themed, preset);
    }
    themed = applyColorScheme(themed, colorScheme);
    return {
      themeValue,
      colorScheme,
      brand: structuredClone(themed.brand ?? { id: "default", identity: "default" }),
      ...(themed.terminal?.theme
        ? { terminal: { theme: structuredClone(themed.terminal.theme) } }
        : {}),
    };
  }

  function createDefaultThemeSchedule(): ThemeSchedule {
    return {
      enabled: false,
      dayStart: "07:00",
      nightStart: "19:00",
      day: buildScheduledThemeTarget(activeAppThemeValue, "light"),
      night: buildScheduledThemeTarget(activeAppThemeValue, "dark"),
    };
  }

  const themeSchedule = draft.themeSchedule ?? createDefaultThemeSchedule();

  function commitThemeSchedule(schedule: ThemeSchedule) {
    setDraft((current) => ({ ...current, themeSchedule: schedule }));
    setUserPrefs({ ...userPrefs, themeSchedule: schedule });
    setSavedAt(Date.now());
  }

  function updateScheduledTheme(
    period: "day" | "night",
    change: { themeValue?: string; colorScheme?: ColorScheme },
  ) {
    const currentTarget = themeSchedule[period];
    const themeValue = change.themeValue ?? currentTarget.themeValue;
    const colorScheme = change.colorScheme ?? currentTarget.colorScheme;
    commitThemeSchedule({
      ...themeSchedule,
      [period]: buildScheduledThemeTarget(themeValue, colorScheme),
    });
  }

  // Mirror the GoT+light accent override from applyToDocument so the color
  // picker reflects the actually rendered accent, not the stored fire-red.
  const effectiveAccent =
    activeBrandId === "got" && activeColorScheme === "light"
      ? "#5eb3ff"
      : (draft.brand?.accent ?? appearance.brand.accent);
  const labDeviceDoubleClickAction =
    draft.labDeviceDoubleClickAction ?? appearance.labDeviceDoubleClickAction;
  const savedConnectionDoubleClickAction =
    draft.savedConnectionDoubleClickAction ?? appearance.savedConnectionDoubleClickAction;
  const sessionGroupDoubleClickAction =
    draft.sessionGroupDoubleClickAction ?? appearance.sessionGroupDoubleClickAction;
  const sessionGroupMiddleClickAction =
    draft.sessionGroupMiddleClickAction ?? appearance.sessionGroupMiddleClickAction;
  const terminalSidebarClickBehavior =
    draft.terminalSidebarClickBehavior ?? appearance.terminalSidebarClickBehavior;
  const doubleClickConnectEnabled =
    labDeviceDoubleClickAction === "connect" || savedConnectionDoubleClickAction === "connect";
  const settingsOpenDelayMs = doubleClickConnectEnabled
    ? (draft.settingsOpenDelayMs ?? appearance.settingsOpenDelayMs)
    : 0;
  const transcriptEnabled = draft.transcriptEnabled ?? appearance.transcriptEnabled;
  const serverTerminalAnsiAccent = serverConfig.terminalAnsiAccent?.trim()
    ? serverConfig.terminalAnsiAccent
    : undefined;
  const inheritedTerminalAnsiAccent = serverTerminalAnsiAccent ?? effectiveAccent;
  const effectiveTerminalAnsiAccent = draft.terminalAnsiAccent ?? inheritedTerminalAnsiAccent;
  const surfaceOpacity =
    draft.surfaceOpacity ??
    draft.listCompactSurfaceOpacity ??
    appearance.surfaceOpacity;
  const surfaceOpacityPercent = Math.round(surfaceOpacity * 100);

  return (
    <div
      className={`settings-page workspace-page--${appearance.workspaceDesign}`}
      data-renderer-reset-dirty={dirty ? "true" : undefined}
      onContextMenu={openPageMenu}
    >
      <h2 className="page-view-title">Settings</h2>
      <section className="card settings-editable-section">
        <LazyDetails
          summary={<h3 style={{ display: "inline", margin: 0 }}>App Appearance</h3>}
          summaryStyle={{ cursor: "pointer" }}
        >
          <div className="settings-behavior-layout settings-appearance-layout">
        <div className="settings-behavior-group">
        <h4>App themes</h4>
        <div className="form-row">
          <label>Theme preset</label>
          <div className="app-theme-preset-control">
            <ThemedSelect
              ariaLabel="App theme preset"
              className="app-theme-preset-select"
              value={activeAppThemeValue}
              onChange={(value) => {
                if (value === "builtin:default") {
                  clearBrandTheme();
                  return;
                }
                if (value.startsWith("builtin:")) {
                  applyBrandPreset(value.slice("builtin:".length));
                  return;
                }
                if (value.startsWith("custom:")) {
                  const preset = customThemePresets.find((candidate) => candidate.id === value.slice("custom:".length));
                  if (preset) applyCustomPreset(preset);
                }
              }}
              options={appThemeOptions}
            />
            <span className="app-theme-preset-meta">
              {activeAppThemeSource} · {activeAppThemeScheme}
              {activeBuiltInTheme?.motto ? ` · “${activeBuiltInTheme.motto}”` : ""}
            </span>
          </div>
        </div>
        <div className="form-row">
          <SettingLabel>Color scheme</SettingLabel>
          <ThemedSelect
            ariaLabel="Color scheme"
            value={draft.colorScheme ?? ""}
            onChange={(value) => setScheme(value as ColorScheme | "")}
            style={{ width: "12.5%", minWidth: 140 }}
            options={colorSchemeOptions}
          />
          {showWinterHint && (
            <div className="winter-hint">
              <img src={gotSwatch} alt="" style={{ width: 22, height: 22, objectFit: "contain" }} />
              <span className="winter-hint__text">
                Winter is coming! Switch to Light theme for the winter effect.
              </span>
            </div>
          )}
        </div>
        <div className="form-row">
          <label>Accent color</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              style={{ width: 48, padding: 0, height: 32 }}
              value={effectiveAccent}
              onChange={(e) => setBrand("accent", e.target.value)}
            />
            <input
              placeholder={effectiveAccent}
              value={draft.brand?.accent ?? ""}
              onChange={(e) => setBrand("accent", e.target.value || undefined)}
              style={{ maxWidth: 160 }}
            />
          </div>
        </div>
        <div className="theme-schedule">
          <div className="theme-schedule__header">
            <div className="theme-schedule__copy">
              <SettingLabel info="Uses this computer's local clock. ConnCat checks the schedule while open and immediately rechecks it when the app regains focus.">
                Automatic day/night themes
              </SettingLabel>
              <span>Choose an independent theme and color scheme for daytime and nighttime.</span>
            </div>
            <Switch
              checked={themeSchedule.enabled}
              onChange={(enabled) => commitThemeSchedule({ ...themeSchedule, enabled })}
              ariaLabel="Automatically switch day and night themes"
            />
          </div>
          <div className="theme-schedule__periods">
            {(["day", "night"] as const).map((period) => {
              const target = themeSchedule[period];
              const label = period === "day" ? "Day theme" : "Night theme";
              const timeKey = period === "day" ? "dayStart" : "nightStart";
              return (
                <div className={`theme-schedule__period theme-schedule__period--${period}`} key={period}>
                  <div className="theme-schedule__period-header">
                    <strong>{label}</strong>
                    <label>
                      Starts at
                      <input
                        type="time"
                        value={themeSchedule[timeKey]}
                        onChange={(event) => commitThemeSchedule({
                          ...themeSchedule,
                          [timeKey]: event.target.value,
                        })}
                      />
                    </label>
                  </div>
                  <div className="theme-schedule__fields">
                    <label>
                      Theme
                      <ThemedSelect
                        ariaLabel={`${label} preset`}
                        value={target.themeValue}
                        options={appThemeOptions}
                        onChange={(themeValue) => updateScheduledTheme(period, { themeValue })}
                      />
                    </label>
                    <label>
                      Color scheme
                      <ThemedSelect
                        ariaLabel={`${label} color scheme`}
                        value={target.colorScheme}
                        options={colorSchemeOptions}
                        onChange={(value) => updateScheduledTheme(period, {
                          colorScheme: value as ColorScheme,
                        })}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="theme-schedule__note">
            Times use the local time on this device. Turning automation off restores your normal theme above.
          </p>
        </div>
        </div>

        <div className="settings-behavior-group">
        <h4>Interface, navigation, and controls</h4>
        <div className="settings-inline-controls appearance-dropdown-controls">
        <section className="appearance-control-section">
        <h5>Workspace &amp; page titles</h5>
        <div className="appearance-control-grid appearance-control-grid--workspace">
        <div className="form-row">
          <SettingLabel info="Applies one consistent visual hierarchy to Lab, Connections, Sessions, Remote Access, Templates, Notes, Identities, and Settings.">
            Workspace design
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Workspace design"
            value={draft.workspaceDesign ?? appearance.workspaceDesign}
            onChange={(value) => setImmediatePref(
              "workspaceDesign",
              value as WorkspaceDesign,
            )}
            style={{ width: "15%", minWidth: 190 }}
            options={[
              { value: "quiet", label: "Quiet Workspace" },
              { value: "structured", label: "Structured Split Pane" },
              { value: "commandCenter", label: "Compact Command Center" },
            ]}
          />
        </div>

        <div className="form-row">
          <SettingLabel info="Changes the decoration around primary page names such as Lab, Connections, Notes, Identities, and Settings.">
            Page title style
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Page title style"
            value={draft.pageTitleStyle ?? appearance.pageTitleStyle}
            onChange={(value) => setDraft((d) => ({
              ...d,
              pageTitleStyle: value as PageTitleStyle,
            }))}
            style={{ width: "12.5%", minWidth: 160 }}
            options={[
              { value: "plain", label: "Plain" },
              { value: "accentBar", label: "Short accent bar" },
              { value: "underline", label: "Underline" },
              { value: "frame", label: "Framed" },
              { value: "soft", label: "Soft highlight" },
            ]}
          />
        </div>

        <div className="form-row">
          <SettingLabel info="Selects the text and decoration color used by primary page titles.">
            Page title color
          </SettingLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <ThemedSelect
              ariaLabel="Page title color"
              value={draft.pageTitleColor ?? appearance.pageTitleColor}
              onChange={(value) => setDraft((d) => ({
                ...d,
                pageTitleColor: value as PageTitleColor,
              }))}
              style={{ minWidth: 160 }}
              options={[
                { value: "foreground", label: "Theme text" },
                { value: "accent", label: "Accent" },
                { value: "muted", label: "Muted" },
                { value: "custom", label: "Custom" },
              ]}
            />
            {(draft.pageTitleColor ?? appearance.pageTitleColor) === "custom" && (
              <>
                <input
                  type="color"
                  aria-label="Custom page title color"
                  value={draft.pageTitleCustomColor ?? appearance.pageTitleCustomColor}
                  onChange={(e) => setDraft((d) => ({ ...d, pageTitleCustomColor: e.target.value }))}
                  style={{ width: 48, height: 32, padding: 0 }}
                />
                <input
                  aria-label="Custom page title color value"
                  value={draft.pageTitleCustomColor ?? ""}
                  placeholder={appearance.pageTitleCustomColor}
                  onChange={(e) => setDraft((d) => ({
                    ...d,
                    pageTitleCustomColor: e.target.value || undefined,
                  }))}
                  style={{ width: 110 }}
                />
              </>
            )}
          </div>
        </div>

        </div>
        </section>
        <section className="appearance-control-section">
        <h5>Navigation &amp; toolbars</h5>
        <div className="appearance-control-grid appearance-control-grid--navigation">
        <div className="form-row">
          <SettingLabel info="Shows the primary app navigation as icons only or icons with labels. Icons and text automatically compact when space is limited.">
            Top navigation
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Top navigation display"
            value={draft.topNavigationDisplay ?? appearance.topNavigationDisplay}
            onChange={(value) => setDraft((d) => ({
              ...d,
              topNavigationDisplay: value === "icons" ? "icons" : "iconsAndText",
            }))}
            style={{ width: "12.5%", minWidth: 160 }}
            options={[
              { value: "iconsAndText", label: "Icons and text (auto compact)" },
              { value: "icons", label: "Icons only" },
            ]}
          />
        </div>

        <div className="form-row">
          <SettingLabel info="Controls sync, navigation layout, position, and backup labels on the Notes toolbar.">
            Notes toolbar
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Notes toolbar display"
            value={draft.notesToolbarDisplay ?? appearance.notesToolbarDisplay}
            onChange={(value) => setDraft((d) => ({
              ...d,
              notesToolbarDisplay: value === "iconsAndText" ? "iconsAndText" : "icons",
            }))}
            style={{ width: "12.5%", minWidth: 160 }}
            options={[
              { value: "icons", label: "Icons only" },
              { value: "iconsAndText", label: "Icons and text" },
            ]}
          />
        </div>
        <div className="form-row">
          <SettingLabel info="Controls labels for actions such as Find, Send to Notes, broadcast, and session commands.">
            Session toolbar
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Session toolbar display"
            value={draft.terminalToolbarDisplay ?? appearance.terminalToolbarDisplay}
            onChange={(value) => setDraft((d) => ({
              ...d,
              terminalToolbarDisplay: value === "iconsAndText" ? "iconsAndText" : "icons",
            }))}
            style={{ width: "12.5%", minWidth: 160 }}
            options={[
              { value: "icons", label: "Icons only" },
              { value: "iconsAndText", label: "Icons and text" },
            ]}
          />
        </div>

        <div className="form-row">
          <SettingLabel info="Controls labels for creating devices, serial consoles, local shells, and connection groups.">
            Connections toolbar
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Connections toolbar display"
            value={draft.connectionsToolbarDisplay ?? appearance.connectionsToolbarDisplay}
            onChange={(value) => setDraft((d) => ({
              ...d,
              connectionsToolbarDisplay: value === "iconsAndText" ? "iconsAndText" : "icons",
            }))}
            style={{ width: "12.5%", minWidth: 160 }}
            options={[
              { value: "icons", label: "Icons only" },
              { value: "iconsAndText", label: "Icons and text" },
            ]}
          />
        </div>

        </div>
        </section>
        <section className="appearance-control-section">
        <h5>Icons &amp; controls</h5>
        <div className="appearance-control-grid appearance-control-grid--icons">
        <div className="form-row vm-power-icons-setting">
          <SettingLabel info="Changes the power-action icons shown for VMs in every Lab view. The choice is saved immediately.">
            VM power icons
          </SettingLabel>
          <div className="vm-power-icons-setting__controls">
            <ThemedSelect
              ariaLabel="VM power icons style"
              value={draft.vmPowerControlStyle ?? appearance.vmPowerControlStyle}
              onChange={(value) => setImmediatePref("vmPowerControlStyle", value as VmPowerControlStyle)}
              style={{ width: "12.5%", minWidth: 190 }}
              options={[
                { value: "current", label: "Current compact glyphs", icon: <NotesIcon name="power" size={15} /> },
                { value: "outline", label: "Individual outline buttons", icon: <NotesIcon name="power-on" size={15} /> },
                { value: "segmented", label: "Segmented power strip", icon: <NotesIcon name="restart" size={15} /> },
                { value: "primaryDropdown", label: "Primary action + dropdown", icon: <NotesIcon name="chevron-down" size={15} /> },
              ]}
            />
            <button
              type="button"
              aria-expanded={showVmPowerIconPreview}
              aria-label={showVmPowerIconPreview ? "Hide VM power icon preview" : "Show VM power icon preview"}
              title={showVmPowerIconPreview ? "Hide preview" : "Show preview"}
              onClick={() => setShowVmPowerIconPreview((visible) => !visible)}
              style={{ width: 36, height: 34, padding: 0 }}
            >
              <NotesIcon name="preview" size={18} />
            </button>
            {showVmPowerIconPreview && (
              <span aria-hidden="true" style={{ display: "inline-flex", pointerEvents: "none" }}>
                <VmPowerControls
                  style={draft.vmPowerControlStyle ?? appearance.vmPowerControlStyle}
                  density="list"
                  busy={false}
                  powerState="POWERED_ON"
                  onAction={() => {}}
                />
              </span>
            )}
          </div>
        </div>

        <div className="form-row icon-style-setting">
          <SettingLabel info="Changes session and connection icons everywhere they appear, including tabs, toolbars, menus, and submenus.">
            Session &amp; connection icons
          </SettingLabel>
          <div className="icon-style-setting__controls">
            <ThemedSelect
              ariaLabel="Session and connection icon style"
              value={draft.sessionConnectionIconStyle ?? appearance.sessionConnectionIconStyle}
              onChange={(value) => setImmediatePref("sessionConnectionIconStyle", value as IconPresentationStyle)}
              options={[
                { value: "outline", label: "Current outline", icon: <NotesIcon name="ssh" size={15} presentationStyle="outline" /> },
                { value: "rounded", label: "Rounded", icon: <NotesIcon name="ssh" size={15} presentationStyle="rounded" /> },
                { value: "sharp", label: "Sharp", icon: <NotesIcon name="ssh" size={15} presentationStyle="sharp" /> },
                { value: "filled", label: "Filled", icon: <NotesIcon name="ssh" size={15} presentationStyle="filled" /> },
                { value: "duotone", label: "Duotone", icon: <NotesIcon name="ssh" size={15} presentationStyle="duotone" /> },
              ]}
            />
            <button type="button" aria-expanded={showSessionIconPreview} aria-label={`${showSessionIconPreview ? "Hide" : "Show"} session and connection icon preview`} title={`${showSessionIconPreview ? "Hide" : "Show"} preview`} onClick={() => setShowSessionIconPreview((visible) => !visible)}><NotesIcon name="preview" size={18} /></button>
            {showSessionIconPreview && <span className="icon-style-setting__preview" aria-hidden="true"><NotesIcon name="ssh" size={19} /><NotesIcon name="rdp" size={19} /><NotesIcon name="sftp" size={19} /><NotesIcon name="console" size={19} /></span>}
          </div>
        </div>

        <div className="form-row icon-style-setting">
          <SettingLabel info="Changes general action icons in buttons, tab toolbars, menus, and submenus without changing connection icons.">
            Button icons
          </SettingLabel>
          <div className="icon-style-setting__controls">
            <ThemedSelect
              ariaLabel="Button icon style"
              value={draft.buttonIconStyle ?? appearance.buttonIconStyle}
              onChange={(value) => setImmediatePref("buttonIconStyle", value as IconPresentationStyle)}
              options={[
                { value: "outline", label: "Current outline", icon: <NotesIcon name="settings" size={15} presentationStyle="outline" /> },
                { value: "rounded", label: "Rounded", icon: <NotesIcon name="settings" size={15} presentationStyle="rounded" /> },
                { value: "sharp", label: "Sharp", icon: <NotesIcon name="settings" size={15} presentationStyle="sharp" /> },
                { value: "filled", label: "Filled", icon: <NotesIcon name="settings" size={15} presentationStyle="filled" /> },
                { value: "duotone", label: "Duotone", icon: <NotesIcon name="settings" size={15} presentationStyle="duotone" /> },
              ]}
            />
            <button type="button" aria-expanded={showButtonIconPreview} aria-label={`${showButtonIconPreview ? "Hide" : "Show"} button icon preview`} title={`${showButtonIconPreview ? "Hide" : "Show"} preview`} onClick={() => setShowButtonIconPreview((visible) => !visible)}><NotesIcon name="preview" size={18} /></button>
            {showButtonIconPreview && <span className="icon-style-setting__preview" aria-hidden="true"><NotesIcon name="sync" size={19} /><NotesIcon name="find" size={19} /><NotesIcon name="save" size={19} /><NotesIcon name="delete" size={19} /></span>}
          </div>
        </div>

        <div className="form-row icon-style-setting">
          <SettingLabel info="Adds a lightweight hover and keyboard-focus effect to interactive icons across every theme. Theme default keeps Frost on original GoT Light, Burning on original GoT Medium/Dark, and uses Off elsewhere. Reduced Motion disables the animation.">
            Icon effects
          </SettingLabel>
          <div className="icon-style-setting__controls">
            <ThemedSelect
              ariaLabel="Interactive icon effect"
              value={draft.iconEffect ?? appearance.iconEffect}
              onChange={(value) => setImmediatePref("iconEffect", value as IconEffect)}
              options={[
                { value: "themeDefault", label: "Theme default" },
                { value: "frost", label: "Frost" },
                { value: "burning", label: "Burning" },
                { value: "electric", label: "Electric" },
                { value: "neon", label: "Neon" },
                { value: "off", label: "Off" },
              ]}
            />
          </div>
        </div>

        <div className="form-row icon-style-setting">
          <SettingLabel info="Keeps the selected Frost, Burning, Electric, or Neon effect visible on the active top-navigation icon after hover ends. Other icons remain hover/focus only.">
            Active navigation effect
          </SettingLabel>
          <div className="icon-style-setting__controls">
            <Switch
              checked={draft.keepActiveNavigationIconEffect ?? appearance.keepActiveNavigationIconEffect}
              onChange={(checked) => setBoolPref("keepActiveNavigationIconEffect", checked)}
              ariaLabel="Keep icon effect on active navigation tab"
            />
          </div>
        </div>

        <div className="form-row icon-style-setting">
          <SettingLabel info="Changes every shared OFF/ON switch button in Settings, connection panels, Notes, Templates, and Identities.">
            Switch buttons
          </SettingLabel>
          <div className="icon-style-setting__controls">
            <ThemedSelect
              ariaLabel="Switch button style"
              value={draft.switchButtonStyle ?? appearance.switchButtonStyle}
              onChange={(value) => setImmediatePref("switchButtonStyle", value as SwitchButtonStyle)}
              options={[
                { value: "segmented", label: "Segmented OFF / ON", icon: <SwitchStyleSample style="segmented" /> },
                { value: "slider", label: "Classic slider", icon: <SwitchStyleSample style="slider" /> },
                { value: "compact", label: "Compact", icon: <SwitchStyleSample style="compact" /> },
                { value: "icons", label: "Cross / check", icon: <SwitchStyleSample style="icons" /> },
                { value: "pill", label: "Filled pill", icon: <SwitchStyleSample style="pill" /> },
              ]}
            />
            <button type="button" aria-expanded={showSwitchButtonPreview} aria-label={`${showSwitchButtonPreview ? "Hide" : "Show"} switch button preview`} title={`${showSwitchButtonPreview ? "Hide" : "Show"} preview`} onClick={() => setShowSwitchButtonPreview((visible) => !visible)}><NotesIcon name="preview" size={18} /></button>
            {showSwitchButtonPreview && <span className="icon-style-setting__preview icon-style-setting__preview--switches" aria-hidden="true"><Switch checked={false} onChange={() => {}} /><Switch checked onChange={() => {}} /></span>}
          </div>
        </div>
        </div>
        </section>
        </div>
        </div>

        <div className="settings-behavior-group">
        <h4>Background and surfaces</h4>
        <div className="form-row">
          <SettingLabel info="Affects app cards, Settings, Identities, focus cards, and list/compact rows. Text, controls, and terminals stay solid.">
            Surface background opacity
          </SettingLabel>
          <div className="settings-slider-control">
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.01}
              value={surfaceOpacity}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                setDraft((d) => ({
                  ...d,
                  surfaceOpacity: Number.isFinite(n) ? n : undefined,
                  listCompactSurfaceOpacity: undefined,
                }));
              }}
            />
            <input
              type="number"
              min={20}
              max={100}
              step={1}
              value={surfaceOpacityPercent}
              aria-label="Surface background opacity percentage"
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                setDraft((d) => ({
                  ...d,
                  surfaceOpacity: Math.min(100, Math.max(20, n)) / 100,
                  listCompactSurfaceOpacity: undefined,
                }));
              }}
            />
            <span className="settings-slider-unit">%</span>
            {(draft.surfaceOpacity !== undefined || draft.listCompactSurfaceOpacity !== undefined) && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset surface background opacity"
                title="Reset surface background opacity"
                onClick={() => setDraft((d) => {
                  const n = { ...d };
                  delete n.surfaceOpacity;
                  delete n.listCompactSurfaceOpacity;
                  return n;
                })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        </div>

        <div className="settings-behavior-group">
        <h4>Interface sizing</h4>
        <div className="form-row">
          <SettingLabel info="Changes app chrome, navigation, page titles, forms, and controls. Workspace cards and the terminal have separate font sizes.">
            App font size
          </SettingLabel>
          <div className="settings-slider-control">
            <input
              type="range"
              min={12}
              max={24}
              step={1}
              value={draft.appFontSize ?? appearance.appFontSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => ({ ...d, appFontSize: Number.isFinite(n) ? n : undefined }));
              }}
            />
            <input
              type="number"
              min={12}
              max={24}
              value={draft.appFontSize ?? ""}
              placeholder={String(appearance.appFontSize)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => {
                  const next = { ...d };
                  if (Number.isFinite(n)) next.appFontSize = n;
                  else delete next.appFontSize;
                  return next;
                });
              }}
            />
            <span className="settings-slider-unit">px</span>
            {draft.appFontSize !== undefined && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset app font size"
                title="Reset app font size"
                onClick={() => setDraft((d) => { const n = { ...d }; delete n.appFontSize; return n; })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="form-row">
          <SettingLabel info="Changes cards and data rows across all workspace designs and List, Compact, and Focus views.">
            Card font size
          </SettingLabel>
          <div className="settings-slider-control">
            <input
              type="range"
              min={12}
              max={24}
              step={1}
              value={draft.cardFontSize ?? appearance.cardFontSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => ({ ...d, cardFontSize: Number.isFinite(n) ? n : undefined }));
              }}
            />
            <input
              type="number"
              min={12}
              max={24}
              value={draft.cardFontSize ?? ""}
              placeholder={String(appearance.cardFontSize)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => {
                  const next = { ...d };
                  if (Number.isFinite(n)) next.cardFontSize = Math.min(24, Math.max(12, n));
                  else delete next.cardFontSize;
                  return next;
                });
              }}
            />
            <span className="settings-slider-unit">px</span>
            {draft.cardFontSize !== undefined && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset card font size"
                title="Reset card font size"
                onClick={() => setDraft((d) => {
                  const next = { ...d };
                  delete next.cardFontSize;
                  return next;
                })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="form-row">
          <SettingLabel info="Changes device and connection action icons, including SSH, RDP, SFTP, Browse, Console, and booking controls.">
            Lab &amp; Connections icon size
          </SettingLabel>
          <div className="settings-slider-control">
            <input
              type="range"
              min={14}
              max={32}
              step={1}
              value={draft.connectionActionIconSize ?? appearance.connectionActionIconSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => ({
                  ...d,
                  connectionActionIconSize: Number.isFinite(n) ? n : undefined,
                }));
              }}
            />
            <input
              type="number"
              min={14}
              max={32}
              value={draft.connectionActionIconSize ?? ""}
              placeholder={String(appearance.connectionActionIconSize)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => {
                  const next = { ...d };
                  if (Number.isFinite(n)) next.connectionActionIconSize = Math.min(32, Math.max(14, n));
                  else delete next.connectionActionIconSize;
                  return next;
                });
              }}
            />
            <span className="settings-slider-unit">px</span>
            {draft.connectionActionIconSize !== undefined && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset connection icon size"
                title="Reset connection icon size"
                onClick={() => setDraft((d) => {
                  const next = { ...d };
                  delete next.connectionActionIconSize;
                  return next;
                })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="form-row">
          <SettingLabel info="Square-card edge length used by the focus-grid view on Devices and Connections.">
            Focus card size
          </SettingLabel>
          <div className="settings-slider-control">
            <input
              type="range"
              min={220}
              max={360}
              step={10}
              value={draft.focusCardSize ?? appearance.focusCardSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => ({ ...d, focusCardSize: Number.isFinite(n) ? n : undefined }));
              }}
            />
            <input
              type="number"
              min={220}
              max={360}
              value={draft.focusCardSize ?? ""}
              placeholder={String(appearance.focusCardSize)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => {
                  const next = { ...d };
                  if (Number.isFinite(n)) next.focusCardSize = n;
                  else delete next.focusCardSize;
                  return next;
                });
              }}
            />
            <span className="settings-slider-unit">px</span>
            {draft.focusCardSize !== undefined && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset focus card size"
                title="Reset focus card size"
                onClick={() => setDraft((d) => { const n = { ...d }; delete n.focusCardSize; return n; })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        </div>
          </div>
        </LazyDetails>
        <button
          type="button"
          className="settings-section-save"
          onClick={save}
          disabled={!dirty}
          title="Save appearance settings"
        >
          <NotesIcon name="save" size={15} />
          Save
        </button>
      </section>

      <section className="card settings-editable-section">
        <LazyDetails
          summary={<h3 style={{ display: "inline", margin: 0 }}>Terminal Appearance</h3>}
          summaryStyle={{ cursor: "pointer" }}
        >
          <div className="settings-behavior-layout settings-terminal-appearance-layout">
        <div className="settings-behavior-group">
        <h4>Terminal colors</h4>
        <div className="settings-behavior-fields">
        <div
          className="form-row"
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <Switch
            checked={draft.tintTerminalText ?? appearance.tintTerminalText}
            onChange={(v) => setBoolPref('tintTerminalText', v)}
          />
          <SettingLabel
            style={{ margin: 0 }}
            info="When a session or device has a color, new terminal tabs use it as the foreground/cursor color. Tabs without a card color use the terminal ANSI accent below."
          >
            Tint terminal text with card color
          </SettingLabel>
        </div>
        <div className="form-row">
          <SettingLabel info="Used for the monochrome ANSI palette in new terminal tabs when terminal tinting is enabled and no device/session color is set. Leave empty to follow the app accent.">
            Terminal ANSI accent
          </SettingLabel>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="color"
              style={{ width: 48, padding: 0, height: 32 }}
              value={effectiveTerminalAnsiAccent}
              onChange={(e) => setTerminalAnsiAccent(e.target.value)}
              title="Accent used for terminal ANSI tinting when a tab has no card color"
            />
            <input
              placeholder={inheritedTerminalAnsiAccent}
              value={draft.terminalAnsiAccent ?? ""}
              onChange={(e) => setTerminalAnsiAccent(e.target.value || undefined)}
              style={{ maxWidth: 160 }}
            />
            {draft.terminalAnsiAccent !== undefined && (
              <button
                type="button"
                onClick={() => setTerminalAnsiAccent(undefined)}
                style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                <NotesIcon name="history" size={15} />
                Reset
              </button>
            )}
          </div>
        </div>
        </div>
        </div>

        <div className="settings-behavior-group">
        <h4>Terminal display</h4>
        <div className="settings-behavior-fields">
        <div className="form-row">
          <SettingLabel info="Auto uses the lower-memory DOM renderer on macOS and accelerated WebGL elsewhere. Choose WebGL to force GPU rendering, or DOM to minimize graphics memory retention.">
            Renderer
          </SettingLabel>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ThemedSelect
              ariaLabel="Terminal renderer"
              value={draft.terminalRenderer ?? appearance.terminalRenderer}
              options={[
                { value: "auto", label: "Auto (recommended)" },
                { value: "dom", label: "DOM — lower memory" },
                { value: "webgl", label: "WebGL — accelerated" },
              ]}
              onChange={(value) => setDraft((d) => ({
                ...d,
                terminalRenderer: value as TerminalRenderer,
              }))}
              style={{ minWidth: 220 }}
            />
            {draft.terminalRenderer !== undefined && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset terminal renderer"
                title="Use inherited terminal renderer"
                onClick={() => setDraft((d) => {
                  const next = { ...d };
                  delete next.terminalRenderer;
                  return next;
                })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="form-row">
          <SettingLabel info="Maximum lines kept in each terminal tab's scroll buffer. Per-session and per-device overrides take precedence.">
            Scrollback
          </SettingLabel>
          <div className="settings-slider-control">
            <input
              type="range"
              min={100}
              max={100000}
              step={100}
              value={draft.terminalScrollback ?? appearance.terminalScrollback}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => ({ ...d, terminalScrollback: Number.isFinite(n) ? n : undefined }));
              }}
            />
            <input
              type="number"
              min={100}
              max={100000}
              step={100}
              value={draft.terminalScrollback ?? ""}
              placeholder={String(appearance.terminalScrollback)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDraft((d) => {
                  const next = { ...d };
                  if (Number.isFinite(n)) next.terminalScrollback = n;
                  else delete next.terminalScrollback;
                  return next;
                });
              }}
            />
            <span className="settings-slider-unit">lines</span>
            {draft.terminalScrollback !== undefined && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                aria-label="Reset terminal scrollback"
                title="Reset terminal scrollback"
                onClick={() => setDraft((d) => { const n = { ...d }; delete n.terminalScrollback; return n; })}
              >
                <NotesIcon name="history" size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="form-row">
          <SettingLabel info="Terminal appearance changes apply to new tabs; existing tabs keep their current theme.">
            Theme preset
          </SettingLabel>
          <ThemedSelect
            ariaLabel="Terminal theme preset"
            value={presetId}
            onChange={(id) => {
              if (!id) {
                setTerm("theme", undefined);
                return;
              }
              const p = TERMINAL_PRESETS.find((x) => x.id === id);
              if (p) setTerm("theme", p.theme);
            }}
            style={{ width: "12.5%", minWidth: 140 }}
            options={[
              { value: "", label: "Default" },
              ...TERMINAL_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
              ...(presetId === "custom" ? [{ value: "custom", label: "Custom (from server)" }] : []),
            ]}
          />
        </div>
        <div className="form-row">
          <label>Font size</label>
          <input
            type="number"
            min={8}
            max={32}
            placeholder={String(appearance.terminal.fontSize)}
            value={draft.terminal?.fontSize ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setTerm("fontSize", Number.isFinite(n) ? n : undefined);
            }}
            style={{ maxWidth: 120 }}
          />
        </div>
        <div className="form-row">
          <SettingLabel info={`${selectedTerminalFont?.hint ?? "Existing custom font stack."} ${activeTerminalFontFamily}`}>
            Font family
          </SettingLabel>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <ThemedSelect
              ariaLabel="Terminal font family"
              value={terminalFontSelectValue}
              onChange={(value) => {
                if (value === "__custom__") return;
                setTerm("fontFamily", value === DEFAULTS.terminal.fontFamily ? undefined : value);
              }}
              style={{ width: "22ch", maxWidth: "100%", flex: "0 0 auto" }}
              options={[
                ...TERMINAL_FONT_OPTIONS.map((font) => ({ value: font.value, label: font.label })),
                ...(!selectedTerminalFont ? [{ value: "__custom__", label: "Custom/current" }] : []),
              ]}
            />
            {draft.terminal?.fontFamily !== undefined && (
              <button
                type="button"
                onClick={() => setTerm("fontFamily", undefined)}
                style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
              >
                <NotesIcon name="history" size={15} />
                Reset
              </button>
            )}
          </div>
        </div>
        </div>
        </div>
          </div>
        </LazyDetails>
        <button
          type="button"
          className="settings-section-save"
          onClick={save}
          disabled={!dirty}
          title="Save terminal appearance settings"
        >
          <NotesIcon name="save" size={15} />
          Save
        </button>
      </section>

      <section className="card settings-editable-section">
        <LazyDetails
          summary={<h3 style={{ display: "inline", margin: 0 }}>App Behavior</h3>}
          summaryStyle={{ cursor: "pointer" }}
        >
          <div className="settings-behavior-layout">
            <div className="settings-behavior-group">
              <h4>Opening defaults</h4>
              <div className="settings-behavior-fields">
                <div className="form-row">
              <SettingLabel info="Default for RDP actions on saved Connections. Individual Connections can override it. Lab-device and Remote Access RDP are unchanged.">
                Connections RDP — Open with
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Default saved Connection RDP application"
                value={draft.savedConnectionRdpApp ?? appearance.savedConnectionRdpApp}
                onChange={(value) => setBoolPref(
                  "savedConnectionRdpApp",
                  value as RdpOpenMode,
                )}
                style={{ width: "24ch", maxWidth: "100%" }}
                options={[
                  { value: "catwalk", label: "ConnCat RDP (IronRDP)" },
                  { value: "freerdp", label: "ConnCat FreeRDP" },
                  { value: "system", label: "System RDP client" },
                ]}
              />
                </div>
                <div className="form-row">
              <SettingLabel info="Default for Browse actions. Individual devices and saved connections can override it.">
                Browse — Open with
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Default browse application"
                value={draft.browseOpenMode ?? appearance.browseOpenMode}
                onChange={(value) => setBoolPref(
                  "browseOpenMode",
                  value === "external"
                    ? "external"
                    : value === "window"
                      ? "window"
                      : "in_app",
                )}
                style={{ width: "22ch", maxWidth: "100%" }}
                options={[
                  { value: "in_app", label: "In-app browser" },
                  { value: "window", label: "External ConnCat window" },
                  { value: "external", label: "Default OS browser" },
                ]}
              />
                </div>
              </div>
            </div>

            <div className="settings-behavior-group">
              <h4>Terminal interaction</h4>
              <div className="settings-behavior-switches">
                <div className="settings-behavior-switch">
              <Switch
                checked={draft.terminalAutoCopySelection ?? appearance.terminalAutoCopySelection}
                onChange={(v) => setBoolPref("terminalAutoCopySelection", v)}
              />
              <SettingLabel style={{ margin: 0 }} info="Highlight text in any terminal pane and it is copied without pressing Ctrl+C.">
                Auto-copy terminal selection to clipboard
              </SettingLabel>
                </div>
                <div className="settings-behavior-switch">
              <Switch
                checked={draft.terminalRightClickPaste ?? appearance.terminalRightClickPaste}
                onChange={(v) => setBoolPref("terminalRightClickPaste", v)}
              />
              <SettingLabel style={{ margin: 0 }} info="Right-clicking inside a terminal pane pastes the clipboard contents into the running shell.">
                Right-click pastes into terminal
              </SettingLabel>
                </div>
              </div>
            </div>

            <div className="settings-behavior-group">
              <h4>Keyboard shortcuts</h4>
              <div className="settings-behavior-fields">
                <div className="form-row">
              <SettingLabel info="Sends selected terminal output to the Book and Section remembered by the Notes button in the tab bar.">
                Send terminal selection to Notes
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Send terminal selection to Notes shortcut"
                value={draft.terminalNotesShortcut ?? appearance.terminalNotesShortcut}
                onChange={(value) => setBoolPref(
                  "terminalNotesShortcut",
                  value === "primaryAltN"
                    ? "primaryAltN"
                    : value === "disabled"
                      ? "disabled"
                      : "primaryShiftN",
                )}
                style={{ width: "22ch", maxWidth: "100%" }}
                options={[
                  { value: "primaryShiftN", label: "Ctrl/Cmd + Shift + N" },
                  { value: "primaryAltN", label: "Ctrl/Cmd + Alt + N" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
                </div>
                <div className="form-row">
              <SettingLabel info="Opens the Identities page from anywhere in the main ConnCat window.">
                Open Identities
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Open Identities shortcut"
                value={draft.identitiesShortcut ?? appearance.identitiesShortcut}
                onChange={(value) => setBoolPref(
                  "identitiesShortcut",
                  value === "primaryAltI"
                    ? "primaryAltI"
                    : value === "disabled"
                      ? "disabled"
                      : "primaryShiftI",
                )}
                style={{ width: "22ch", maxWidth: "100%" }}
                options={[
                  { value: "primaryShiftI", label: "Ctrl/Cmd + Shift + I" },
                  { value: "primaryAltI", label: "Ctrl/Cmd + Alt + I" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
                </div>
                <div className="form-row">
              <SettingLabel info="Retrieves the configured 1Password Login and submits it to an active SSH, RDP, VM console, or CML password prompt.">
                Submit 1Password login
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Submit 1Password login shortcut"
                value={draft.onePasswordShortcut ?? appearance.onePasswordShortcut}
                onChange={(value) => setBoolPref(
                  "onePasswordShortcut",
                  value === "primaryAltP"
                    ? "primaryAltP"
                    : value === "disabled"
                      ? "disabled"
                      : "primaryShiftP",
                )}
                style={{ width: "26ch", maxWidth: "100%" }}
                options={[
                  { value: "primaryShiftP", label: "Ctrl/Cmd + Shift + P" },
                  { value: "primaryAltP", label: "Ctrl/Cmd + Alt/Option + P" },
                  { value: "disabled", label: "Disabled" },
                ]}
              />
                </div>
              </div>
              <div className="settings-fixed-shortcuts" aria-label="Fixed keyboard shortcuts">
                <div className="settings-fixed-shortcuts-heading">
                  <strong>Fixed shortcuts</strong>
                  <span>Built in and not configurable</span>
                </div>
                <dl>
                  <div><dt><kbd>Ctrl</kbd> + <kbd>Tab</kbd></dt><dd>Next ConnCat workspace</dd></div>
                  <div><dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Tab</kbd></dt><dd>Previous ConnCat workspace</dd></div>
                  <div><dt><kbd>Ctrl</kbd> + <kbd>PageUp</kbd></dt><dd>Previous Sessions or Remote Access tab</dd></div>
                  <div><dt><kbd>Ctrl</kbd> + <kbd>PageDown</kbd></dt><dd>Next Sessions or Remote Access tab</dd></div>
                  <div><dt><kbd>Ctrl</kbd> + <kbd>1…9</kbd></dt><dd>Open Sessions or Remote Access tab by position</dd></div>
                </dl>
              </div>
            </div>

            <div className="settings-behavior-group">
              <h4>Terminal transcripts</h4>
              <div className="settings-behavior-transcript">
                <div className="settings-behavior-switch">
              <Switch
                checked={transcriptEnabled}
                onChange={(v) => setBoolPref("transcriptEnabled", v)}
              />
              <SettingLabel
                style={{ margin: 0 }}
                info="Every in-app terminal tab streams its output to <name>_YYYY-MM-DD_HH-MM-SS.log in the chosen directory. ANSI escape codes are stripped for readability."
              >
                Save terminal session to file
              </SettingLabel>
                </div>
            {transcriptEnabled && (
              <>
                <div className="form-row">
                  <SettingLabel info="Default directory where in-app terminal transcripts are saved. Connection and Lab-device settings can override this location.">
                    Transcript directory
                  </SettingLabel>
                  <div className="settings-path-control">
                    <input
                      type="text"
                      placeholder={appearance.transcriptDir || "/path/to/dir"}
                      value={draft.transcriptDir ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraft((d) => {
                          const next = { ...d };
                          if (v) next.transcriptDir = v;
                          else delete next.transcriptDir;
                          return next;
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="outline-action-button outline-action-button--icon btn-small"
                      aria-label="Choose transcript directory"
                      title="Choose transcript directory"
                      onClick={async () => {
                        const start = draft.transcriptDir || appearance.transcriptDir || undefined;
                        const picked = await openDialog({ directory: true, multiple: false, defaultPath: start });
                        if (typeof picked === "string" && picked) {
                          setDraft((d) => ({ ...d, transcriptDir: picked }));
                        }
                      }}
                    >
                      <NotesIcon name="choose" size={15} />
                    </button>
                    {draft.transcriptDir !== undefined && (
                      <button
                        type="button"
                        className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
                        aria-label="Reset transcript directory"
                        title="Reset transcript directory"
                        onClick={() => setDraft((d) => { const n = { ...d }; delete n.transcriptDir; return n; })}
                      >
                        <NotesIcon name="history" size={15} />
                      </button>
                    )}
                  </div>
                </div>
                {!(draft.transcriptDir ?? appearance.transcriptDir) && (
                  <p style={{ color: "var(--warn, #c08a30)", fontSize: "0.85rem", margin: "-4px 0 12px" }}>
                    Pick a directory to enable transcripts; without one nothing is written.
                  </p>
                )}
              </>
            )}
              </div>
            </div>

            <div className="settings-behavior-group">
              <h4>Click behavior</h4>
              <div className="settings-behavior-fields">
                <div className="form-row">
              <SettingLabel info="Applies to grouped terminal tabs in the tab strip. Single-click still arranges the group.">
                Session group double-click
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Session group double-click action"
                value={sessionGroupDoubleClickAction}
                onChange={(value) => setBoolPref(
                  "sessionGroupDoubleClickAction",
                  value as SessionGroupDoubleClickAction,
                )}
                style={{ width: "22ch", maxWidth: "100%" }}
                options={SESSION_GROUP_DOUBLE_CLICK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
                </div>
                <div className="form-row">
              <SettingLabel info="Applies to grouped terminal tabs in the tab strip. Single-click still arranges the group.">
                Session group middle-click
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Session group middle-click action"
                value={sessionGroupMiddleClickAction}
                onChange={(value) => setBoolPref(
                  "sessionGroupMiddleClickAction",
                  value as SessionGroupMiddleClickAction,
                )}
                style={{ width: "22ch", maxWidth: "100%" }}
                options={SESSION_GROUP_MIDDLE_CLICK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
                </div>
                <div className="form-row">
              <label>Lab devices double-click</label>
              <ThemedSelect
                ariaLabel="Lab device double-click action"
                value={labDeviceDoubleClickAction}
                onChange={(value) => setBoolPref(
                  "labDeviceDoubleClickAction",
                  value as EntityDoubleClickAction,
                )}
                style={{ width: "18ch", maxWidth: "100%" }}
                options={ENTITY_DOUBLE_CLICK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
                </div>
                <div className="form-row">
              <label>Connections double-click</label>
              <ThemedSelect
                ariaLabel="Connection double-click action"
                value={savedConnectionDoubleClickAction}
                onChange={(value) => setBoolPref(
                  "savedConnectionDoubleClickAction",
                  value as EntityDoubleClickAction,
                )}
                style={{ width: "18ch", maxWidth: "100%" }}
                options={ENTITY_DOUBLE_CLICK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
                </div>
                <div className="form-row">
              <SettingLabel info="Controls the Lab/Connections sidebar shown inside the terminal workspace. Cmd/Ctrl-click still adds rows to multi-select.">
                Sessions sidebar row click
              </SettingLabel>
              <ThemedSelect
                ariaLabel="Sessions sidebar row click behavior"
                value={terminalSidebarClickBehavior}
                onChange={(value) => setBoolPref(
                  "terminalSidebarClickBehavior",
                  value as TerminalSidebarClickBehavior,
                )}
                style={{ width: "28ch", maxWidth: "100%" }}
                options={TERMINAL_SIDEBAR_CLICK_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
                </div>
                <div className="form-row">
              <SettingLabel info="Default is 500ms while Lab or Connections double-click is set to connect. When both are disabled, settings open immediately.">
                Open settings delay
              </SettingLabel>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="number"
                  min={0}
                  max={2000}
                  step={50}
                  value={doubleClickConnectEnabled ? (draft.settingsOpenDelayMs ?? "") : ""}
                  placeholder={String(settingsOpenDelayMs)}
                  disabled={!doubleClickConnectEnabled}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    setDraft((d) => {
                      const next = { ...d };
                      if (Number.isFinite(n)) next.settingsOpenDelayMs = n;
                      else delete next.settingsOpenDelayMs;
                      return next;
                    });
                  }}
                  style={{ width: 110 }}
                />
                <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>ms</span>
                {draft.settingsOpenDelayMs !== undefined && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => { const n = { ...d }; delete n.settingsOpenDelayMs; return n; })}
                    style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
                  >
                    <NotesIcon name="history" size={15} />
                    Reset
                  </button>
                  )}
              </div>
                </div>
              </div>
            <Link
              to="/double-click"
              className="btn-secondary btn-small outline-action-link"
              style={{ alignSelf: "flex-start" }}
            >
              <NotesIcon name="test" size={15} />
              Open Click Test
            </Link>
            </div>
          </div>
        </LazyDetails>
        <button
          type="button"
          className="settings-section-save"
          onClick={save}
          disabled={!dirty}
          title="Save app behavior settings"
        >
          <NotesIcon name="save" size={15} />
          Save
        </button>
      </section>

      <section className="card settings-editable-section">
        <LazyDetails
          summary={<h3 style={{ display: "inline", margin: 0 }}>Diagnostics</h3>}
          summaryStyle={{ cursor: "pointer" }}
        >
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Enable scoped debug logging for this ConnCat installation. Warning and error events are always retained;
          terminal content, file contents, credentials, screenshots, and clipboard data are never collected.
        </p>
        {diagnostics ? (
          <>
            <div className="diagnostics-channel-grid">
              {diagnostics.channels.map((channel) => (
                <div key={channel.key} className="diagnostics-channel-card">
                  <strong>{channel.label}</strong>
                  <span className="diagnostics-channel-card__description">{channel.description}</span>
                  {channel.remote_enabled && (
                    <span className="diagnostics-channel-card__remote">
                      Active for a remote support session
                    </span>
                  )}
                  <Switch
                    ariaLabel={`${channel.label} diagnostics`}
                    checked={channel.local_enabled}
                    onChange={(enabled) => {
                      const selected = diagnostics.channels
                        .filter((item) => item.key === channel.key ? enabled : item.local_enabled)
                        .map((item) => item.key);
                      void saveDiagnosticChannels(selected);
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
              <button type="button" className="outline-action-button" disabled={diagnosticsBusy} onClick={() => void saveDiagnosticChannels(diagnostics.channels.map((c) => c.key))}>
                <NotesIcon name="test" size={15} />
                Enable all
              </button>
              <button type="button" className="outline-action-button outline-action-button--muted" disabled={diagnosticsBusy} onClick={() => void saveDiagnosticChannels([])}>
                <NotesIcon name="cancel" size={15} />
                Disable all
              </button>
              <button type="button" className="outline-action-button" disabled={diagnosticsBusy} onClick={() => void exportDiagnostics()}>
                <NotesIcon name="backup" size={15} />
                Export bundle
              </button>
              <button
                type="button"
                className="outline-action-button outline-action-button--danger"
                disabled={diagnosticsBusy || diagnostics.log_bytes === 0}
                title="Clear retained diagnostic logs"
                onClick={() => setShowClearDiagnosticsConfirm(true)}
              >
                <NotesIcon name="delete" size={15} />
                Clear logs
              </button>
              <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                {Math.round(diagnostics.log_bytes / 1024)} KiB of {Math.round(diagnostics.max_log_bytes / 1024 / 1024)} MiB retained
              </span>
            </div>
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>Loading diagnostics…</p>
        )}
        {diagnosticsMessage && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>{diagnosticsMessage}</p>}
        {diagnostics && showClearDiagnosticsConfirm && (
          <div className="app-dialog-backdrop" onMouseDown={() => setShowClearDiagnosticsConfirm(false)}>
            <section
              className="card app-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-diagnostics-title"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="app-dialog-header">
                <span className="app-dialog-icon" aria-hidden="true"><NotesIcon name="delete" size={21} /></span>
                <div>
                  <h3 id="clear-diagnostics-title">Clear diagnostic logs?</h3>
                  <p>{Math.round(diagnostics.log_bytes / 1024)} KiB currently retained</p>
                </div>
              </header>
              <div className="app-dialog-body">
                <p>This removes the current and rotated ConnCat logs. Enabled diagnostic channels and remote-support settings will not change.</p>
              </div>
              <div className="app-dialog-actions">
                <button type="button" className="outline-action-button outline-action-button--muted" onClick={() => setShowClearDiagnosticsConfirm(false)}>
                  <NotesIcon name="cancel" size={15} />
                  Cancel
                </button>
                <button type="button" className="outline-action-button outline-action-button--danger" autoFocus onClick={() => void clearDiagnostics()}>
                  <NotesIcon name="delete" size={15} />
                  Clear logs
                </button>
              </div>
            </section>
          </div>
        )}
        </LazyDetails>
      </section>

      {rendererLifecycle.status?.supported && (
        <section className="card settings-editable-section">
          <LazyDetails
            summary={<h3 style={{ display: "inline", margin: 0 }}>Renderer Memory</h3>}
            summaryStyle={{ cursor: "pointer" }}
          >
            <p style={{ color: "var(--muted)", marginTop: 0 }}>
              Recreate the macOS renderer to release graphics backing stores retained by WebKit. ConnCat keeps the
              native window, local preferences, and this route.
            </p>
            <div className="renderer-memory-controls">
              <div className="renderer-memory-option">
                <div>
                  <strong>Recover after background idle</strong>
                  <p>
                    Enabled by default on macOS. ConnCat may recover after five minutes in the background on safe
                    local routes, following substantial navigation or resize activity and no
                    more than once per hour. Open editors and unsaved changes block recovery.
                  </p>
                </div>
                <Switch
                  ariaLabel="Recover renderer memory after background idle"
                  checked={rendererLifecycle.autoEnabled}
                  onChange={rendererLifecycle.setAutoEnabled}
                />
              </div>
              <div className="renderer-memory-actions">
                <button
                  type="button"
                  className="outline-action-button"
                  disabled={dirty || rendererLifecycle.resetting || (rendererLifecycle.status?.blockers.length ?? 0) > 0}
                  onClick={() => {
                    setRendererResetMessage("");
                    setShowRendererResetConfirm(true);
                  }}
                >
                  <NotesIcon name="sync" size={15} />
                  Reclaim renderer memory
                </button>
                <span className="renderer-memory-status">
                  Churn score: {rendererLifecycle.churnScore} (automatic threshold: 8)
                </span>
              </div>
              {dirty && <p className="renderer-memory-warning">Save or reset Settings changes first.</p>}
              {(rendererLifecycle.status?.blockers.length ?? 0) > 0 && (
                <p className="renderer-memory-warning">
                  {rendererLifecycle.status!.blockers.map((item) => item.message).join("; ")}
                </p>
              )}
              {rendererResetMessage && <p className="renderer-memory-warning">{rendererResetMessage}</p>}
            </div>
            {showRendererResetConfirm && (
              <div
                className="app-dialog-backdrop"
                data-renderer-reset-dialog
                onMouseDown={() => setShowRendererResetConfirm(false)}
              >
                <section
                  className="card app-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="renderer-reset-title"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <header className="app-dialog-header">
                    <span className="app-dialog-icon" aria-hidden="true"><NotesIcon name="sync" size={21} /></span>
                    <div>
                      <h3 id="renderer-reset-title">Reclaim renderer memory?</h3>
                      <p>The ConnCat interface will briefly disappear and return.</p>
                    </div>
                  </header>
                  <div className="app-dialog-body">
                    <p>
                      Your route, scroll position, theme, and saved preferences will be restored. ConnCat
                      checks again for active sessions before replacing the renderer.
                    </p>
                  </div>
                  <div className="app-dialog-actions">
                    <button
                      type="button"
                      className="outline-action-button outline-action-button--muted"
                      onClick={() => setShowRendererResetConfirm(false)}
                    >
                      <NotesIcon name="cancel" size={15} />
                      Cancel
                    </button>
                    <button type="button" autoFocus onClick={() => void reclaimRendererMemory()}>
                      <NotesIcon name="sync" size={15} />
                      Reclaim
                    </button>
                  </div>
                </section>
              </div>
            )}
          </LazyDetails>
        </section>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={save} disabled={!dirty}><NotesIcon name="save" size={15} />Save</button>
        <button
          onClick={reset}
          className="outline-action-button"
        >
          <NotesIcon name="history" size={15} />
          Reset to server defaults
        </button>
        <button
          onClick={() => { void refreshServer(); }}
          className="outline-action-button"
        >
          <NotesIcon name="sync" size={15} />
          Refresh server config
        </button>
        {savedAt && <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Saved.</span>}
      </div>

      <LazyDetails
        summary="Debug: effective config"
        style={{ marginTop: "1.5rem" }}
        summaryStyle={{ color: "var(--muted)", cursor: "pointer" }}
      >
        <pre style={{ background: "#0b1220", padding: "0.75rem", borderRadius: 6, overflow: "auto" }}>
          {JSON.stringify({ server: serverConfig, user: userPrefs, effective: appearance }, null, 2)}
        </pre>
      </LazyDetails>
      {menu && (
        <ContextMenu
          position={menu.pos}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
