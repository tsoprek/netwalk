import { describe, expect, it } from "vitest";
import {
  applyToDocument,
  applyThemeSchedule,
  disableThemeSchedule,
  getEffectiveAccent,
  getEffectiveTerminalAnsiAccent,
  getScheduledThemePeriod,
  resolveAppearance,
} from "./appearance";

describe("appearance terminal ANSI accent", () => {
  it("defaults the terminal renderer to Auto and accepts valid overrides", () => {
    expect(resolveAppearance({}, {}).terminalRenderer).toBe("auto");
    expect(resolveAppearance({}, { terminalRenderer: "dom" }).terminalRenderer).toBe("dom");
    expect(resolveAppearance({}, { terminalRenderer: "webgl" }).terminalRenderer).toBe("webgl");
    expect(resolveAppearance({}, { terminalRenderer: "invalid" as any }).terminalRenderer).toBe("auto");
  });

  it("follows the effective app accent when no terminal accent is set", () => {
    const appearance = resolveAppearance({}, { brand: { accent: "#ff8800" } });

    expect(appearance.terminalAnsiAccent).toBe("#ff8800");
    expect(getEffectiveTerminalAnsiAccent(appearance)).toBe("#ff8800");
  });

  it("uses the explicit terminal ANSI accent independently from app accent", () => {
    const appearance = resolveAppearance(
      {},
      {
        brand: { accent: "#ff8800" },
        terminalAnsiAccent: "#39ff14",
      },
    );

    expect(appearance.brand.accent).toBe("#ff8800");
    expect(appearance.terminalAnsiAccent).toBe("#39ff14");
    expect(getEffectiveTerminalAnsiAccent(appearance)).toBe("#39ff14");
  });

  it("ignores legacy background image settings", () => {
    const appearance = resolveAppearance(
      {},
      {
        brand: {
          window: {
            backgroundImagePath: "/Users/test/Pictures/catwalk-bg.png",
            backgroundImageOpacity: 0.42,
          } as any,
        },
      },
    );

    expect("backgroundImagePath" in appearance.brand.window).toBe(false);
    expect("backgroundImageOpacity" in appearance.brand.window).toBe(false);
  });

  it("resolves general surface opacity", () => {
    const appearance = resolveAppearance({}, { surfaceOpacity: 0.64 });

    expect(appearance.surfaceOpacity).toBe(0.64);
  });

  it("resolves and clamps the Lab and Connections action icon size", () => {
    expect(resolveAppearance({}, {}).connectionActionIconSize).toBe(19);
    expect(resolveAppearance({ connectionActionIconSize: 20 }, {}).connectionActionIconSize).toBe(20);
    expect(resolveAppearance({ connectionActionIconSize: 20 }, { connectionActionIconSize: 27 }).connectionActionIconSize).toBe(27);
    expect(resolveAppearance({}, { connectionActionIconSize: 8 }).connectionActionIconSize).toBe(14);
    expect(resolveAppearance({}, { connectionActionIconSize: 50 }).connectionActionIconSize).toBe(32);
  });

  it("resolves app and card font sizes independently and clamps both", () => {
    expect(resolveAppearance({}, {}).appFontSize).toBe(16);
    expect(resolveAppearance({}, {}).cardFontSize).toBe(16);
    expect(resolveAppearance(
      { appFontSize: 14, cardFontSize: 15 },
      { appFontSize: 18, cardFontSize: 20 },
    )).toMatchObject({
      appFontSize: 18,
      cardFontSize: 20,
    });
    expect(resolveAppearance({}, { appFontSize: 8, cardFontSize: 30 })).toMatchObject({
      appFontSize: 12,
      cardFontSize: 24,
    });
  });

  it("keeps the legacy list and compact surface opacity preference working", () => {
    const appearance = resolveAppearance({}, { listCompactSurfaceOpacity: 0.52 });

    expect(appearance.surfaceOpacity).toBe(0.52);
  });

  it("resolves behavior defaults", () => {
    const appearance = resolveAppearance({}, {});

    expect(appearance.sessionGroupDoubleClickAction).toBe("reconnect");
    expect(appearance.sessionGroupMiddleClickAction).toBe("closeAll");
    expect(appearance.labDeviceDoubleClickAction).toBe("connect");
    expect(appearance.savedConnectionDoubleClickAction).toBe("connect");
    expect(appearance.terminalSidebarClickBehavior).toBe("singleClickOpen");
    expect(appearance.browseOpenMode).toBe("in_app");
    expect(appearance.savedConnectionRdpApp).toBe("catwalk");
    expect(appearance.terminalNotesShortcut).toBe("primaryShiftN");
    expect(appearance.identitiesShortcut).toBe("primaryShiftI");
    expect(appearance.onePasswordShortcut).toBe("primaryShiftP");
    expect(appearance.notesToolbarDisplay).toBe("icons");
    expect(appearance.terminalToolbarDisplay).toBe("icons");
    expect(appearance.connectionsToolbarDisplay).toBe("icons");
    expect(appearance.topNavigationDisplay).toBe("iconsAndText");
    expect(appearance.vmPowerControlStyle).toBe("segmented");
    expect(appearance.sessionConnectionIconStyle).toBe("outline");
    expect(appearance.buttonIconStyle).toBe("outline");
    expect(appearance.iconEffect).toBe("themeDefault");
    expect(appearance.switchButtonStyle).toBe("segmented");
    expect(appearance.showVmPowerControls).toBe(true);
    expect(appearance.terminalScrollback).toBe(1000);
  });

  it("resolves the global saved-Connection RDP launcher", () => {
    expect(resolveAppearance({}, { savedConnectionRdpApp: "system" }).savedConnectionRdpApp).toBe("system");
    expect(resolveAppearance({}, { savedConnectionRdpApp: "freerdp" }).savedConnectionRdpApp).toBe("freerdp");
    expect(resolveAppearance({ savedConnectionRdpApp: "system" }, {}).savedConnectionRdpApp).toBe("system");
    expect(resolveAppearance({}, { savedConnectionRdpApp: "invalid" } as any).savedConnectionRdpApp).toBe("catwalk");
  });

  it("normalizes the Notes toolbar display preference", () => {
    expect(resolveAppearance({}, { notesToolbarDisplay: "iconsAndText" }).notesToolbarDisplay).toBe("iconsAndText");
    expect(resolveAppearance({}, { notesToolbarDisplay: "invalid" } as any).notesToolbarDisplay).toBe("icons");
  });

  it("normalizes the Sessions toolbar display preference", () => {
    expect(resolveAppearance({}, { terminalToolbarDisplay: "iconsAndText" }).terminalToolbarDisplay).toBe("iconsAndText");
    expect(resolveAppearance({}, { terminalToolbarDisplay: "invalid" } as any).terminalToolbarDisplay).toBe("icons");
  });

  it("normalizes the Connections toolbar display preference", () => {
    expect(resolveAppearance({}, { connectionsToolbarDisplay: "iconsAndText" }).connectionsToolbarDisplay).toBe("iconsAndText");
    expect(resolveAppearance({}, { connectionsToolbarDisplay: "invalid" } as any).connectionsToolbarDisplay).toBe("icons");
  });

  it("normalizes the top navigation display preference", () => {
    expect(resolveAppearance({}, { topNavigationDisplay: "icons" }).topNavigationDisplay).toBe("icons");
    expect(resolveAppearance({}, { topNavigationDisplay: "invalid" } as any).topNavigationDisplay).toBe("iconsAndText");
  });

  it("resolves page title appearance and rejects invalid choices", () => {
    const configured = resolveAppearance({}, {
      pageTitleColor: "custom",
      pageTitleCustomColor: "#ff44aa",
      pageTitleStyle: "accentBar",
    });
    expect(configured.pageTitleColor).toBe("custom");
    expect(configured.pageTitleCustomColor).toBe("#ff44aa");
    expect(configured.pageTitleStyle).toBe("accentBar");

    const fallback = resolveAppearance({}, {
      pageTitleColor: "invalid",
      pageTitleStyle: "invalid",
    } as any);
    expect(fallback.pageTitleColor).toBe("muted");
    expect(fallback.pageTitleStyle).toBe("plain");
  });

  it("resolves every workspace design and rejects invalid choices", () => {
    expect(resolveAppearance({}, {}).workspaceDesign).toBe("commandCenter");
    expect(resolveAppearance({ workspaceDesign: "quiet" }, {}).workspaceDesign).toBe("quiet");
    expect(resolveAppearance({}, { workspaceDesign: "quiet" }).workspaceDesign).toBe("quiet");
    expect(resolveAppearance({}, { workspaceDesign: "structured" }).workspaceDesign).toBe("structured");
    expect(resolveAppearance({}, { workspaceDesign: "commandCenter" }).workspaceDesign).toBe("commandCenter");
    expect(resolveAppearance({}, { workspaceDesign: "invalid" } as any).workspaceDesign).toBe("commandCenter");
  });

  it("normalizes the VM power-control style", () => {
    expect(resolveAppearance({}, { vmPowerControlStyle: "outline" }).vmPowerControlStyle).toBe("outline");
    expect(resolveAppearance({}, { vmPowerControlStyle: "segmented" }).vmPowerControlStyle).toBe("segmented");
    expect(resolveAppearance({}, { vmPowerControlStyle: "primaryDropdown" }).vmPowerControlStyle).toBe("primaryDropdown");
    expect(resolveAppearance({}, { vmPowerControlStyle: "current" }).vmPowerControlStyle).toBe("current");
    expect(resolveAppearance({}, { vmPowerControlStyle: "invalid" } as any).vmPowerControlStyle).toBe("segmented");
  });

  it("resolves the three icon-style preferences independently", () => {
    const appearance = resolveAppearance({}, {
      sessionConnectionIconStyle: "duotone",
      buttonIconStyle: "filled",
      switchButtonStyle: "icons",
    });
    expect(appearance.sessionConnectionIconStyle).toBe("duotone");
    expect(appearance.buttonIconStyle).toBe("filled");
    expect(appearance.switchButtonStyle).toBe("icons");

    const fallback = resolveAppearance({}, {
      sessionConnectionIconStyle: "invalid",
      buttonIconStyle: "invalid",
      switchButtonStyle: "invalid",
    } as any);
    expect(fallback.sessionConnectionIconStyle).toBe("outline");
    expect(fallback.buttonIconStyle).toBe("outline");
    expect(fallback.switchButtonStyle).toBe("segmented");
  });

  it("accepts every offered icon and switch-button design", () => {
    for (const style of ["outline", "rounded", "sharp", "filled", "duotone"] as const) {
      expect(resolveAppearance({}, { buttonIconStyle: style }).buttonIconStyle).toBe(style);
    }
    for (const style of ["segmented", "slider", "compact", "icons", "pill"] as const) {
      expect(resolveAppearance({}, { switchButtonStyle: style }).switchButtonStyle).toBe(style);
    }
  });

  it("normalizes every offered interactive icon effect", () => {
    for (const effect of ["themeDefault", "frost", "burning", "electric", "neon", "off"] as const) {
      expect(resolveAppearance({}, { iconEffect: effect }).iconEffect).toBe(effect);
    }
    expect(resolveAppearance({}, { iconEffect: "invalid" } as any).iconEffect).toBe("themeDefault");
  });

  it("keeps the active navigation icon effect configurable", () => {
    expect(resolveAppearance({}, {}).keepActiveNavigationIconEffect).toBe(true);
    applyToDocument(resolveAppearance({}, { keepActiveNavigationIconEffect: false }));
    expect(document.documentElement.dataset.activeNavigationIconEffect).toBe("off");
    applyToDocument(resolveAppearance({}, { keepActiveNavigationIconEffect: true }));
    expect(document.documentElement.dataset.activeNavigationIconEffect).toBe("on");
  });

  it("maps Theme default to the original GoT effects and Off elsewhere", () => {
    applyToDocument(resolveAppearance({}, {
      colorScheme: "light",
      brand: { id: "got" },
      iconEffect: "themeDefault",
    }));
    expect(document.documentElement.dataset.iconEffect).toBe("frost");

    applyToDocument(resolveAppearance({}, {
      colorScheme: "dark",
      brand: { id: "got" },
      iconEffect: "themeDefault",
    }));
    expect(document.documentElement.dataset.iconEffect).toBe("burning");

    applyToDocument(resolveAppearance({}, {
      colorScheme: "dark",
      brand: { id: "connecat" },
      iconEffect: "themeDefault",
    }));
    expect(document.documentElement.dataset.iconEffect).toBe("off");

    applyToDocument(resolveAppearance({}, {
      colorScheme: "light",
      brand: { id: "connecat" },
      iconEffect: "electric",
    }));
    expect(document.documentElement.dataset.iconEffect).toBe("electric");
  });

  it("cleans up background image state left by older releases", () => {
    document.documentElement.dataset.appBackgroundImage = "on";
    document.documentElement.style.setProperty("--app-bg-image", "url(/tmp/legacy.png)");
    document.documentElement.style.setProperty("--app-bg-image-opacity", "0.25");

    applyToDocument(resolveAppearance({}, {}));

    expect(document.documentElement.dataset.appBackgroundImage).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--app-bg-image")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--app-bg-image-opacity")).toBe("");
  });

  it("resolves VM power-control visibility", () => {
    expect(resolveAppearance({}, { showVmPowerControls: false }).showVmPowerControls).toBe(false);
    expect(resolveAppearance({ showVmPowerControls: false }, {}).showVmPowerControls).toBe(false);
  });

  it("resolves the global Browse open mode and rejects invalid values", () => {
    expect(resolveAppearance({}, { browseOpenMode: "external" }).browseOpenMode).toBe("external");
    expect(resolveAppearance({}, { browseOpenMode: "window" }).browseOpenMode).toBe("window");
    expect(resolveAppearance({}, { browseOpenMode: "invalid" } as any).browseOpenMode).toBe("in_app");
  });

  it("keeps the legacy double-click SSH preference working", () => {
    const appearance = resolveAppearance({}, { autoOpenSshOnDoubleClick: false });

    expect(appearance.labDeviceDoubleClickAction).toBe("none");
    expect(appearance.savedConnectionDoubleClickAction).toBe("none");
    expect(appearance.settingsOpenDelayMs).toBe(0);
  });

  it("resolves independent behavior preferences", () => {
    const appearance = resolveAppearance(
      {},
      {
        sessionGroupDoubleClickAction: "ungroup",
        sessionGroupMiddleClickAction: "reconnect",
        labDeviceDoubleClickAction: "none",
        savedConnectionDoubleClickAction: "connect",
        terminalSidebarClickBehavior: "doubleClickOpen",
      },
    );

    expect(appearance.sessionGroupDoubleClickAction).toBe("ungroup");
    expect(appearance.sessionGroupMiddleClickAction).toBe("reconnect");
    expect(appearance.labDeviceDoubleClickAction).toBe("none");
    expect(appearance.savedConnectionDoubleClickAction).toBe("connect");
    expect(appearance.terminalSidebarClickBehavior).toBe("doubleClickOpen");
    expect(appearance.settingsOpenDelayMs).toBe(500);
  });

  it("falls back when behavior preferences are invalid", () => {
    const appearance = resolveAppearance(
      {},
      {
        sessionGroupDoubleClickAction: "explode",
        sessionGroupMiddleClickAction: "explode",
        labDeviceDoubleClickAction: "explode",
        savedConnectionDoubleClickAction: "explode",
        terminalSidebarClickBehavior: "explode",
      } as any,
    );

    expect(appearance.sessionGroupDoubleClickAction).toBe("reconnect");
    expect(appearance.sessionGroupMiddleClickAction).toBe("closeAll");
    expect(appearance.labDeviceDoubleClickAction).toBe("connect");
    expect(appearance.savedConnectionDoubleClickAction).toBe("connect");
    expect(appearance.terminalSidebarClickBehavior).toBe("singleClickOpen");
    expect(appearance.terminalNotesShortcut).toBe("primaryShiftN");
    expect(appearance.identitiesShortcut).toBe("primaryShiftI");
    expect(appearance.onePasswordShortcut).toBe("primaryShiftP");
  });

  it("resolves the configured terminal Notes shortcut", () => {
    expect(resolveAppearance({}, { terminalNotesShortcut: "primaryAltN" }).terminalNotesShortcut).toBe("primaryAltN");
    expect(resolveAppearance({}, { terminalNotesShortcut: "disabled" }).terminalNotesShortcut).toBe("disabled");
  });

  it("resolves the configured Identities shortcut", () => {
    expect(resolveAppearance({}, { identitiesShortcut: "primaryAltI" }).identitiesShortcut).toBe("primaryAltI");
    expect(resolveAppearance({}, { identitiesShortcut: "disabled" }).identitiesShortcut).toBe("disabled");
  });

  it("resolves the configured 1Password shortcut", () => {
    expect(resolveAppearance({}, { onePasswordShortcut: "primaryAltP" }).onePasswordShortcut).toBe("primaryAltP");
    expect(resolveAppearance({}, { onePasswordShortcut: "disabled" }).onePasswordShortcut).toBe("disabled");
  });
});

