// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OnePasswordCredentialPicker from "./OnePasswordCredentialPicker";
import { listOnePasswordLogins } from "../api/onePassword";

vi.mock("../api/onePassword", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/onePassword")>();
  return {
    ...original,
    listOnePasswordLogins: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("OnePasswordCredentialPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("chooses Login items in a popup instead of adding an inline dropdown", async () => {
    vi.mocked(listOnePasswordLogins).mockResolvedValue([
      {
        title: "Lab admin",
        vaultName: "CE Lab",
        itemReference: "op://CE Lab/Lab admin",
      },
    ]);
    const onChange = vi.fn();
    act(() => {
      root.render(<OnePasswordCredentialPicker value={{ itemReference: "" }} onChange={onChange} />);
    });

    const choose = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Choose"));
    await act(async () => {
      choose?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector('[role="dialog"][aria-label="Choose a 1Password Login item"]');
    expect(dialog).not.toBeNull();
    expect(host.querySelector("select")).toBeNull();
    expect(dialog?.textContent).toContain("Lab admin");
    expect(dialog?.textContent).toContain("CE Lab");

    const item = dialog?.querySelector(".one-password-chooser__item");
    act(() => {
      item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({ itemReference: "op://CE Lab/Lab admin" });
    expect(document.body.querySelector('[role="dialog"][aria-label="Choose a 1Password Login item"]')).toBeNull();
  });

  it("uses compact Test, Choose, and Clear actions in connection settings", () => {
    const onClear = vi.fn();
    act(() => {
      root.render(
        <OnePasswordCredentialPicker
          value={{ itemReference: "op://CE Lab/Lab admin" }}
          onChange={() => {}}
          onClear={onClear}
        />,
      );
    });

    const actions = Array.from(host.querySelectorAll<HTMLButtonElement>(".outline-action-button"));
    expect(actions.map((button) => button.textContent?.trim())).toEqual([
      "Test connection",
      "Choose",
      "Clear",
    ]);
    expect(actions.every((button) => button.classList.contains("btn-small"))).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Clear configured 1Password Login"]')?.click());
    expect(onClear).toHaveBeenCalledOnce();
  });
});
