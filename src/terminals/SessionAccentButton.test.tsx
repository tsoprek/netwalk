import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotesIcon from "../components/NotesIcon";
import terminalsSource from "../pages/Terminals.tsx?raw";
import SessionAccentButton from "./SessionAccentButton";

describe("SessionAccentButton", () => {
  it("always retains the shared session accent contract", () => {
    const markup = renderToStaticMarkup(
      <SessionAccentButton className="terminals-tab-find" aria-label="Find">
        <NotesIcon name="find" />
      </SessionAccentButton>,
    );

    expect(markup).toContain('class="session-accent-action terminals-tab-find"');
    expect(markup).toContain('style="color:var(--accent)"');
    expect(markup).toContain('data-notes-icon="find"');
  });

  it("keeps button props and session icon categories intact", () => {
    const markup = renderToStaticMarkup(
      <SessionAccentButton disabled aria-label="Open externally">
        <NotesIcon name="detach-window" />
      </SessionAccentButton>,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain('data-icon-category="session-connection"');
  });

  it("covers every persistent Sessions accent action", () => {
    for (const className of [
      "terminals-tab-popout",
      "terminals-tab-group-popout",
      "terminals-tab-group-split",
      "terminals-tab-broadcast-all",
      "terminals-tab-find",
      "terminals-tab-notes",
      "terminals-tab-notes-menu",
      "terminals-pane-layout-btn",
    ]) {
      expect(terminalsSource).toMatch(
        new RegExp(`<SessionAccentButton[\\s\\S]{0,300}className=[^>]*${className}`),
      );
    }
    expect(terminalsSource).toContain("terminals-tab-split-marker session-accent-icon");
  });

  it("does not allow a caller style to mute the accent", () => {
    const markup = renderToStaticMarkup(
      <SessionAccentButton style={{ color: "var(--muted)" }} aria-label="Split" />,
    );

    expect(markup).toContain('style="color:var(--accent)"');
    expect(markup).not.toContain("var(--muted)");
  });
});