describe("automatic day and night themes", () => {
  it("selects the configured period using local wall-clock time", () => {
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 6, 59), "07:00", "19:00")).toBe("night");
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 7, 0), "07:00", "19:00")).toBe("day");
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 18, 59), "07:00", "19:00")).toBe("day");
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 19, 0), "07:00", "19:00")).toBe("night");
  });

  it("supports a day period that crosses midnight", () => {
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 23, 0), "20:00", "06:00")).toBe("day");
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 4, 0), "20:00", "06:00")).toBe("day");
    expect(getScheduledThemePeriod(new Date(2026, 6, 30, 12, 0), "20:00", "06:00")).toBe("night");
  });

  it("switches only theme-related values and keeps shared appearance preferences", () => {
    const prefs = {
      appFontSize: 18,
      cardFontSize: 15,
      workspaceDesign: "structured" as const,
      terminal: { fontSize: 14 },
      brand: { id: "manual", accent: "#999999" },
      colorScheme: "medium" as const,
      themeSchedule: {
        enabled: true,
        dayStart: "07:00",
        nightStart: "19:00",
        day: {
          themeValue: "builtin:day",
          colorScheme: "light" as const,
          brand: { id: "day", accent: "#eeeeee" },
          terminal: { theme: { background: "#ffffff" } },
        },
        night: {
          themeValue: "builtin:night",
          colorScheme: "dark" as const,
          brand: { id: "night", accent: "#111111" },
          terminal: { theme: { background: "#000000" } },
        },
      },
    };

    const effective = applyThemeSchedule(prefs, new Date(2026, 6, 30, 21, 0));

    expect(effective).toMatchObject({
      appFontSize: 18,
      cardFontSize: 15,
      workspaceDesign: "structured",
      colorScheme: "dark",
      brand: { id: "night", accent: "#111111" },
      terminal: {
        fontSize: 14,
        theme: { background: "#000000" },
      },
    });
  });

  it("leaves the normal theme untouched when automation is disabled", () => {
    const prefs = {
      brand: { id: "manual" },
      colorScheme: "medium" as const,
      themeSchedule: {
        enabled: false,
        dayStart: "07:00",
        nightStart: "19:00",
        day: {
          themeValue: "builtin:day",
          colorScheme: "light" as const,
          brand: { id: "day" },
        },
        night: {
          themeValue: "builtin:night",
          colorScheme: "dark" as const,
          brand: { id: "night" },
        },
      },
    };

    expect(applyThemeSchedule(prefs, new Date(2026, 6, 30, 21, 0))).toBe(prefs);
  });

  it("disables automation without discarding the configured schedule", () => {
    const prefs = {
      brand: { id: "manual" },
      themeSchedule: {
        enabled: true,
        dayStart: "07:00",
        nightStart: "19:00",
        day: {
          themeValue: "builtin:day",
          colorScheme: "light" as const,
          brand: { id: "day" },
        },
        night: {
          themeValue: "builtin:night",
          colorScheme: "dark" as const,
          brand: { id: "night" },
        },
      },
    };

    const result = disableThemeSchedule(prefs);

    expect(result.themeSchedule).toEqual({
      ...prefs.themeSchedule,
      enabled: false,
    });
    expect(result.brand).toBe(prefs.brand);
  });
});

