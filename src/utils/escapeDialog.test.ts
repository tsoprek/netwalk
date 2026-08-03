// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissTopDialog, installEscapeDialogDismiss } from "./escapeDialog";

afterEach(() => {
  document.body.replaceChildren();
});

function dialog(buttonLabel: string): { root: HTMLDivElement; button: HTMLButtonElement } {
  const root = document.createElement("div");
  root.setAttribute("role", "dialog");
  const button = document.createElement("button");
  button.textContent = buttonLabel;
  root.appendChild(button);
  document.body.appendChild(root);
  return { root, button };
}

describe("Escape dialog dismissal", () => {
  it("clicks the top-most dialog's Cancel action", () => {
    const first = dialog("Cancel");
    const second = dialog("Cancel");
    const firstClick = vi.fn();
    const secondClick = vi.fn();
    first.button.addEventListener("click", firstClick);
    second.button.addEventListener("click", secondClick);

    expect(dismissTopDialog()).toBe(true);
    expect(firstClick).not.toHaveBeenCalled();
    expect(secondClick).toHaveBeenCalledOnce();
  });

  it("uses an icon button's Close accessible label", () => {
    const item = dialog("");
    item.button.setAttribute("aria-label", "Close");
    const click = vi.fn();
    item.button.addEventListener("click", click);

    expect(dismissTopDialog()).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it("does not treat a destructive Close case action as dialog dismissal", () => {
    dialog("Close case");
    expect(dismissTopDialog()).toBe(false);
  });

  it("lets an open select consume Escape before its parent dialog", () => {
    const item = dialog("Cancel");
    const select = document.createElement("button");
    select.className = "themed-select open";
    item.root.appendChild(select);
    const click = vi.fn();
    item.button.addEventListener("click", click);
    const uninstall = installEscapeDialogDismiss();

    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(click).not.toHaveBeenCalled();
    uninstall();
  });
});
