import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ThemedSelect from "./ThemedSelect";

function Harness() {
  const [value, setValue] = useState("one");
  return (
    <section onMouseDown={(event) => event.stopPropagation()}>
      <label>
        <span>Choice</span>
        <ThemedSelect
          ariaLabel="Test choice"
          value={value}
          onChange={setValue}
          options={[
            { value: "one", label: "One" },
            { value: "two", label: "Two" },
          ]}
        />
      </label>
      <button type="button" data-outside>Outside</button>
    </section>
  );
}

describe("ThemedSelect dismissal", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("closes after selecting an option inside a labelled field", async () => {
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Test choice"]');
    await act(async () => trigger?.click());
    const second = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'))
      .find((option) => option.textContent?.includes("Two"));
    await act(async () => second?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.textContent).toContain("Two");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("closes on outside mouse-down even when a dialog stops propagation", async () => {
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Test choice"]');
    await act(async () => trigger?.click());
    expect(host.querySelector('[role="listbox"]')).not.toBeNull();

    const outside = host.querySelector<HTMLButtonElement>("[data-outside]");
    await act(async () => {
      outside?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });
});
