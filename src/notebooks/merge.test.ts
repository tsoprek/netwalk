import { describe, expect, it } from "vitest";
import type { NotebookStore } from "./store";
import { mergeNotebookStores } from "./merge";

function store(body = "base"): NotebookStore {
  return {
    version: 1,
    books: [{ id: "book-1", title: "Book", color: "#6ea8fe", order: 0, createdAt: 1, updatedAt: 1, sharing: { scope: "private", users: [], access: "read" } }],
    sections: [{ id: "section-1", bookId: "book-1", title: "Section", color: "#6ea8fe", order: 0, createdAt: 1, updatedAt: 1 }],
    notes: [{ id: "note-1", sectionId: "section-1", title: "Note", body, order: 0, createdAt: 1, updatedAt: 1 }],
  };
}

describe("three-way notebook merge", () => {
  it("combines independent offline and server notes", () => {
    const base = store();
    const local = structuredClone(base);
    local.notes.push({ id: "note-local", sectionId: "section-1", title: "Offline", body: "local", order: 1, createdAt: 2, updatedAt: 2 });
    const remote = structuredClone(base);
    remote.notes.push({ id: "note-remote", sectionId: "section-1", title: "Server", body: "remote", order: 1, createdAt: 3, updatedAt: 3 });

    expect(mergeNotebookStores(base, local, remote).notes.map((note) => note.id)).toEqual([
      "note-1", "note-local", "note-remote",
    ]);
  });

  it("retains both versions when the same note changed on both sides", () => {
    const base = store();
    const local = store("offline edit");
    local.notes[0].updatedAt = 2;
    const remote = store("server edit");
    remote.notes[0].updatedAt = 3;

    const notes = mergeNotebookStores(base, local, remote).notes;
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ id: "note-1", body: "server edit" });
    expect(notes[1]).toMatchObject({ body: "offline edit", title: "Note (Conflict copy)" });
    expect(notes[1].id).toContain("note-1-conflict-2");
  });

  it("propagates a local deletion when the server item is unchanged", () => {
    const base = store();
    const local = store();
    local.notes = [];

    expect(mergeNotebookStores(base, local, store()).notes).toEqual([]);
  });

  it("does not resurrect a tombstoned note when the server copy changed", () => {
    const base = store();
    const local = store();
    local.notes = [];
    local.noteTombstones = [{ id: "note-1", deletedAt: 5 }];
    const remote = store("late server autosave");
    remote.notes[0].updatedAt = 4;

    const merged = mergeNotebookStores(base, local, remote);
    expect(merged.notes).toEqual([]);
    expect(merged.noteTombstones).toEqual([{ id: "note-1", deletedAt: 5 }]);
  });

  it("allows an explicit backup restore to remove a synchronized tombstone", () => {
    const base = store();
    base.notes = [];
    base.noteTombstones = [{ id: "note-1", deletedAt: 5 }];
    const local = store("restored from backup");
    local.notes[0].updatedAt = 6;
    const remote = structuredClone(base);

    const merged = mergeNotebookStores(base, local, remote);
    expect(merged.notes).toHaveLength(1);
    expect(merged.notes[0].body).toBe("restored from backup");
    expect(merged.noteTombstones).toBeUndefined();
  });

  it("preserves an edited note and its parents across a delete-vs-edit conflict", () => {
    const base = store();
    const local: NotebookStore = { version: 1, books: [], sections: [], notes: [] };
    const remote = store("server edit");
    remote.notes[0].updatedAt = 4;

    const merged = mergeNotebookStores(base, local, remote);
    expect(merged.books).toHaveLength(1);
    expect(merged.sections).toHaveLength(1);
    expect(merged.notes[0].body).toBe("server edit");
  });
});
