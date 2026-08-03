import type { MosaicDirection, MosaicNode } from "react-mosaic-component";

export type TerminalWorkspaceArrange = "row" | "column" | "grid";

type ParentNode = {
  direction: MosaicDirection;
  first: MosaicNode<number>;
  second: MosaicNode<number>;
  splitPercentage?: number;
};

function isParent(node: MosaicNode<number>): node is ParentNode {
  return typeof node === "object" && node !== null && "direction" in node;
}

function contains(node: MosaicNode<number>, id: number): boolean {
  if (!isParent(node)) return node === id;
  return contains(node.first, id) || contains(node.second, id);
}

export function firstTerminalPane(node: MosaicNode<number>): number {
  return isParent(node) ? firstTerminalPane(node.first) : node;
}

export function isMultiPaneLayout(layout: MosaicNode<number> | null): boolean {
  return layout != null && isParent(layout);
}

export function terminalWorkspaceIds(layout: MosaicNode<number> | null): number[] {
  if (layout == null) return [];
  if (!isParent(layout)) return [layout];
  return [
    ...terminalWorkspaceIds(layout.first),
    ...terminalWorkspaceIds(layout.second),
  ];
}

function replaceTerminalWorkspaceIds(
  layout: MosaicNode<number>,
  ids: number[],
  index: { value: number },
): MosaicNode<number> {
  if (!isParent(layout)) {
    const replacement = ids[index.value];
    index.value += 1;
    return replacement;
  }
  return {
    ...layout,
    first: replaceTerminalWorkspaceIds(layout.first, ids, index),
    second: replaceTerminalWorkspaceIds(layout.second, ids, index),
  };
}

/** Reorder pane identities without changing the split tree's geometry. */
export function reorderTerminalWorkspace(
  layout: MosaicNode<number> | null,
  draggedId: number,
  targetId: number,
  placement: "before" | "after" = "before",
): MosaicNode<number> | null {
  if (layout == null || draggedId === targetId) return layout;
  const ids = terminalWorkspaceIds(layout);
  const draggedIndex = ids.indexOf(draggedId);
  if (draggedIndex < 0 || !ids.includes(targetId)) return layout;
  const nextIds = [...ids];
  nextIds.splice(draggedIndex, 1);
  const targetIndex = nextIds.indexOf(targetId);
  nextIds.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, draggedId);
  return replaceTerminalWorkspaceIds(layout, nextIds, { value: 0 });
}

function buildLinearLayout(
  nodes: Array<MosaicNode<number>>,
  direction: MosaicDirection,
): MosaicNode<number> {
  if (nodes.length === 0) throw new Error("buildLinearLayout: empty nodes");
  if (nodes.length === 1) return nodes[0];
  let node: MosaicNode<number> = nodes[nodes.length - 1];
  for (let index = nodes.length - 2; index >= 0; index -= 1) {
    const remaining = nodes.length - index;
    node = {
      direction,
      first: nodes[index],
      second: node,
      splitPercentage: 100 / remaining,
    };
  }
  return node;
}

/** Build a complete row, column, or balanced-grid split workspace. */
export function arrangeTerminalWorkspace(
  ids: number[],
  mode: TerminalWorkspaceArrange,
): MosaicNode<number> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) throw new Error("arrangeTerminalWorkspace: empty ids");
  if (mode === "row" || mode === "column") {
    return buildLinearLayout(uniqueIds, mode);
  }
  const columns = Math.ceil(Math.sqrt(uniqueIds.length));
  const rows = Math.ceil(uniqueIds.length / columns);
  const columnLayouts: Array<MosaicNode<number>> = [];
  for (let column = 0; column < columns; column += 1) {
    const columnIds = uniqueIds.slice(column * rows, (column + 1) * rows);
    if (columnIds.length > 0) {
      columnLayouts.push(buildLinearLayout(columnIds, "column"));
    }
  }
  return buildLinearLayout(columnLayouts, "row");
}

export interface TerminalWorkspaceSelection {
  layout: MosaicNode<number>;
  splitLayout: MosaicNode<number> | null;
}

/**
 * Select tabs around a remembered split workspace. Non-member tabs open by
 * themselves; selecting a split member restores the complete workspace.
 */
export function selectTerminalWorkspace(
  layout: MosaicNode<number> | null,
  splitLayout: MosaicNode<number> | null,
  tabId: number,
): TerminalWorkspaceSelection {
  if (splitLayout != null && contains(splitLayout, tabId)) {
    return { layout: splitLayout, splitLayout };
  }
  if (layout != null && isParent(layout) && !contains(layout, tabId)) {
    return { layout: tabId, splitLayout: layout };
  }
  if (layout != null && contains(layout, tabId)) {
    return { layout, splitLayout };
  }
  return { layout: tabId, splitLayout };
}
