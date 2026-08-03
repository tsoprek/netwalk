import { describe, expect, it } from "vitest";
import { filterAndSortSftpEntries } from "./entryView";

const entries = [
  { name: "file10.log", path: "/file10.log", is_dir: false, size: 10, mtime: 100 },
  { name: "Folder", path: "/Folder", is_dir: true, size: 0, mtime: 50 },
  { name: "file2.log", path: "/file2.log", is_dir: false, size: 200, mtime: 200 },
  { name: "README", path: "/README", is_dir: false, size: 20, mtime: null },
];

describe("filterAndSortSftpEntries", () => {
  it("sorts names naturally while keeping folders first", () => {
    expect(filterAndSortSftpEntries(entries, "", false, "name", "asc").map((e) => e.name))
      .toEqual(["Folder", "file2.log", "file10.log", "README"]);
  });

  it("sorts file sizes in either direction", () => {
    expect(filterAndSortSftpEntries(entries, "", false, "size", "desc").map((e) => e.name))
      .toEqual(["Folder", "file2.log", "README", "file10.log"]);
  });

  it("keeps unknown modified dates last", () => {
    expect(filterAndSortSftpEntries(entries, "", false, "mtime", "desc").map((e) => e.name))
      .toEqual(["Folder", "file2.log", "file10.log", "README"]);
  });

  it("filters names with optional case sensitivity", () => {
    expect(filterAndSortSftpEntries(entries, "read", false, "name", "asc").map((e) => e.name))
      .toEqual(["README"]);
    expect(filterAndSortSftpEntries(entries, "read", true, "name", "asc"))
      .toEqual([]);
  });
});
