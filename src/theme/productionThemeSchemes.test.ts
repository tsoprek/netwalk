import { describe, expect, it } from "vitest";
import { resolveAppearance } from "../api/appearance";
import { PRODUCTION_THEME_SCHEME_OVERRIDES } from "./productionThemeSchemes";

const PRODUCTION_THEME_IDS = [
  "cisco",
  "cisco-black-cat",
  "cisco-black-cat-2",
  "got",
  "got-arryn",
  "got-baratheon",
  "got-greyjoy",
  "got-lannister",
  "got-martell",
  "got-stark",
  "got-targaryen",
  "got-tully",
  "got-tyrell",
  "pride",
  "squid",
  "thousandeyes-steel",
] as const;

describe("production theme scheme mirror", () => {
  it("contains complete Light, Medium, and Dark window palettes", () => {
    for (const id of PRODUCTION_THEME_IDS) {
      const theme = PRODUCTION_THEME_SCHEME_OVERRIDES[id];
      expect(theme, id).toBeDefined();
      expect(theme.defaultScheme, id).toBe("medium");
      for (const scheme of ["light", "medium", "dark"] as const) {
        expect(theme.schemes?.[scheme]?.window, `${id}:${scheme}`).toEqual({
          bg: expect.any(String),
          border: expect.any(String),
          btnFg: expect.any(String),
          fg: expect.any(String),
          inputBg: expect.any(String),
          muted: expect.any(String),
          panel: expect.any(String),
        });
      }
    }
  });

  it("keeps the production Cisco Black Cat 2 palettes exact", () => {
    const schemes = PRODUCTION_THEME_SCHEME_OVERRIDES["cisco-black-cat-2"].schemes;
    expect(schemes?.dark?.window).toEqual({
      bg: "#0f172a",
      border: "#334155",
      btnFg: "#0f172a",
      fg: "#e2e8f0",
      inputBg: "#162235",
      muted: "#94a3b8",
      panel: "#1e293b",
    });
    expect(schemes?.medium?.window).toEqual({
      bg: "#193e62",
      border: "#0a0817",
      btnFg: "#ffffff",
      fg: "#e5f1f8",
      inputBg: "rgba(0, 0, 0, 0)",
      muted: "#7d9bb8",
      panel: "#00477b",
    });
    expect(schemes?.light?.window).toEqual({
      bg: "#f8fafc",
      border: "#cbd5e1",
      btnFg: "#ffffff",
      fg: "#0f172a",
      inputBg: "#f8fafc",
      muted: "#64748b",
      panel: "#ffffff",
    });
  });

  it("applies the production Cisco palette to the standalone ConneCat alias", () => {
    const appearance = resolveAppearance({
      themeSchemeOverrides: PRODUCTION_THEME_SCHEME_OVERRIDES,
    }, {});
    expect(appearance.brand.id).toBe("connecat");
    expect(appearance.colorScheme).toBe("dark");
    expect(appearance.brand.window).toEqual({
      bg: "#00111d",
      border: "#003d61",
      btnFg: "#ffffff",
      fg: "#eaf6fc",
      inputBg: "#000d16",
      muted: "#6e8ca7",
      panel: "#001f33",
    });
  });
});
