export type SftpSortKey = "name" | "size" | "mtime";
export type SftpSortDirection = "asc" | "desc";

export interface SortableSftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mtime?: number | null;
}

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function filterAndSortSftpEntries<T extends SortableSftpEntry>(
  entries: T[],
  query: string,
  caseSensitive: boolean,
  sortKey: SftpSortKey,
  direction: SftpSortDirection,
): T[] {
  const needle = query.trim();
  const filtered = needle
    ? entries.filter((entry) => caseSensitive
      ? entry.name.includes(needle)
      : entry.name.toLocaleLowerCase().includes(needle.toLocaleLowerCase()))
    : entries;

  return [...filtered].sort((left, right) => {
    if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;

    let comparison = 0;
    if (sortKey === "name") {
      comparison = nameCollator.compare(left.name, right.name);
    } else if (sortKey === "size") {
      comparison = left.size - right.size;
    } else {
      const leftTime = left.mtime ?? null;
      const rightTime = right.mtime ?? null;
      if (leftTime == null && rightTime != null) return 1;
      if (leftTime != null && rightTime == null) return -1;
      comparison = (leftTime ?? 0) - (rightTime ?? 0);
    }

    if (comparison === 0) comparison = nameCollator.compare(left.name, right.name);
    return direction === "asc" ? comparison : -comparison;
  });
}
