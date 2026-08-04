/// Appearance / branding config. Three-layer merge:
///   built-in defaults  <  server (fetchSiteConfig)  <  local user overrides
/// User overrides live in localStorage; server values refresh per-mount.

import { GOT_HOUSE_THEMES } from "../theme/gotHouseThemes";

export type ColorScheme = "dark" | "medium" | "light";

export interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  selectionBackground?: string;
  black?: string;
  brightBlack?: string;
  red?: string;
  brightRed?: string;
  green?: string;
  brightGreen?: string;
  yellow?: string;
  brightYellow?: string;
  blue?: string;
  brightBlue?: string;
  magenta?: string;
  brightMagenta?: string;
  cyan?: string;
  brightCyan?: string;
  white?: string;
  brightWhite?: string;
}

export interface BrandConfig {
  /// Optional identifier of the brand preset (used to hook brand-specific CSS
  /// via the `[data-brand="..."]` selector on `<html>`). Free-form string.
  id?: string;
  /// Controls whether a locally selected theme uses ConnCat's built-in
  /// identity or the selected custom preset's name/logo. This prevents a
  /// site-default custom logo from leaking into built-in themes.
  identity?: "default" | "custom";
  name?: string;
  logoUrl?: string;
  accent?: string;
  /// Optional full window palette. When present, overrides the surface mode
  /// scheme's CSS variables so the whole app picks up the brand colors,
  /// not just the accent. All fields are independently optional — any
  /// missing one falls back to the active colorScheme's default.
  window?: WindowPalette;
}

export interface WindowPalette {
  bg?: string;
  panel?: string;
  fg?: string;
  muted?: string;
  border?: string;
  inputBg?: string;
  btnFg?: string;
}

export interface TerminalConfig {
  theme?: TerminalTheme;
  fontSize?: number;
  fontFamily?: string;
}

export type SessionGroupDoubleClickAction = "reconnect" | "closeAll" | "none" | "ungroup";
export type SessionGroupMiddleClickAction = "closeAll" | "ungroup" | "none" | "reconnect";
export type EntityDoubleClickAction = "connect" | "none";
export type TerminalSidebarClickBehavior = "singleClickOpen" | "doubleClickOpen" | "selectOnly" | "none";
export type BrowseOpenMode = "in_app" | "window" | "external";
export type RdpOpenMode = "catwalk" | "freerdp" | "system";
export type TerminalNotesShortcut = "primaryShiftN" | "primaryAltN" | "disabled";
export type IdentitiesShortcut = "primaryShiftI" | "primaryAltI" | "disabled";
export type OnePasswordShortcut = "primaryShiftP" | "primaryAltP" | "disabled";
export type NotesToolbarDisplay = "icons" | "iconsAndText";
export type TerminalToolbarDisplay = "icons" | "iconsAndText";
export type ConnectionsToolbarDisplay = "icons" | "iconsAndText";
export type TopNavigationDisplay = "icons" | "iconsAndText";
export type PageTitleColor = "foreground" | "accent" | "muted" | "custom";
export type PageTitleStyle = "plain" | "accentBar" | "underline" | "frame" | "soft";
export type WorkspaceDesign = "quiet" | "structured" | "commandCenter";
export type VmPowerControlStyle = "current" | "outline" | "segmented" | "primaryDropdown";
export type IconPresentationStyle = "outline" | "rounded" | "sharp" | "filled" | "duotone";
export type IconEffect = "themeDefault" | "frost" | "burning" | "electric" | "neon" | "off";
export type SwitchButtonStyle = "segmented" | "slider" | "compact" | "icons" | "pill";
export type TerminalRenderer = "auto" | "webgl" | "dom";

export interface ScheduledThemeTarget {
  /// Selector value used by Settings (for example `builtin:got` or
  /// `custom:customer-theme`). The effective theme is stored alongside it so
  /// the schedule also works before the portal config refresh completes.
  themeValue: string;
  colorScheme: ColorScheme;
  brand: BrandConfig;
  terminal?: TerminalConfig;
}

export interface ThemeSchedule {
  enabled: boolean;
  /// Local wall-clock times in 24-hour HH:MM format.
  dayStart: string;
  nightStart: string;
  day: ScheduledThemeTarget;
  night: ScheduledThemeTarget;
}

