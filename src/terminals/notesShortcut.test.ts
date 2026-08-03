import { describe, expect, it } from "vitest";
import { matchesTerminalNotesShortcut, matchesTerminalSelectAllShortcut } from "./notesShortcut";

describe("terminal Notes shortcut", () => {
  it("matches Ctrl/Cmd+Shift+N without stealing plain N", () => {
    expect(matchesTerminalNotesShortcut({ key: "N", ctrlKey: true, shiftKey: true }, "primaryShiftN")).toBe(true);
    expect(matchesTerminalNotesShortcut({ key: "n", metaKey: true, shiftKey: true }, "primaryShiftN")).toBe(true);
    expect(matchesTerminalNotesShortcut({ key: "n" }, "primaryShiftN")).toBe(false);
  });

  it("supports the alternate mapping and disabled state", () => {
    expect(matchesTerminalNotesShortcut({ key: "n", ctrlKey: true, altKey: true }, "primaryAltN")).toBe(true);
    expect(matchesTerminalNotesShortcut({ key: "n", ctrlKey: true, shiftKey: true }, "primaryAltN")).toBe(false);
    expect(matchesTerminalNotesShortcut({ key: "n", ctrlKey: true, shiftKey: true }, "disabled")).toBe(false);
  });

  it("recognizes Ctrl/Cmd+A as terminal select-all", () => {
    expect(matchesTerminalSelectAllShortcut({ key: "a", ctrlKey: true })).toBe(true);
    expect(matchesTerminalSelectAllShortcut({ key: "a", metaKey: true })).toBe(true);
    expect(matchesTerminalSelectAllShortcut({ key: "a", ctrlKey: true, shiftKey: true })).toBe(false);
  });
});
