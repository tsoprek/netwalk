import { describe, expect, it } from "vitest";
import { isSidebarGroupDragging } from "./sidebarGroupState";

describe("terminal sidebar group drag state", () => {
  it("does not dim the ungrouped section when no drag is active", () => {
    expect(isSidebarGroupDragging(undefined, undefined)).toBe(false);
  });

  it("dims only the group currently being dragged", () => {
    expect(isSidebarGroupDragging("group-a", "group-a")).toBe(true);
    expect(isSidebarGroupDragging("group-a", "group-b")).toBe(false);
  });
});
