import { describe, expect, it } from "vitest";
import {
  cycleMainNavigationPath,
  matchesMainNavigationShortcut,
} from "./mainNavigation";

describe("main navigation cycling", () => {
  it("reserves Control+Tab but leaves plain Tab available to xterm", () => {
    expect(matchesMainNavigationShortcut({ key: "Tab" })).toBe(false);
    expect(matchesMainNavigationShortcut({ key: "Tab", shiftKey: true })).toBe(false);
    expect(matchesMainNavigationShortcut({ key: "Tab", ctrlKey: true })).toBe(true);
    expect(matchesMainNavigationShortcut({ key: "Tab", ctrlKey: true, metaKey: true })).toBe(false);
  });

  it("moves forward and backward in visible navigation order", () => {
    expect(cycleMainNavigationPath("/connections", false)).toBe("/sessions");
    expect(cycleMainNavigationPath("/sessions", true)).toBe("/connections");
  });

  it("recognizes nested routes as their parent section", () => {
    expect(cycleMainNavigationPath("/connections/123", false)).toBe("/sessions");
  });

  it("wraps in both directions", () => {
    expect(cycleMainNavigationPath("/settings", false)).toBe("/connections");
    expect(cycleMainNavigationPath("/connections", true)).toBe("/settings");
  });
});