export interface AppearanceConfig {
  brand?: BrandConfig;
  terminal?: TerminalConfig;
  colorScheme?: ColorScheme;
  /// Optional local-time theme rotation. Only theme, scheme, branding, and
  /// terminal palette are switched; all workspace and behavior preferences
  /// remain shared between day and night.
  themeSchedule?: ThemeSchedule;
  /// Portal-authored palettes for a theme's Light, Medium, and Dark modes.
  /// The theme id stays constant while the Color scheme selector chooses the
  /// corresponding window palette.
  themeSchemeOverrides?: Record<string, ThemeSchemeOverride>;
  /// App-wide UI font size in px. Drives the root `font-size` for navigation,
  /// page chrome, forms, and controls. Workspace cards/rows use cardFontSize
  /// so users can tune information density independently.
  appFontSize?: number;
  /// Font size in px for workspace cards and rows across every workspace
  /// design and view mode. Does not affect the terminal.
  cardFontSize?: number;
  /// Icon size for device/connection actions on the Lab and Connections
  /// pages. Buttons grow with the icons. Default: 19px.
  connectionActionIconSize?: number;
  /// Background opacity for UI surfaces such as cards, Settings panels,
  /// Identities rows, focus cards, and list/compact rows. Text and controls
  /// stay fully opaque. Default: 1.
  surfaceOpacity?: number;
  /// Legacy name kept so prefs saved by the earlier list/compact-only slider
  /// keep working after the setting was generalized.
  listCompactSurfaceOpacity?: number;
  /// When true, terminal tabs spawned from a colored session/device tint
  /// their foreground text with that accent.
  tintTerminalText?: boolean;
  /// Optional accent used for terminal ANSI tinting when a terminal tab has
  /// no per-session/per-device card color. Empty means "follow app accent".
  terminalAnsiAccent?: string;
  /// When true, double-clicking a lab device or a saved connection opens
  /// an in-app SSH terminal directly. Default: true.
  /// Legacy setting; new clients use labDeviceDoubleClickAction and
  /// savedConnectionDoubleClickAction, with this value as a migration fallback.
  autoOpenSshOnDoubleClick?: boolean;
  /// Double-click behavior for a session group in the terminal tab strip.
  /// Default: reconnect every tab in the group.
  sessionGroupDoubleClickAction?: SessionGroupDoubleClickAction;
  /// Middle-click behavior for a session group in the terminal tab strip.
  /// Default: close every tab in the group.
  sessionGroupMiddleClickAction?: SessionGroupMiddleClickAction;
  /// Double-click behavior for rows/cards on Lab Devices.
  /// Default: connect.
  labDeviceDoubleClickAction?: EntityDoubleClickAction;
  /// Double-click behavior for rows/cards on Connections.
  /// Default: connect.
  savedConnectionDoubleClickAction?: EntityDoubleClickAction;
  /// Click behavior for the active Sessions sidebar inside Terminals.
  /// Default: single click opens the connection.
  terminalSidebarClickBehavior?: TerminalSidebarClickBehavior;
  /// Delay before a single click opens the device/connection settings panel,
  /// used to leave room for a follow-up double-click. When double-click SSH is
  /// disabled the effective delay falls to 0ms. Default while enabled: 500ms.
  settingsOpenDelayMs?: number;
  /// When true, selecting text in a terminal pane copies it to the system
  /// clipboard automatically (Linux-style). Default: true.
  terminalAutoCopySelection?: boolean;
  /// When true, right-clicking inside a terminal pane pastes the clipboard
  /// contents into the pty instead of opening a context menu. Default: true.
  terminalRightClickPaste?: boolean;
  /// Keyboard shortcut used to send the active terminal selection to the
  /// remembered Notes section. Default: Ctrl/Cmd+Shift+N.
  terminalNotesShortcut?: TerminalNotesShortcut;
  /// Global shortcut used to open the Identities page.
  /// Default: Ctrl/Cmd+Shift+I.
  identitiesShortcut?: IdentitiesShortcut;
  /// Shortcut used to retrieve and submit a configured 1Password Login.
  /// Default: Ctrl/Cmd+Shift+P.
  onePasswordShortcut?: OnePasswordShortcut;
  /// Label treatment for Notes navigation and backup toolbar controls.
  /// Default: icons only. Accessible names and tooltips are always retained.
  notesToolbarDisplay?: NotesToolbarDisplay;
  /// Label treatment for Find and Send to Notes in the Sessions toolbar.
  /// Default: icons only. Accessible names and tooltips are always retained.
  terminalToolbarDisplay?: TerminalToolbarDisplay;
  /// Label treatment for creation actions in the Connections toolbar.
  /// Default: icons only. Accessible names and tooltips are always retained.
  connectionsToolbarDisplay?: ConnectionsToolbarDisplay;
  /// Label treatment for the primary application navigation and utilities.
  /// Default: icons and text. Accessible names and tooltips are always retained.
  topNavigationDisplay?: TopNavigationDisplay;
  /// Color source and decoration used by primary page titles.
  pageTitleColor?: PageTitleColor;
  pageTitleCustomColor?: string;
  pageTitleStyle?: PageTitleStyle;
  /// Shared visual hierarchy used across every main ConnCat workspace.
  /// Quiet reduces chrome, Structured emphasizes pane boundaries, and
  /// Command Center uses denser operational bands. Default: Command Center.
  workspaceDesign?: WorkspaceDesign;
  /// Presentation used for power controls on owned VM cards and rows.
  /// Default: segmented.
  vmPowerControlStyle?: VmPowerControlStyle;
  /// Presentation for SSH/RDP/SFTP/console and other session launch icons.
  sessionConnectionIconStyle?: IconPresentationStyle;
  /// Presentation for general action icons in buttons, menus, and toolbars.
  buttonIconStyle?: IconPresentationStyle;
  /// Hover/focus animation applied to interactive icons throughout ConnCat.
  /// Theme default preserves the original GoT frost/burning behavior and is
  /// intentionally motion-free for other themes.
  iconEffect?: IconEffect;
  /// Whether the active primary/utility navigation icon retains the selected
  /// icon effect after hover ends. Default: true.
  keepActiveNavigationIconEffect?: boolean;
  /// Presentation for shared OFF/ON switch buttons throughout ConnCat.
  switchButtonStyle?: SwitchButtonStyle;
  /// Whether inline VM power controls are visible on Lab rows/cards. Power
  /// commands remain available from the device context menu. Default: true.
  showVmPowerControls?: boolean;
  /// Where Browse actions open after ConnCat creates the secure local proxy.
  /// Default: in_app. Per-device/per-connection settings may override it.
  browseOpenMode?: BrowseOpenMode;
  /// Default launcher for RDP actions on saved Connections. Individual
  /// Connections may override it. Inventory-device RDP is unaffected.
  savedConnectionRdpApp?: RdpOpenMode;
  /// Square-card edge length in px for the focus-grid view (Devices and
  /// Sessions). Clamped to [220, 360] in the UI. Default: 220.
  focusCardSize?: number;
  /// Multiplier applied via CSS `zoom` to the `<main>` content area only
  /// (topbar and statusbar are excluded). Driven by Ctrl/Cmd +/-/0.
  /// Clamped to [0.5, 2.5]. Default: 1.
  contentZoom?: number;
  /// Default terminal scrollback (lines) for newly-spawned tabs. Per-session
  /// and per-device overrides take precedence. Clamped to [100, 100000].
  /// Default: 1000.
  terminalScrollback?: number;
  /// Renderer used by xterm terminals. Auto selects the lower-memory DOM
  /// renderer on macOS and accelerated WebGL on other platforms.
  terminalRenderer?: TerminalRenderer;
  /// When true, every in-app terminal tab streams its output to a
  /// per-session `.log` file in `transcriptDir`. ANSI escapes are stripped
  /// so the log is plain text. Per-session/per-device overrides can flip
  /// this on/off individually.
  transcriptEnabled?: boolean;
  /// Absolute directory for transcript files. Required when
  /// `transcriptEnabled` is true — unset means "disabled regardless of the
  /// toggle". Filenames are derived as `<sanitized-name>_YYYY-MM-DD_HH-MM-SS.log`.
  transcriptDir?: string;
  /// Admin-defined named presets pushed from the portal Site Config. Each
  /// entry is a one-click theme (brand colors + terminal palette + scheme)
  /// that users can apply from Settings alongside the built-in BRAND_PRESETS.
  /// Only consumed server-side; the resolved appearance ignores this field.
  customPresets?: ThemePreset[];
}

