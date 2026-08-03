import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotesIcon from "./NotesIcon";

describe("NotesIcon appearance categories", () => {
  it("separates session and connection icons from general button icons", () => {
    expect(renderToStaticMarkup(<NotesIcon name="ssh" />)).toContain(
      'data-icon-category="session-connection"',
    );
    expect(renderToStaticMarkup(<NotesIcon name="find" />)).toContain(
      'data-icon-category="button"',
    );
  });

  it("marks an explicit preview design independently from the active global set", () => {
    expect(renderToStaticMarkup(<NotesIcon name="ssh" presentationStyle="duotone" />)).toContain(
      'data-icon-presentation="duotone"',
    );
  });

  it("renders the shared detach-window session action icon", () => {
    const markup = renderToStaticMarkup(<NotesIcon name="detach-window" />);
    expect(markup).toContain('data-notes-icon="detach-window"');
    expect(markup).toContain('data-icon-category="session-connection"');
  });

  it("renders reconnect as the shared session action icon", () => {
    const markup = renderToStaticMarkup(<NotesIcon name="reconnect" />);
    expect(markup).toContain('data-notes-icon="reconnect"');
    expect(markup).toContain('data-icon-category="session-connection"');
  });
});
