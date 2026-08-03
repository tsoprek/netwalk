import { describe, expect, it } from "vitest";
import {
  claimTerminalTransfer,
  hasExplicitTerminalDropZone,
} from "./terminalTransfer";

describe("terminal window transfer guards", () => {
  it("allows only one concurrent consumer for a transfer token", () => {
    const active = new Set<string>();
    const release = claimTerminalTransfer(active, "one-drop");

    expect(release).not.toBeNull();
    expect(claimTerminalTransfer(active, "one-drop")).toBeNull();

    release?.();
    expect(claimTerminalTransfer(active, "one-drop")).not.toBeNull();
  });

  it("leaves tab strips and the empty-terminal drop zone to their React handlers", () => {
    const empty = document.createElement("div");
    empty.className = "terminals-empty";
    const child = document.createElement("span");
    empty.appendChild(child);
    const unrelated = document.createElement("main");

    expect(hasExplicitTerminalDropZone(child)).toBe(true);
    expect(hasExplicitTerminalDropZone(unrelated)).toBe(false);
  });
});
