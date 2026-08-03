import { describe, expect, it } from "vitest";
import { sessionTabShortcut, sessionTabShortcutTarget } from "./sessionTabNavigation";

describe("session tab navigation", () => {
  it("recognizes fixed previous, next, and numbered tab shortcuts", () => {
    expect(sessionTabShortcut({ key: "PageUp", ctrlKey: true })).toEqual({ kind: "relative", offset: -1 });
    expect(sessionTabShortcut({ key: "PageDown", ctrlKey: true })).toEqual({ kind: "relative", offset: 1 });
    expect(sessionTabShortcut({ key: "1", ctrlKey: true })).toEqual({ kind: "index", index: 0 });
    expect(sessionTabShortcut({ key: "9", ctrlKey: true })).toEqual({ kind: "index", index: 8 });
  });

  it("does not steal workspace navigation or modified key combinations", () => {
    expect(sessionTabShortcut({ key: "Tab", ctrlKey: true })).toBeNull();
    expect(sessionTabShortcut({ key: "PageDown", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(sessionTabShortcut({ key: "2", metaKey: true })).toBeNull();
  });

  it("wraps relative navigation and ignores unavailable tab numbers", () => {
    const tabs = [11, 22, 33];
    expect(sessionTabShortcutTarget(tabs, 11, { kind: "relative", offset: -1 })).toBe(33);
    expect(sessionTabShortcutTarget(tabs, 33, { kind: "relative", offset: 1 })).toBe(11);
    expect(sessionTabShortcutTarget(tabs, 22, { kind: "index", index: 2 })).toBe(33);
    expect(sessionTabShortcutTarget(tabs, 22, { kind: "index", index: 8 })).toBeNull();
  });
});