export interface ThemeSchemeOverride {
  label?: string;
  defaultScheme?: ColorScheme;
  schemes?: Partial<Record<ColorScheme, {
    window?: WindowPalette;
  }>>;
}

export interface ThemePreset {
  /// Stable identifier (slug). Used as the brand id when applied so the
  /// [data-brand="..."] selector can hook brand-specific CSS if desired.
  id: string;
  /// Human-readable name shown on the preset button.
  label: string;
  /// Optional swatch background (CSS color or gradient). Falls back to
  /// `brand.accent` when omitted.
  swatch?: string;
  brand?: {
    name?: string;
    accent?: string;
    logoUrl?: string;
    window?: WindowPalette;
  };
  colorScheme?: ColorScheme;
  terminal?: {
    theme?: TerminalTheme;
    fontFamily?: string;
    fontSize?: number;
  };
}

export const DEFAULTS: Required<{
  brand: Required<BrandConfig>;
  terminal: { theme: TerminalTheme; fontSize: number; fontFamily: string };
  colorScheme: ColorScheme;
  appFontSize: number;
  cardFontSize: number;
  connectionActionIconSize: number;
  surfaceOpacity: number;
  tintTerminalText: boolean;
  terminalAnsiAccent: string;
  autoOpenSshOnDoubleClick: boolean;
  sessionGroupDoubleClickAction: SessionGroupDoubleClickAction;
  sessionGroupMiddleClickAction: SessionGroupMiddleClickAction;
  labDeviceDoubleClickAction: EntityDoubleClickAction;
  savedConnectionDoubleClickAction: EntityDoubleClickAction;
  terminalSidebarClickBehavior: TerminalSidebarClickBehavior;
  settingsOpenDelayMs: number;
  terminalAutoCopySelection: boolean;
  terminalRightClickPaste: boolean;
  terminalNotesShortcut: TerminalNotesShortcut;
  identitiesShortcut: IdentitiesShortcut;
  onePasswordShortcut: OnePasswordShortcut;
  notesToolbarDisplay: NotesToolbarDisplay;
  terminalToolbarDisplay: TerminalToolbarDisplay;
  connectionsToolbarDisplay: ConnectionsToolbarDisplay;
  topNavigationDisplay: TopNavigationDisplay;
  pageTitleColor: PageTitleColor;
  pageTitleCustomColor: string;
  pageTitleStyle: PageTitleStyle;
  workspaceDesign: WorkspaceDesign;
  vmPowerControlStyle: VmPowerControlStyle;
  sessionConnectionIconStyle: IconPresentationStyle;
  buttonIconStyle: IconPresentationStyle;
  iconEffect: IconEffect;
  keepActiveNavigationIconEffect: boolean;
  switchButtonStyle: SwitchButtonStyle;
  showVmPowerControls: boolean;
  browseOpenMode: BrowseOpenMode;
  savedConnectionRdpApp: RdpOpenMode;
  focusCardSize: number;
  contentZoom: number;
  terminalScrollback: number;
  terminalRenderer: TerminalRenderer;
  transcriptEnabled: boolean;
  transcriptDir: string;
}> = {
  appFontSize: 16,
  cardFontSize: 16,
  connectionActionIconSize: 19,
  surfaceOpacity: 1,
  contentZoom: 1,
  tintTerminalText: false,
  terminalAnsiAccent: "",
  autoOpenSshOnDoubleClick: true,
  sessionGroupDoubleClickAction: "reconnect",
  sessionGroupMiddleClickAction: "closeAll",
  labDeviceDoubleClickAction: "connect",
  savedConnectionDoubleClickAction: "connect",
  terminalSidebarClickBehavior: "singleClickOpen",
  settingsOpenDelayMs: 500,
  terminalAutoCopySelection: true,
  terminalRightClickPaste: true,
  terminalNotesShortcut: "primaryShiftN",
  identitiesShortcut: "primaryShiftI",
  onePasswordShortcut: "primaryShiftP",
  notesToolbarDisplay: "icons",
  terminalToolbarDisplay: "icons",
  connectionsToolbarDisplay: "icons",
  topNavigationDisplay: "iconsAndText",
  pageTitleColor: "muted",
  pageTitleCustomColor: "#049fd9",
  pageTitleStyle: "plain",
  workspaceDesign: "commandCenter",
  vmPowerControlStyle: "segmented",
  sessionConnectionIconStyle: "outline",
  buttonIconStyle: "outline",
  iconEffect: "themeDefault",
  keepActiveNavigationIconEffect: true,
  switchButtonStyle: "segmented",
  showVmPowerControls: true,
  browseOpenMode: "in_app",
  savedConnectionRdpApp: "catwalk",
  focusCardSize: 220,
  terminalScrollback: 1000,
  terminalRenderer: "auto",
  transcriptEnabled: false,
  transcriptDir: "",
  brand: {
    id: "connecat",
    identity: "default",
    name: "ConnCat",
    logoUrl: "/connecat.png",
    accent: "#049fd9",
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
  terminal: {
    fontFamily: "Menlo, Consolas, 'Liberation Mono', monospace",
    fontSize: 13,
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
  colorScheme: "dark",
};

const PREFS_KEY = "connecat.appearance.prefs";
const REMOVED_BLACK_CAT_THEME_IDS = new Set(["cisco-black-cat", "cisco-black-cat-2"]);

function migrateRemovedThemeBrand(brand: BrandConfig | undefined): BrandConfig | undefined {
  if (!brand?.id || !REMOVED_BLACK_CAT_THEME_IDS.has(brand.id)) return brand;
  return {
    id: "cisco",
    identity: "default",
    name: "ConnCat",
    logoUrl: "",
    accent: "#049fd9",
  };
}

function migrateRemovedThemeTarget(target: ScheduledThemeTarget): ScheduledThemeTarget {
  const removedThemeValue = target.themeValue === "builtin:cisco-black-cat"
    || target.themeValue === "builtin:cisco-black-cat-2";
  const brand = migrateRemovedThemeBrand(target.brand);
  if (!removedThemeValue && brand === target.brand) return target;
  return {
    ...target,
    themeValue: removedThemeValue ? "builtin:cisco" : target.themeValue,
    brand: brand ?? target.brand,
  };
}

export function migrateRemovedThemePrefs(prefs: AppearanceConfig): AppearanceConfig {
  const brand = migrateRemovedThemeBrand(prefs.brand);
  const schedule = prefs.themeSchedule;
  const day = schedule ? migrateRemovedThemeTarget(schedule.day) : undefined;
  const night = schedule ? migrateRemovedThemeTarget(schedule.night) : undefined;
  if (brand === prefs.brand && (!schedule || (day === schedule.day && night === schedule.night))) {
    return prefs;
  }
  return {
    ...prefs,
    ...(brand ? { brand } : {}),
    ...(schedule ? { themeSchedule: { ...schedule, day: day!, night: night! } } : {}),
  };
}

const BUILT_IN_BRAND_IDS = new Set([
  "default",
  "thousandeyes",
  "thousandeyes-steel",
  "midnight-copper",
  "steel-horizon",
  "pride",
  "got",
  "got-stark",
  "got-lannister",
  "got-targaryen",
  "got-baratheon",
  "got-tyrell",
  "got-greyjoy",
  "got-martell",
  "got-arryn",
  "got-tully",
  "cisco",
  "connecat",
  "jedi",
  "sith",
  "squid",
  "galactic-dark",
  "galactic-light",
  "matrix-dark",
  "matrix-light",
  "grid-dark",
  "grid-light",
  "upside-down-dark",
  "upside-down-light",
  "arrakis-dark",
  "arrakis-light",
]);
const BUILT_IN_MEDIUM_BRAND_IDS = new Set([
  "got-stark",
  "got-lannister",
  "got-targaryen",
  "got-baratheon",
  "got-tyrell",
  "got-greyjoy",
  "got-martell",
  "got-arryn",
  "got-tully",
]);
const LEGACY_GOT_HOUSE_SCHEME_BACKGROUNDS: Record<string, Partial<Record<ColorScheme, string>>> = {
  "got-stark": { medium: "#d8dedb", light: "#f3f6f3", dark: "#171d1d" },
  "got-lannister": { medium: "#5b101e", light: "#fff4df", dark: "#21050a" },
  "got-targaryen": { light: "#f4eeee", dark: "#050404" },
  "got-baratheon": { medium: "#c99b22", light: "#fff7dc", dark: "#19160d" },
  "got-tyrell": { medium: "#174b2d", light: "#f3f8e9", dark: "#071b0f" },
  "got-greyjoy": { medium: "#121310", light: "#f1efe4", dark: "#050605" },
  "got-martell": { medium: "#a94722", light: "#fff0dc", dark: "#321007" },
  "got-arryn": { medium: "#245b93", light: "#eef7fc", dark: "#091b2c" },
  "got-tully": { medium: "#183f70", light: "#eef3f8", dark: "#071424" },
};
const BUILT_IN_LIGHT_BRAND_IDS = new Set([
  "jedi",
  "galactic-light",
  "matrix-light",
  "grid-light",
  "upside-down-light",
  "arrakis-light",
]);

export function loadUserPrefs(): AppearanceConfig {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === "object"
      ? migrateRemovedThemePrefs(removeLegacyBackgroundImagePrefs(v as AppearanceConfig))
      : {};
  } catch {
    return {};
  }
}

export function saveUserPrefs(prefs: AppearanceConfig): void {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify(migrateRemovedThemePrefs(removeLegacyBackgroundImagePrefs(prefs))),
  );
}

