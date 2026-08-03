// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import VmPowerControls from "./VmPowerControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  document.querySelectorAll(".context-menu").forEach((menu) => menu.parentElement?.remove());
  root = null;
  host = null;
});

function render(style: "current" | "outline" | "segmented" | "primaryDropdown", powerState = "POWERED_ON") {
  const onAction = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <VmPowerControls
        style={style}
        density="list"
        busy={false}
        powerState={powerState}
        onAction={onAction}
      />,
    );
  });
  return onAction;
}

describe("VmPowerControls", () => {
  it.each(["current", "outline", "segmented"] as const)("renders every action in the %s style", (style) => {
    const onAction = render(style);
    const buttons = host!.querySelectorAll("button");

    expect(buttons).toHaveLength(5);
    act(() => buttons[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onAction).toHaveBeenCalledWith("reboot", undefined);
  });

  it("uses Power on as the primary action for a powered-off VM", () => {
    const onAction = render("primaryDropdown", "POWERED_OFF");
    const primary = host!.querySelector(".vm-power-controls__primary") as HTMLButtonElement;

    expect(primary.textContent).toContain("Power on");
    act(() => primary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(onAction).toHaveBeenCalledWith("start", undefined);
  });

  it("uses Power on for AutoPilot's compact off state", () => {
    render("primaryDropdown", "off");
    const primary = host!.querySelector(".vm-power-controls__primary") as HTMLButtonElement;

    expect(primary.textContent).toContain("Power on");
  });

  it("keeps the remaining actions in the themed dropdown", async () => {
    const onAction = render("primaryDropdown", "POWERED_ON");
    const trigger = host!.querySelector(".vm-power-controls__menu-trigger") as HTMLButtonElement;
    act(() => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    const reset = [...document.querySelectorAll<HTMLButtonElement>(".context-menu__item")]
      .find((button) => button.textContent?.includes("Reset (hard)"));
    expect(document.querySelector(".context-menu--select")).not.toBeNull();
    expect(reset).toBeDefined();
    await act(async () => {
      reset!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(onAction).toHaveBeenCalledWith("reset", "Reset");
  });
});
