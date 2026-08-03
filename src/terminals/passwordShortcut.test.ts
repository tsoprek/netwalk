import { describe, expect, it } from "vitest";
import {
  matchesTerminalPasswordShortcut,
  onePasswordShortcutLabel,
} from "./passwordShortcut";

describe("terminal configured-password shortcut", () => {
  it("matches Ctrl/Cmd+Shift+P", () => {
    expect(matchesTerminalPasswordShortcut({ key: "P", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(matchesTerminalPasswordShortcut({ key: "p", metaKey: true, shiftKey: true })).toBe(true);
  });

  it("does not steal normal shell or alternate shortcuts", () => {
    expect(matchesTerminalPasswordShortcut({ key: "p", ctrlKey: true })).toBe(false);
    expect(matchesTerminalPasswordShortcut({ key: "p", ctrlKey: true, shiftKey: true, altKey: true })).toBe(false);
    expect(matchesTerminalPasswordShortcut({ key: "n", ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it("supports the configured Ctrl/Cmd+Alt/Option+P shortcut", () => {
    expect(matchesTerminalPasswordShortcut(
      { key: "p", ctrlKey: true, altKey: true },
      "primaryAltP",
    )).toBe(true);
    expect(matchesTerminalPasswordShortcut(
      { key: "P", metaKey: true, altKey: true },
      "primaryAltP",
    )).toBe(true);
    expect(matchesTerminalPasswordShortcut(
      { key: "p", ctrlKey: true, shiftKey: true },
      "primaryAltP",
    )).toBe(false);
  });

  it("can be disabled and formats platform-specific labels", () => {
    expect(matchesTerminalPasswordShortcut(
      { key: "p", ctrlKey: true, shiftKey: true },
      "disabled",
    )).toBe(false);
    expect(onePasswordShortcutLabel("primaryAltP", true)).toBe("⌘⌥P");
    expect(onePasswordShortcutLabel("primaryAltP", false)).toBe("Ctrl+Alt+P");
  });
});
