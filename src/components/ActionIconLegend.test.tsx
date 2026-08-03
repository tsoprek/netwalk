// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ActionIconLegend from "./ActionIconLegend";

describe("ActionIconLegend", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<ActionIconLegend items={[{ icon: "ssh", label: "SSH" }]} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("closes when the user clicks outside", () => {
    const legend = host.querySelector("details") as HTMLDetailsElement;
    legend.open = true;

    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(legend.open).toBe(false);
  });

  it("stays open for clicks inside the legend", () => {
    const legend = host.querySelector("details") as HTMLDetailsElement;
    const panel = host.querySelector(".action-icon-legend__panel") as HTMLElement;
    legend.open = true;

    act(() => {
      panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(legend.open).toBe(true);
  });
});
