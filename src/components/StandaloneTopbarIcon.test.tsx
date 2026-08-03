import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StandaloneTopbarIcon, { type StandaloneTopbarIconName } from "./StandaloneTopbarIcon";

describe("StandaloneTopbarIcon", () => {
  it("renders the complete standalone top-bar family", () => {
    const names: StandaloneTopbarIconName[] = [
      "brand",
      "connections",
      "sessions",
      "remote-access",
      "templates",
      "notes",
      "identities",
      "settings",
    ];

    for (const name of names) {
      expect(renderToStaticMarkup(<StandaloneTopbarIcon name={name} />)).toContain(
        `data-standalone-topbar-icon="${name}"`,
      );
    }
  });

  it("inherits the theme color and uses thinner secondary details", () => {
    const markup = renderToStaticMarkup(<StandaloneTopbarIcon name="brand" />);
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).toContain('stroke-width="1.35"');
    expect(markup).toContain('opacity="0.65"');
  });
});
