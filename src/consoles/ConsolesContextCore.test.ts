import { describe, expect, it, vi } from "vitest";
import { destroyConsoleTabOnce, type ConsoleTab } from "./ConsolesContextCore";

function fakeTab(): ConsoleTab {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return {
    id: 1,
    kind: "cml",
    title: "test",
    host,
    status: "",
    error: "",
    disconnected: false,
    reconnect: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("console lifecycle cleanup", () => {
  it("destroys and detaches an owned console exactly once", () => {
    const tab = fakeTab();
    const destroyed = new WeakSet<ConsoleTab>();

    expect(destroyConsoleTabOnce(tab, destroyed)).toBe(true);
    expect(destroyConsoleTabOnce(tab, destroyed)).toBe(false);
    expect(tab.destroy).toHaveBeenCalledOnce();
    expect(tab.host.isConnected).toBe(false);
  });

  it("still detaches the host when engine destruction throws", () => {
    const tab = fakeTab();
    tab.destroy = vi.fn(() => { throw new Error("already stopped"); });

    expect(destroyConsoleTabOnce(tab, new WeakSet())).toBe(true);
    expect(tab.host.isConnected).toBe(false);
  });
});
