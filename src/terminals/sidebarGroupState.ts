export function isSidebarGroupDragging(groupId: string | undefined, dragFrom: string | undefined): boolean {
  return Boolean(groupId && dragFrom === groupId);
}
