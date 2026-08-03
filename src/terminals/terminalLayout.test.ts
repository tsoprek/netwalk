import { describe, expect, it } from "vitest";
import type { MosaicNode } from "react-mosaic-component";
import {
  arrangeTerminalWorkspace,
  firstTerminalPane,
  reorderTerminalWorkspace,
  selectTerminalWorkspace,
  terminalWorkspaceIds,
} from "./terminalLayout";

describe("terminal workspace selection", () => {
  it("reorders pane identities while preserving split geometry", () => {
    const layout: MosaicNode<number> = {
      direction: "row",
      splitPercentage: 40,
      first: 1,
      second: { direction: "column", splitPercentage: 60, first: 2, second: 3 },
    };

    expect(reorderTerminalWorkspace(layout, 3, 1, "before")).toEqual({
      direction: "row",
      splitPercentage: 40,
      first: 3,
      second: { direction: "column", splitPercentage: 60, first: 1, second: 2 },
    });
  });
  it("builds row, column, and balanced grid workspaces", () => {
    const row = arrangeTerminalWorkspace([1, 2, 3, 4], "row");
    const column = arrangeTerminalWorkspace([1, 2, 3, 4], "column");
    const grid = arrangeTerminalWorkspace([1, 2, 3, 4], "grid");

    expect(row).toMatchObject({ direction: "row" });
    expect(column).toMatchObject({ direction: "column" });
    expect(grid).toMatchObject({
      direction: "row",
      first: { direction: "column" },
      second: { direction: "column" },
    });
    expect(terminalWorkspaceIds(grid)).toEqual([1, 2, 3, 4]);
  });

  it("chooses a deterministic surviving pane after the active pane is removed", () => {
    const remaining: MosaicNode<number> = { direction: "column", first: 2, second: 3 };
    expect(firstTerminalPane(remaining)).toBe(2);
  });

  it("opens a non-member tab alone without destroying the split workspace", () => {
    const split: MosaicNode<number> = { direction: "row", first: 1, second: 2 };
    expect(selectTerminalWorkspace(split, split, 3)).toEqual({
      layout: 3,
      splitLayout: split,
    });
  });

  it("opens a new session as a tab without replacing the top-left group-grid pane", () => {
    const groupGrid = arrangeTerminalWorkspace([1, 2, 3, 4], "grid");
    const opened = selectTerminalWorkspace(groupGrid, groupGrid, 5);

    expect(opened.layout).toBe(5);
    expect(terminalWorkspaceIds(opened.splitLayout)).toEqual([1, 2, 3, 4]);

    const restored = selectTerminalWorkspace(
      opened.layout,
      opened.splitLayout,
      1,
    );
    expect(terminalWorkspaceIds(restored.layout)).toEqual([1, 2, 3, 4]);
  });

  it("restores the whole split workspace when a member tab is selected", () => {
    const split: MosaicNode<number> = { direction: "row", first: 1, second: 2 };
    expect(selectTerminalWorkspace(3, split, 2)).toEqual({
      layout: split,
      splitLayout: split,
    });
  });

  it("does not replace either pane while switching between a removed tab and its former split", () => {
    // This is the state after pane 2 is removed from a three-pane workspace.
    const remainingSplit: MosaicNode<number> = { direction: "row", first: 1, second: 3 };

    const removedTab = selectTerminalWorkspace(remainingSplit, remainingSplit, 2);
    expect(removedTab).toEqual({ layout: 2, splitLayout: remainingSplit });

    const restoredFromLeft = selectTerminalWorkspace(
      removedTab.layout,
      removedTab.splitLayout,
      1,
    );
    expect(restoredFromLeft).toEqual({
      layout: remainingSplit,
      splitLayout: remainingSplit,
    });

    const unrelatedTab = selectTerminalWorkspace(
      restoredFromLeft.layout,
      restoredFromLeft.splitLayout,
      4,
    );
    expect(unrelatedTab).toEqual({ layout: 4, splitLayout: remainingSplit });
  });
});
