import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeviceGridItem, { getDeviceGridDiagnostics } from "./DeviceGridItem";

describe("DeviceGridItem", () => {
  let host: HTMLDivElement;
  let root: Root;
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal("ResizeObserver", class {
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("always renders every row and shares one compact ResizeObserver", () => {
    act(() => root.render(<>
      <DeviceGridItem id="1" hasNote={false} shouldMeasure>
        <div className="compact-row">one</div>
      </DeviceGridItem>
      <DeviceGridItem id="2" hasNote={false} shouldMeasure>
        <div className="compact-row">two</div>
      </DeviceGridItem>
    </>));

    expect(host.querySelectorAll(".compact-row")).toHaveLength(2);
    expect(host.querySelector("[data-virtualized]")).toBeNull();
    expect(getDeviceGridDiagnostics()).toEqual({
      activeResizeObserverCount: 1,
      activeResizeObserverTargetCount: 2,
    });
  });

  it("creates no observer in List mode", () => {
    act(() => root.render(
      <DeviceGridItem id="list" hasNote={false} shouldMeasure={false}>
        <div className="compact-row">list row</div>
      </DeviceGridItem>,
    ));
    expect(observe).not.toHaveBeenCalled();
    expect(getDeviceGridDiagnostics()).toEqual({
      activeResizeObserverCount: 0,
      activeResizeObserverTargetCount: 0,
    });
  });
});
