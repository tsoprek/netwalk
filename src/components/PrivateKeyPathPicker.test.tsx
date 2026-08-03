// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import PrivateKeyPathPicker from "./PrivateKeyPathPicker";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PrivateKeyPathPicker", () => {
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

  it("hides the path input until a private key is configured", () => {
    act(() => {
      root.render(
        <PrivateKeyPathPicker
          value=""
          inheritedPath="~/.ssh/id_rsa"
          onChange={() => {}}
        />,
      );
    });

    expect(host.querySelector('input[aria-label="Configured private key path"]')).toBeNull();
    expect(host.textContent).toContain("Choose");
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Clear private key path"]')?.disabled,
    ).toBe(true);
  });

  it("shows the configured path with Choose and Clear actions underneath", async () => {
    vi.mocked(open).mockResolvedValue("/keys/replacement");
    const onChange = vi.fn();
    act(() => {
      root.render(
        <PrivateKeyPathPicker
          value="/keys/current"
          inheritedPath="~/.ssh/id_rsa"
          onChange={onChange}
        />,
      );
    });

    expect((host.querySelector('input[aria-label="Configured private key path"]') as HTMLInputElement).value)
      .toBe("/keys/current");
    const actions = host.querySelector(".private-key-path-picker__actions");
    expect(actions?.querySelector('[aria-label="Choose a different private key"]')).not.toBeNull();
    expect(actions?.querySelector('[aria-label="Clear private key path"]')).not.toBeNull();

    const choose = actions?.querySelector<HTMLButtonElement>(
      '[aria-label="Choose a different private key"]',
    );
    await act(async () => choose?.click());
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "/keys/current",
    }));
    expect(onChange).toHaveBeenCalledWith("/keys/replacement");
  });
});
