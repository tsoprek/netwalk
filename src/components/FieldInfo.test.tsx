import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FieldInfo from "./FieldInfo";

describe("FieldInfo", () => {
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
  });

  it("renders its help in a React portal without using the global icon tooltip", () => {
    act(() => root.render(<FieldInfo label="Resolution" text="Higher resolutions use more memory." />));
    const button = host.querySelector("button")!;
    button.getBoundingClientRect = () => ({
      x: 100, y: 100, left: 100, right: 118, top: 100, bottom: 118,
      width: 18, height: 18, toJSON: () => ({}),
    });

    act(() => button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    const tooltip = document.body.querySelector<HTMLElement>("[role='tooltip']");
    expect(tooltip?.textContent).toBe("Higher resolutions use more memory.");
    expect(button.dataset.appTooltip).toBeUndefined();
    expect(button.getAttribute("aria-label")).toContain("Higher resolutions");
    expect(button.getAttribute("aria-describedby")).toBe(tooltip?.id);

    act(() => button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
  });
});
