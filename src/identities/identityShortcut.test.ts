import { describe, expect, it } from "vitest";
import { matchesIdentitiesShortcut } from "./identityShortcut";

describe("Identities shortcut", () => {
  it("matches Ctrl/Cmd+Shift+I without stealing plain I", () => {
    expect(matchesIdentitiesShortcut({ key: "I", ctrlKey: true, shiftKey: true }, "primaryShiftI")).toBe(true);
    expect(matchesIdentitiesShortcut({ key: "i", metaKey: true, shiftKey: true }, "primaryShiftI")).toBe(true);
    expect(matchesIdentitiesShortcut({ key: "i" }, "primaryShiftI")).toBe(false);
  });

  it("supports the alternate mapping and disabled state", () => {
    expect(matchesIdentitiesShortcut({ key: "i", ctrlKey: true, altKey: true }, "primaryAltI")).toBe(true);
    expect(matchesIdentitiesShortcut({ key: "i", ctrlKey: true, shiftKey: true }, "primaryAltI")).toBe(false);
    expect(matchesIdentitiesShortcut({ key: "i", ctrlKey: true, shiftKey: true }, "disabled")).toBe(false);
  });
});
