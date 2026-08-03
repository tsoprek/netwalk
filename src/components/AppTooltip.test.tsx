import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppTooltip from "./AppTooltip";

describe("AppTooltip", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<>
        <button title="Double-click to open SSH in app">SSH</button>
        <AppTooltip />
      </>);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("replaces native titles with a delayed app tooltip", async () => {
    const button = host.querySelector("button")!;
    button.getBoundingClientRect = () => ({
      x: 20, y: 100, left: 20, top: 100, right: 100, bottom: 132,
      width: 80, height: 32, toJSON: () => ({}),
    });

    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(button.hasAttribute("title")).toBe(false);
    expect(document.querySelector(".app-tooltip")).toBeNull();

    await act(async () => vi.advanceTimersByTime(1_999));
    expect(document.querySelector(".app-tooltip")).toBeNull();

    await act(async () => vi.advanceTimersByTime(1));
    expect(document.querySelector(".app-tooltip")?.textContent)
      .toBe("Double-click to open SSH in app");

    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(document.querySelector(".app-tooltip")).toBeNull();
  });

  it("shows the same hint immediately for keyboard focus", async () => {
    const button = host.querySelector("button")!;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      button.focus();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent)
      .toBe("Double-click to open SSH in app");
  });

  it("shows explicitly immediate tooltips without allocating a delayed timer", async () => {
    const button = host.querySelector("button")!;
    button.removeAttribute("title");
    button.dataset.appTooltip = "Immediate field help";
    button.dataset.appTooltipImmediate = "true";

    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Immediate field help");
  });

  it("does not pin a tooltip when a pointer click focuses a control", async () => {
    const button = host.querySelector("button")!;
    await act(async () => {
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      button.focus();
    });
    expect(document.querySelector(".app-tooltip")).toBeNull();
  });

  it("does not reveal a tooltip after its target is removed", async () => {
    const button = host.querySelector("button")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      button.remove();
      vi.advanceTimersByTime(2_000);
    });
    expect(document.querySelector(".app-tooltip")).toBeNull();
    // Restore React's managed node before the shared test cleanup unmounts it.
    host.prepend(button);
  });
});
