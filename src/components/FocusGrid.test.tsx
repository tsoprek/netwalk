// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import FocusGrid from "./FocusGrid";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function dragEvent(type: string, transfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

describe("FocusGrid reordering", () => {
  it("accepts a drop before React commits drag-start state", () => {
    const onReorder = vi.fn();
    const onDragChange = vi.fn();
    const values = new Map<string, string>();
    const transfer = {
      effectAllowed: "none",
      dropEffect: "none",
      get types() {
        return [...values.keys()];
      },
      setData(type: string, value: string) {
        values.set(type, value);
      },
      getData(type: string) {
        return values.get(type) ?? "";
      },
    } as unknown as DataTransfer;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <FocusGrid
          items={[
            { id: "one", card: <span>One</span> },
            { id: "two", card: <span>Two</span> },
          ]}
          expandedId={null}
          onPick={vi.fn()}
          onClose={vi.fn()}
          onReorder={onReorder}
          onDragChange={onDragChange}
        />,
      );
    });

    const cards = container.querySelectorAll('[role="button"]');
    expect(cards).toHaveLength(2);

    // Keep all three browser events in one React batch. A state-only drag ID
    // is still null here, which reproduces the WebView timing regression.
    let over: Event;
    act(() => {
      cards[0].dispatchEvent(dragEvent("dragstart", transfer));
      over = dragEvent("dragover", transfer);
      cards[1].dispatchEvent(over);
      cards[1].dispatchEvent(dragEvent("drop", transfer));
    });

    expect(over!.defaultPrevented).toBe(true);
    expect(transfer.getData("text/plain")).toBe("catwalk-focus:one");
    expect(onReorder).toHaveBeenCalledWith("one", "two");
    expect(onDragChange).toHaveBeenCalledWith("one");
  });
});