describe("appearance brand identity isolation", () => {
  it("restores the light window palette for a saved ConnCat Light theme", () => {
    const appearance = resolveAppearance(
      {},
      {
        colorScheme: "light",
        brand: {
          id: "connecat",
          identity: "default",
          accent: "#049fd9",
          window: {
            bg: "#00253d",
            panel: "#003459",
            fg: "#e5f1f8",
            muted: "#7d9bb8",
            border: "#004d7a",
            inputBg: "#00304f",
            btnFg: "#ffffff",
            backgroundImagePath: "/tmp/ocean-blue-light.png",
            backgroundImageOpacity: 0.2,
          } as any,
        },
      },
    );

    expect(appearance.colorScheme).toBe("light");
    expect(appearance.brand.window).toMatchObject({
      bg: undefined,
      panel: undefined,
      fg: undefined,
      muted: undefined,
      border: undefined,
      inputBg: undefined,
      btnFg: undefined,
    });
    expect("backgroundImagePath" in appearance.brand.window).toBe(false);
    expect("backgroundImageOpacity" in appearance.brand.window).toBe(false);
  });

  it("uses softer shared surfaces for a built-in theme in Medium mode", () => {
    const appearance = resolveAppearance(
      {},
      {
        colorScheme: "medium",
        brand: {
          id: "pride",
          identity: "default",
          accent: "#ffb703",
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
      },
    );

    expect(appearance.colorScheme).toBe("medium");
    expect(appearance.brand.accent).toBe("#ffb703");
    expect(appearance.brand.window).toMatchObject({
      bg: undefined,
      panel: undefined,
      fg: undefined,
      muted: undefined,
      border: undefined,
      inputBg: undefined,
      btnFg: undefined,
    });
  });

  it("lets a light-first built-in theme use the shared Dark surfaces", () => {
    const appearance = resolveAppearance(
      {},
      {
        colorScheme: "dark",
        brand: {
          id: "jedi",
          identity: "default",
          accent: "#3aa7e8",
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
      },
    );

    expect(appearance.colorScheme).toBe("dark");
    expect(appearance.brand.window.bg).toBeUndefined();
    expect(appearance.brand.window.panel).toBeUndefined();
    expect(appearance.brand.window.inputBg).toBeUndefined();
  });

  it("does not leak the site-default custom name and logo into a built-in theme", () => {
    const appearance = resolveAppearance(
      {
        brand: {
          id: "custom-lab",
          name: "CE Custom",
          logoUrl: "data:image/png;base64,custom",
        },
      },
      {
        brand: {
          id: "connecat",
          identity: "default",
          accent: "#049fd9",
        },
      },
    );

    expect(appearance.brand.id).toBe("connecat");
    expect(appearance.brand.name).toBe("ConnCat");
    expect(appearance.brand.logoUrl).toBe("/connecat.png");
  });

  it("uses only the selected custom preset identity instead of inherited server branding", () => {
    const appearance = resolveAppearance(
      {
        brand: {
          name: "Site Default",
          logoUrl: "data:image/png;base64,site",
        },
      },
      {
        brand: {
          id: "custom-minimal",
          identity: "custom",
          name: "Minimal",
          logoUrl: "",
        },
      },
    );

    expect(appearance.brand.name).toBe("Minimal");
    expect(appearance.brand.logoUrl).toBe("");
  });

  it("does not let the site window palette override a custom preset mode", () => {
    const appearance = resolveAppearance(
      {
        brand: {
          window: {
            bg: "#00253d",
            panel: "#003459",
            inputBg: "#00304f",
          },
        },
      },
      {
        colorScheme: "medium",
        brand: {
          id: "custom-minimal",
          identity: "custom",
          name: "Minimal",
          window: {
            backgroundImagePath: "/tmp/minimal.png",
          } as any,
        },
      },
    );

    expect(appearance.colorScheme).toBe("medium");
    expect(appearance.brand.window.bg).toBeUndefined();
    expect(appearance.brand.window.panel).toBeUndefined();
    expect(appearance.brand.window.inputBg).toBeUndefined();
    expect("backgroundImagePath" in appearance.brand.window).toBe(false);
  });

  it("uses the portal palette for the selected scheme without changing theme id", () => {
    const server = {
      themeSchemeOverrides: {
        pride: {
          defaultScheme: "medium" as const,
          schemes: {
            medium: { window: { bg: "#1a1426", panel: "#2a1a4d" } },
            dark: { window: { bg: "#0b0711", panel: "#160d27" } },
            light: { window: { bg: "#fff7fb", panel: "#ffffff" } },
          },
        },
      },
    };
    const medium = resolveAppearance(server, {
      colorScheme: "medium",
      brand: { id: "pride", identity: "default", window: { bg: "#stale" } },
    });
    const dark = resolveAppearance(server, {
      colorScheme: "dark",
      brand: { id: "pride", identity: "default", window: { bg: "#stale" } },
    });
    const light = resolveAppearance(server, {
      colorScheme: "light",
      brand: { id: "pride", identity: "default", window: { bg: "#stale" } },
    });

    expect(medium.brand.id).toBe("pride");
    expect(medium.brand.window.bg).toBe("#1a1426");
    expect(medium.brand.window.panel).toBe("#2a1a4d");
    expect(dark.brand.id).toBe("pride");
    expect(dark.brand.window.bg).toBe("#0b0711");
    expect(dark.brand.window.panel).toBe("#160d27");
    expect(light.brand.id).toBe("pride");
    expect(light.brand.window.bg).toBe("#fff7fb");
    expect(light.brand.window.panel).toBe("#ffffff");
  });

  it("replaces the original low-contrast house palette with the bundled Medium palette", () => {
    const appearance = resolveAppearance({
      themeSchemeOverrides: {
        "got-stark": {
          schemes: {
            medium: { window: { bg: "#d8dedb", panel: "#edf1ef" } },
          },
        },
      },
    }, {
      colorScheme: "medium",
      brand: {
        id: "got-stark",
        identity: "default",
        name: "House Stark",
        logoUrl: "data:image/svg+xml,stark",
        window: { bg: "#stale-house-bg", panel: "#stale-house-panel" },
      },
    });

    expect(appearance.brand.id).toBe("got-stark");
    expect(appearance.brand.name).toBe("House Stark");
    expect(appearance.brand.logoUrl).toContain("stark.png");
    expect(appearance.brand.logoUrl).not.toBe("data:image/svg+xml,stark");
    expect(appearance.brand.window.bg).toBe("#202729");
    expect(appearance.brand.window.panel).toBe("#303a3c");
  });

  it("keeps house-specific contrast in Light and Dark instead of shared surfaces", () => {
    const staleServer = {
      themeSchemeOverrides: {
        "got-baratheon": {
          schemes: {
            light: { window: { bg: "#fff7dc", panel: "#fffdf4" } },
            dark: { window: { bg: "#19160d", panel: "#2c2612" } },
          },
        },
      },
    };
    const light = resolveAppearance(staleServer, {
      colorScheme: "light",
      brand: { id: "got-baratheon", identity: "default" },
    });
    const dark = resolveAppearance(staleServer, {
      colorScheme: "dark",
      brand: { id: "got-baratheon", identity: "default" },
    });

    expect(light.brand.window.bg).toBe("#eee2ad");
    expect(light.brand.window.panel).toBe("#fff2c7");
    expect(dark.brand.window.bg).toBe("#100f08");
    expect(dark.brand.window.panel).toBe("#2b2510");
  });

  it("uses a legible scheme-specific Arryn accent while preserving user overrides", () => {
    const light = resolveAppearance({}, {
      colorScheme: "light",
      brand: { id: "got-arryn", identity: "default", accent: "#d6eaff" },
    });
    const dark = resolveAppearance({}, {
      colorScheme: "dark",
      brand: { id: "got-arryn", identity: "default", accent: "#d6eaff" },
    });
    const customized = resolveAppearance({}, {
      colorScheme: "light",
      brand: { id: "got-arryn", identity: "default", accent: "#7a21c4" },
    });

    expect(getEffectiveAccent(light)).toBe("#285f8f");
    expect(getEffectiveAccent(dark)).toBe("#9ed2f5");
    expect(light.terminalAnsiAccent).toBe("#285f8f");
    expect(dark.terminalAnsiAccent).toBe("#9ed2f5");
    expect(getEffectiveAccent(customized)).toBe("#7a21c4");
  });

  it("uses a deeper Tully river blue on Light surfaces", () => {
    const light = resolveAppearance({}, {
      colorScheme: "light",
      brand: { id: "got-tully", identity: "default", accent: "#d9e1e7" },
    });
    const medium = resolveAppearance({}, {
      colorScheme: "medium",
      brand: { id: "got-tully", identity: "default", accent: "#d9e1e7" },
    });

    expect(getEffectiveAccent(light)).toBe("#365f7d");
    expect(light.terminalAnsiAccent).toBe("#365f7d");
    expect(getEffectiveAccent(medium)).toBe("#d9e1e7");
  });

  it("applies scheme palettes to a custom site-created theme", () => {
    const appearance = resolveAppearance(
      {
        themeSchemeOverrides: {
          "night-owl": {
            defaultScheme: "medium",
            schemes: {
              dark: { window: { bg: "#00111d", panel: "#001f33" } },
            },
          },
        },
      },
      {
        colorScheme: "dark",
        brand: {
          id: "night-owl",
          identity: "custom",
          name: "Night Owl",
          logoUrl: "owl.png",
          window: { bg: "#00253d" },
        },
      },
    );

    expect(appearance.brand.id).toBe("night-owl");
    expect(appearance.brand.logoUrl).toBe("owl.png");
    expect(appearance.brand.window.bg).toBe("#00111d");
    expect(appearance.brand.window.panel).toBe("#001f33");
  });
});
