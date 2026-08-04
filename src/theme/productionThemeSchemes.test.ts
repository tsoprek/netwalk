import { describe, expect, it } from "vitest";
import { resolveAppearance } from "../api/appearance";
import { PRODUCTION_THEME_SCHEME_OVERRIDES } from "./productionThemeSchemes";

const PRODUCTION_THEME_IDS = [
  "cisco",
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

  it("uses standalone display names and omits deleted Black Cat themes", () => {
    expect(PRODUCTION_THEME_SCHEME_OVERRIDES.cisco.label).toBe("Ocean Blue");
    expect(PRODUCTION_THEME_SCHEME_OVERRIDES["thousandeyes-steel"].label).toBe("Steel Horizon");
    expect(PRODUCTION_THEME_SCHEME_OVERRIDES["cisco-black-cat"]).toBeUndefined();
    expect(PRODUCTION_THEME_SCHEME_OVERRIDES["cisco-black-cat-2"]).toBeUndefined();
  });

  it("applies the Ocean Blue palette to the standalone ConnCat alias", () => {
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