function removeLegacyBackgroundImagePrefs(prefs: AppearanceConfig): AppearanceConfig {
  const legacyWindow = prefs.brand?.window as (WindowPalette & {
    backgroundImagePath?: unknown;
    backgroundImageOpacity?: unknown;
  }) | undefined;
  if (!legacyWindow || (!("backgroundImagePath" in legacyWindow) && !("backgroundImageOpacity" in legacyWindow))) {
    return prefs;
  }
  const { backgroundImagePath: _path, backgroundImageOpacity: _opacity, ...window } = legacyWindow;
  const brand = { ...prefs.brand };
  if (Object.keys(window).length > 0) brand.window = window;
  else delete brand.window;
  return { ...prefs, brand };
}

export function clearUserPrefs(): void {
  localStorage.removeItem(PREFS_KEY);
}

function parseScheduleTime(value: string, fallbackMinutes: number): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallbackMinutes;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallbackMinutes;
  return (hours * 60) + minutes;
}

export type ScheduledThemePeriod = "day" | "night";

export function getScheduledThemePeriod(
  now: Date,
  dayStart: string,
  nightStart: string,
): ScheduledThemePeriod {
  const dayMinutes = parseScheduleTime(dayStart, 7 * 60);
  const nightMinutes = parseScheduleTime(nightStart, 19 * 60);
  const nowMinutes = (now.getHours() * 60) + now.getMinutes();

  if (dayMinutes === nightMinutes) return "day";
  if (dayMinutes < nightMinutes) {
    return nowMinutes >= dayMinutes && nowMinutes < nightMinutes ? "day" : "night";
  }
  // Also support schedules where "day" intentionally crosses midnight.
  return nowMinutes >= dayMinutes || nowMinutes < nightMinutes ? "day" : "night";
}

export function applyThemeSchedule(
  prefs: AppearanceConfig,
  now: Date = new Date(),
): AppearanceConfig {
  const schedule = prefs.themeSchedule;
  if (!schedule?.enabled) return prefs;
  const period = getScheduledThemePeriod(now, schedule.dayStart, schedule.nightStart);
  const target = schedule[period];
  if (!target?.brand || !target.colorScheme) return prefs;
  return {
    ...prefs,
    brand: structuredClone(target.brand),
    terminal: target.terminal
      ? { ...(prefs.terminal ?? {}), ...structuredClone(target.terminal) }
      : prefs.terminal,
    colorScheme: target.colorScheme,
  };
}

/** A direct theme choice takes control from automation without discarding the
 * user's configured day/night targets. */
export function disableThemeSchedule(prefs: AppearanceConfig): AppearanceConfig {
  if (!prefs.themeSchedule?.enabled) return prefs;
  return {
    ...prefs,
    themeSchedule: {
      ...prefs.themeSchedule,
      enabled: false,
    },
  };
}

