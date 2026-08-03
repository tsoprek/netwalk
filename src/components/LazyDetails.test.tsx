import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LazyDetails from "./LazyDetails";

describe("LazyDetails", () => {
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

  it("mounts content only while expanded", () => {
    act(() => root.render(
      <LazyDetails summary="Appearance">
        <div data-testid="expensive-settings">Controls</div>
      </LazyDetails>,
    ));

    const details = host.querySelector("details") as HTMLDetailsElement;
    expect(host.querySelector("[data-testid='expensive-settings']")).toBeNull();

    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(host.querySelector("[data-testid='expensive-settings']")).not.toBeNull();

    act(() => {
      details.open = false;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(host.querySelector("[data-testid='expensive-settings']")).toBeNull();
  });
});