/// Shallow-by-section deep-by-leaf merge: server[brand].accent loses to
/// user[brand].accent, but server[brand].logoUrl survives if user doesn't
/// set it. `undefined` / `""` on a leaf means "fall through".
function pick<T>(...vals: (T | undefined)[]): T | undefined {
  for (const v of vals) {
    if (v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return undefined;
}

function clampSurfaceOpacity(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULTS.surfaceOpacity;
  return Math.min(1, Math.max(0, value!));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeSessionGroupDoubleClickAction(value: unknown): SessionGroupDoubleClickAction {
  return oneOf(value, ["reconnect", "closeAll", "none", "ungroup"] as const, DEFAULTS.sessionGroupDoubleClickAction);
}

function normalizeSessionGroupMiddleClickAction(value: unknown): SessionGroupMiddleClickAction {
  return oneOf(value, ["closeAll", "ungroup", "none", "reconnect"] as const, DEFAULTS.sessionGroupMiddleClickAction);
}

function normalizeEntityDoubleClickAction(value: unknown): EntityDoubleClickAction {
  return oneOf(value, ["connect", "none"] as const, DEFAULTS.labDeviceDoubleClickAction);
}

function normalizeTerminalSidebarClickBehavior(value: unknown): TerminalSidebarClickBehavior {
  return oneOf(value, ["singleClickOpen", "doubleClickOpen", "selectOnly", "none"] as const, DEFAULTS.terminalSidebarClickBehavior);
}

function normalizeTerminalRenderer(value: unknown): TerminalRenderer {
  return oneOf(value, ["auto", "webgl", "dom"] as const, DEFAULTS.terminalRenderer);
}

function normalizeBrowseOpenMode(value: unknown): BrowseOpenMode {
  return oneOf(value, ["in_app", "window", "external"] as const, DEFAULTS.browseOpenMode);
}

function normalizeRdpOpenMode(value: unknown): RdpOpenMode {
  return oneOf(value, ["catwalk", "freerdp", "system"] as const, DEFAULTS.savedConnectionRdpApp);
}

function normalizeTerminalNotesShortcut(value: unknown): TerminalNotesShortcut {
  return oneOf(value, ["primaryShiftN", "primaryAltN", "disabled"] as const, DEFAULTS.terminalNotesShortcut);
}

function normalizeIdentitiesShortcut(value: unknown): IdentitiesShortcut {
  return oneOf(value, ["primaryShiftI", "primaryAltI", "disabled"] as const, DEFAULTS.identitiesShortcut);
}

function normalizeOnePasswordShortcut(value: unknown): OnePasswordShortcut {
  return oneOf(value, ["primaryShiftP", "primaryAltP", "disabled"] as const, DEFAULTS.onePasswordShortcut);
}

function normalizeNotesToolbarDisplay(value: unknown): NotesToolbarDisplay {
  return oneOf(value, ["icons", "iconsAndText"] as const, DEFAULTS.notesToolbarDisplay);
}

function normalizeTerminalToolbarDisplay(value: unknown): TerminalToolbarDisplay {
  return oneOf(value, ["icons", "iconsAndText"] as const, DEFAULTS.terminalToolbarDisplay);
}

function normalizeConnectionsToolbarDisplay(value: unknown): ConnectionsToolbarDisplay {
  return oneOf(value, ["icons", "iconsAndText"] as const, DEFAULTS.connectionsToolbarDisplay);
}

function normalizeTopNavigationDisplay(value: unknown): TopNavigationDisplay {
  return oneOf(value, ["icons", "iconsAndText"] as const, DEFAULTS.topNavigationDisplay);
}

function normalizePageTitleColor(value: unknown): PageTitleColor {
  return oneOf(value, ["foreground", "accent", "muted", "custom"] as const, DEFAULTS.pageTitleColor);
}

function normalizePageTitleStyle(value: unknown): PageTitleStyle {
  return oneOf(value, ["plain", "accentBar", "underline", "frame", "soft"] as const, DEFAULTS.pageTitleStyle);
}

function normalizeWorkspaceDesign(value: unknown): WorkspaceDesign {
  return oneOf(value, ["quiet", "structured", "commandCenter"] as const, DEFAULTS.workspaceDesign);
}

function normalizeVmPowerControlStyle(value: unknown): VmPowerControlStyle {
  return oneOf(value, ["current", "outline", "segmented", "primaryDropdown"] as const, DEFAULTS.vmPowerControlStyle);
}

function normalizeIconPresentationStyle(value: unknown): IconPresentationStyle {
  // Map the brief first implementation onto the final five-set selector so
  // an already-saved preference remains visually close after upgrading.
  if (value === "softTile") return "duotone";
  if (value === "bold") return "rounded";
  return oneOf(value, ["outline", "rounded", "sharp", "filled", "duotone"] as const, DEFAULTS.sessionConnectionIconStyle);
}

function normalizeIconEffect(value: unknown): IconEffect {
  return oneOf(
    value,
    ["themeDefault", "frost", "burning", "electric", "neon", "off"] as const,
    DEFAULTS.iconEffect,
  );
}

function normalizeSwitchButtonStyle(value: unknown): SwitchButtonStyle {
  return oneOf(value, ["segmented", "slider", "compact", "icons", "pill"] as const, DEFAULTS.switchButtonStyle);
}

export interface ResolvedAppearance {
  brand: Required<BrandConfig>;
  terminal: { theme: TerminalTheme; fontSize: number; fontFamily: string };
  colorScheme: ColorScheme;
  appFontSize: number;
  cardFontSize: number;
  connectionActionIconSize: number;
  surfaceOpacity: number;
  tintTerminalText: boolean;
  terminalAnsiAccent: string;
  autoOpenSshOnDoubleClick: boolean;
  sessionGroupDoubleClickAction: SessionGroupDoubleClickAction;
  sessionGroupMiddleClickAction: SessionGroupMiddleClickAction;
  labDeviceDoubleClickAction: EntityDoubleClickAction;
  savedConnectionDoubleClickAction: EntityDoubleClickAction;
  terminalSidebarClickBehavior: TerminalSidebarClickBehavior;
  settingsOpenDelayMs: number;
  terminalAutoCopySelection: boolean;
  terminalRightClickPaste: boolean;
  terminalNotesShortcut: TerminalNotesShortcut;
  identitiesShortcut: IdentitiesShortcut;
  onePasswordShortcut: OnePasswordShortcut;
  notesToolbarDisplay: NotesToolbarDisplay;
  terminalToolbarDisplay: TerminalToolbarDisplay;
  connectionsToolbarDisplay: ConnectionsToolbarDisplay;
  topNavigationDisplay: TopNavigationDisplay;
  pageTitleColor: PageTitleColor;
  pageTitleCustomColor: string;
  pageTitleStyle: PageTitleStyle;
  workspaceDesign: WorkspaceDesign;
  vmPowerControlStyle: VmPowerControlStyle;
  sessionConnectionIconStyle: IconPresentationStyle;
  buttonIconStyle: IconPresentationStyle;
  iconEffect: IconEffect;
  keepActiveNavigationIconEffect: boolean;
  switchButtonStyle: SwitchButtonStyle;
  showVmPowerControls: boolean;
  browseOpenMode: BrowseOpenMode;
  savedConnectionRdpApp: RdpOpenMode;
  focusCardSize: number;
  contentZoom: number;
  terminalScrollback: number;
  terminalRenderer: TerminalRenderer;
  transcriptEnabled: boolean;
  transcriptDir: string;
}

function resolveSchemeAccent(brandId: string | undefined, accent: string, colorScheme: ColorScheme): string {
  const houseTheme = GOT_HOUSE_THEMES.find((house) => house.id === brandId);
  if (houseTheme && accent === houseTheme.accent) {
    if (colorScheme === "light" && houseTheme.lightAccent) return houseTheme.lightAccent;
    if (colorScheme === "dark" && houseTheme.darkAccent) return houseTheme.darkAccent;
  }
  return brandId === "got" && colorScheme === "light"
    ? "#5eb3ff"
    : accent;
}

export function getEffectiveAccent(app: ResolvedAppearance): string {
  return resolveSchemeAccent(app.brand.id, app.brand.accent, app.colorScheme);
}

export function getEffectiveTerminalAnsiAccent(app: ResolvedAppearance): string {
  return app.terminalAnsiAccent || getEffectiveAccent(app);
}

export function resolveAppearance(
  server: AppearanceConfig | undefined,
  user: AppearanceConfig | undefined,
): ResolvedAppearance {
  const s = server ?? {};
  const u = migrateRemovedThemePrefs(user ?? {});
  const d = DEFAULTS;
  const autoOpenSshOnDoubleClick = pick(
    u.autoOpenSshOnDoubleClick,
    s.autoOpenSshOnDoubleClick,
    d.autoOpenSshOnDoubleClick,
  )!;
  const legacyEntityDoubleClickAction: EntityDoubleClickAction = autoOpenSshOnDoubleClick ? "connect" : "none";
  const sessionGroupDoubleClickAction = normalizeSessionGroupDoubleClickAction(pick(
    u.sessionGroupDoubleClickAction,
    s.sessionGroupDoubleClickAction,
    d.sessionGroupDoubleClickAction,
  ));
  const sessionGroupMiddleClickAction = normalizeSessionGroupMiddleClickAction(pick(
    u.sessionGroupMiddleClickAction,
    s.sessionGroupMiddleClickAction,
    d.sessionGroupMiddleClickAction,
  ));
  const labDeviceDoubleClickAction = normalizeEntityDoubleClickAction(pick(
    u.labDeviceDoubleClickAction,
    s.labDeviceDoubleClickAction,
    legacyEntityDoubleClickAction,
  ));
  const savedConnectionDoubleClickAction = normalizeEntityDoubleClickAction(pick(
    u.savedConnectionDoubleClickAction,
    s.savedConnectionDoubleClickAction,
    legacyEntityDoubleClickAction,
  ));
  const terminalSidebarClickBehavior = normalizeTerminalSidebarClickBehavior(pick(
    u.terminalSidebarClickBehavior,
    s.terminalSidebarClickBehavior,
    d.terminalSidebarClickBehavior,
  ));
  const configuredSettingsOpenDelayMs = Math.min(2000, Math.max(0, pick(
    u.settingsOpenDelayMs,
    s.settingsOpenDelayMs,
    d.settingsOpenDelayMs,
  )!));
  const settingsOpenDelayMs =
    labDeviceDoubleClickAction === "connect" || savedConnectionDoubleClickAction === "connect"
      ? configuredSettingsOpenDelayMs
      : 0;
  const colorScheme = pick(u.colorScheme, s.colorScheme, d.colorScheme)!;
  const brandId = pick(u.brand?.id, s.brand?.id, d.brand.id) ?? "";
  const configuredPortalSchemeWindow = s.themeSchemeOverrides?.[brandId]?.schemes?.[colorScheme]?.window;
  const portalSchemeWindow = configuredPortalSchemeWindow?.bg
    === LEGACY_GOT_HOUSE_SCHEME_BACKGROUNDS[brandId]?.[colorScheme]
    ? undefined
    : configuredPortalSchemeWindow;
  const useDefaultBrandIdentity = u.brand?.identity === "default"
    || (u.brand?.identity === undefined && BUILT_IN_BRAND_IDS.has(u.brand?.id ?? ""));
  const useCustomBrandIdentity = u.brand?.identity === "custom";
  const trustedHouseBrand = GOT_HOUSE_THEMES.find((house) => house.id === brandId);
  const trustedHouseWindow: Partial<WindowPalette> | undefined = trustedHouseBrand
    ? colorScheme === "light"
      ? trustedHouseBrand.lightWindow
      : colorScheme === "dark"
        ? trustedHouseBrand.darkWindow
        : trustedHouseBrand.window
    : undefined;
  const resolveBrandWindowValue = <K extends keyof WindowPalette>(
    key: K,
  ): WindowPalette[K] | undefined => {
    const portalValue = portalSchemeWindow?.[key];
    if (portalValue !== undefined) return portalValue;
    const trustedHouseValue = trustedHouseWindow?.[key];
    if (trustedHouseValue !== undefined) return trustedHouseValue;
    return useCustomBrandIdentity
      ? u.brand?.window?.[key]
      : pick(u.brand?.window?.[key], s.brand?.window?.[key]);
  };
  const brand = {
      id: brandId,
      identity: u.brand?.identity ?? s.brand?.identity ?? "custom",
      name: trustedHouseBrand
        ? trustedHouseBrand.brandName
        : useDefaultBrandIdentity
        ? d.brand.name
        : useCustomBrandIdentity
          ? (u.brand?.name?.trim() || d.brand.name)
          : pick(u.brand?.name, s.brand?.name, d.brand.name)!,
      logoUrl: trustedHouseBrand
        ? trustedHouseBrand.logoUrl
        : useDefaultBrandIdentity
        ? d.brand.logoUrl
        : useCustomBrandIdentity
          ? (u.brand?.logoUrl ?? d.brand.logoUrl)
          : pick(u.brand?.logoUrl, s.brand?.logoUrl, d.brand.logoUrl) ?? "",
      accent: pick(u.brand?.accent, s.brand?.accent, d.brand.accent)!,
      window: {
        bg: resolveBrandWindowValue("bg"),
        panel: resolveBrandWindowValue("panel"),
        fg: resolveBrandWindowValue("fg"),
        muted: resolveBrandWindowValue("muted"),
        border: resolveBrandWindowValue("border"),
        inputBg: resolveBrandWindowValue("inputBg"),
        btnFg: resolveBrandWindowValue("btnFg"),
      },
    };
  const builtInNativeScheme = BUILT_IN_MEDIUM_BRAND_IDS.has(brand.id)
    ? "medium"
    : BUILT_IN_LIGHT_BRAND_IDS.has(brand.id)
      ? "light"
      : "dark";
  if (useDefaultBrandIdentity
    && BUILT_IN_BRAND_IDS.has(brand.id)
    && !portalSchemeWindow
    && !trustedHouseWindow
    && colorScheme !== builtInNativeScheme) {
    // Built-in presets author a window palette for their native mode. Older
    // synced preferences can retain that palette after the user changes the
    // surface mode, where inline variables would override the selected mode
    // indefinitely. Keep identity, accent, terminal, and background-image
    // choices, but let Dark/Medium/Light own the non-native window surfaces.
    brand.window.bg = undefined;
    brand.window.panel = undefined;
    brand.window.fg = undefined;
    brand.window.muted = undefined;
    brand.window.border = undefined;
    brand.window.inputBg = undefined;
    brand.window.btnFg = undefined;
  }
  const effectiveAccent = resolveSchemeAccent(brand.id, brand.accent, colorScheme);

  return {
    brand,
    terminal: {
      fontFamily: pick(u.terminal?.fontFamily, s.terminal?.fontFamily, d.terminal.fontFamily)!,
      fontSize: pick(u.terminal?.fontSize, s.terminal?.fontSize, d.terminal.fontSize)!,
      theme: {
        ...d.terminal.theme,
        ...(s.terminal?.theme ?? {}),
        ...(u.terminal?.theme ?? {}),
      },
    },
    colorScheme,
    appFontSize: Math.min(24, Math.max(12, pick(
      u.appFontSize,
      s.appFontSize,
      d.appFontSize,
    )!)),
    cardFontSize: Math.min(24, Math.max(12, pick(
      u.cardFontSize,
      s.cardFontSize,
      d.cardFontSize,
    )!)),
    connectionActionIconSize: Math.min(32, Math.max(14, pick(
      u.connectionActionIconSize,
      s.connectionActionIconSize,
      d.connectionActionIconSize,
    )!)),
    surfaceOpacity: clampSurfaceOpacity(pick(
      u.surfaceOpacity,
      u.listCompactSurfaceOpacity,
      s.surfaceOpacity,
      s.listCompactSurfaceOpacity,
      d.surfaceOpacity,
    )),
    tintTerminalText: pick(u.tintTerminalText, s.tintTerminalText, d.tintTerminalText)!,
    terminalAnsiAccent: pick(
      u.terminalAnsiAccent,
      s.terminalAnsiAccent,
      effectiveAccent,
    )!,
    autoOpenSshOnDoubleClick,
    sessionGroupDoubleClickAction,
    sessionGroupMiddleClickAction,
    labDeviceDoubleClickAction,
    savedConnectionDoubleClickAction,
    terminalSidebarClickBehavior,
    settingsOpenDelayMs,
    terminalAutoCopySelection: pick(
      u.terminalAutoCopySelection,
      s.terminalAutoCopySelection,
      d.terminalAutoCopySelection,
    )!,
    terminalRightClickPaste: pick(
      u.terminalRightClickPaste,
      s.terminalRightClickPaste,
      d.terminalRightClickPaste,
    )!,
    terminalNotesShortcut: normalizeTerminalNotesShortcut(pick(
      u.terminalNotesShortcut,
      s.terminalNotesShortcut,
      d.terminalNotesShortcut,
    )),
    identitiesShortcut: normalizeIdentitiesShortcut(pick(
      u.identitiesShortcut,
      s.identitiesShortcut,
      d.identitiesShortcut,
    )),
    onePasswordShortcut: normalizeOnePasswordShortcut(pick(
      u.onePasswordShortcut,
      s.onePasswordShortcut,
      d.onePasswordShortcut,
    )),
    notesToolbarDisplay: normalizeNotesToolbarDisplay(pick(
      u.notesToolbarDisplay,
      s.notesToolbarDisplay,
      d.notesToolbarDisplay,
    )),
    terminalToolbarDisplay: normalizeTerminalToolbarDisplay(pick(
      u.terminalToolbarDisplay,
      s.terminalToolbarDisplay,
      d.terminalToolbarDisplay,
    )),
    connectionsToolbarDisplay: normalizeConnectionsToolbarDisplay(pick(
      u.connectionsToolbarDisplay,
      s.connectionsToolbarDisplay,
      d.connectionsToolbarDisplay,
    )),
    topNavigationDisplay: normalizeTopNavigationDisplay(pick(
      u.topNavigationDisplay,
      s.topNavigationDisplay,
      d.topNavigationDisplay,
    )),
    pageTitleColor: normalizePageTitleColor(pick(
      u.pageTitleColor,
      s.pageTitleColor,
      d.pageTitleColor,
    )),
    pageTitleCustomColor: pick(
      u.pageTitleCustomColor,
      s.pageTitleCustomColor,
      d.pageTitleCustomColor,
    )!,
    pageTitleStyle: normalizePageTitleStyle(pick(
      u.pageTitleStyle,
      s.pageTitleStyle,
      d.pageTitleStyle,
    )),
    workspaceDesign: normalizeWorkspaceDesign(pick(
      u.workspaceDesign,
      s.workspaceDesign,
      d.workspaceDesign,
    )),
    vmPowerControlStyle: normalizeVmPowerControlStyle(pick(
      u.vmPowerControlStyle,
      s.vmPowerControlStyle,
      d.vmPowerControlStyle,
    )),
    sessionConnectionIconStyle: normalizeIconPresentationStyle(pick(
      u.sessionConnectionIconStyle,
      s.sessionConnectionIconStyle,
      d.sessionConnectionIconStyle,
    )),
    buttonIconStyle: normalizeIconPresentationStyle(pick(
      u.buttonIconStyle,
      s.buttonIconStyle,
      d.buttonIconStyle,
    )),
    iconEffect: normalizeIconEffect(pick(
      u.iconEffect,
      s.iconEffect,
      d.iconEffect,
    )),
    keepActiveNavigationIconEffect: pick(
      u.keepActiveNavigationIconEffect,
      s.keepActiveNavigationIconEffect,
      d.keepActiveNavigationIconEffect,
    )!,
    switchButtonStyle: normalizeSwitchButtonStyle(pick(
      u.switchButtonStyle,
      s.switchButtonStyle,
      d.switchButtonStyle,
    )),
    showVmPowerControls: pick(
      u.showVmPowerControls,
      s.showVmPowerControls,
      d.showVmPowerControls,
    )!,
    browseOpenMode: normalizeBrowseOpenMode(pick(
      u.browseOpenMode,
      s.browseOpenMode,
      d.browseOpenMode,
    )),
    savedConnectionRdpApp: normalizeRdpOpenMode(pick(
      u.savedConnectionRdpApp,
      s.savedConnectionRdpApp,
      d.savedConnectionRdpApp,
    )),
    focusCardSize: Math.max(220, pick(
      u.focusCardSize,
      s.focusCardSize,
      d.focusCardSize,
    )!),
    contentZoom: Math.min(2.5, Math.max(0.5, pick(
      u.contentZoom,
      s.contentZoom,
      d.contentZoom,
    )!)),
    terminalScrollback: pick(
      u.terminalScrollback,
      s.terminalScrollback,
      d.terminalScrollback,
    )!,
    terminalRenderer: normalizeTerminalRenderer(pick(
      u.terminalRenderer,
      s.terminalRenderer,
      d.terminalRenderer,
    )),
    transcriptEnabled: pick(
      u.transcriptEnabled,
      s.transcriptEnabled,
      d.transcriptEnabled,
    )!,
    transcriptDir: pick(
      u.transcriptDir,
      s.transcriptDir,
      d.transcriptDir,
    )!,
  };
}

/// Apply scheme + accent + optional window palette to CSS custom properties.
/// Brand window colors are layered on top of the selected surface mode, so a
/// preset only needs to override what it wants different (e.g. just bg+panel).
/// Idempotent — safe to call on every render.
export function applyToDocument(app: ResolvedAppearance): void {
  const root = document.documentElement;
  // Clean up inline state left by releases that supported local window
  // background images. The feature and its compositor layer no longer exist.
  root.removeAttribute("data-app-background-image");
  root.style.removeProperty("--app-bg-image");
  root.style.removeProperty("--app-bg-image-opacity");
  root.setAttribute("data-theme", app.colorScheme);
  if (app.brand.id) root.setAttribute("data-brand", app.brand.id);
  else root.removeAttribute("data-brand");
  // Scheme-aware accents keep accent-driven chrome legible on both pale and
  // dark surfaces while preserving explicit user accent overrides.
  const effectiveAccent = getEffectiveAccent(app);
  root.style.setProperty("--accent", effectiveAccent);
  root.setAttribute("data-page-title-style", app.pageTitleStyle);
  root.setAttribute("data-workspace-design", app.workspaceDesign);
  root.setAttribute("data-session-connection-icon-style", app.sessionConnectionIconStyle);
  root.setAttribute("data-button-icon-style", app.buttonIconStyle);
  const effectiveIconEffect = app.iconEffect === "themeDefault"
    ? app.brand.id === "got"
      ? app.colorScheme === "light" ? "frost" : "burning"
      : "off"
    : app.iconEffect;
  root.setAttribute("data-icon-effect", effectiveIconEffect);
  root.setAttribute(
    "data-active-navigation-icon-effect",
    app.keepActiveNavigationIconEffect ? "on" : "off",
  );
  root.setAttribute("data-switch-button-style", app.switchButtonStyle);
  const pageTitleColor = app.pageTitleColor === "accent"
    ? "var(--accent)"
    : app.pageTitleColor === "muted"
      ? "var(--muted)"
      : app.pageTitleColor === "custom"
        ? app.pageTitleCustomColor
        : "var(--fg)";
  root.style.setProperty("--page-title-color", pageTitleColor);

  const w = app.brand.window ?? {};
  const set = (cssVar: string, val?: string) => {
    if (val && val.trim()) root.style.setProperty(cssVar, val);
    else root.style.removeProperty(cssVar);
  };
  set("--bg", w.bg);
  set("--panel", w.panel);
  set("--fg", w.fg);
  set("--muted", w.muted);
  set("--border", w.border);
  set("--input-bg", w.inputBg);
  set("--btn-fg", w.btnFg);

  const surfaceOpacity = clampSurfaceOpacity(app.surfaceOpacity);
  const surfaceAlpha = `${Math.round(surfaceOpacity * 100)}%`;
  root.style.setProperty("--surface-alpha", surfaceAlpha);
  root.style.setProperty(
    "--surface-bg",
    `color-mix(in srgb, var(--bg) ${surfaceAlpha}, transparent)`,
  );
  root.style.setProperty(
    "--surface-row-bg",
    `color-mix(in srgb, var(--bg) ${surfaceAlpha}, transparent)`,
  );
  root.style.setProperty(
    "--surface-panel-bg",
    `color-mix(in srgb, var(--panel) ${surfaceAlpha}, transparent)`,
  );
  root.style.setProperty("--list-compact-row-bg", "var(--surface-row-bg)");
  root.style.setProperty("--list-compact-panel-bg", "var(--surface-panel-bg)");

  // Drive `rem` scaling for app chrome and forms. Workspace cards and rows
  // opt into their own token so information density can be tuned separately.
  root.style.fontSize = `${app.appFontSize}px`;
  root.style.setProperty("--workspace-card-font-size", `${app.cardFontSize}px`);
  // Content-area zoom (Ctrl/Cmd +/-/0). Applied via CSS `zoom` on <main>
  // so the topbar and statusbar stay at their unscaled size.
  root.style.setProperty("--content-zoom", String(app.contentZoom));
}
