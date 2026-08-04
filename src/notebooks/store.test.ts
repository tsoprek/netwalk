// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  NOTEBOOKS_STORAGE_KEY,
  NOTEBOOK_BACKUPS_STORAGE_KEY,
  captureTerminalSelection,
  createBook,
  createNote,
  createSection,
  deleteBook,
  deleteNotes,
  loadNotebooks,
  loadLocalNotebookBackups,
  moveNote,
  moveSection,
  moveBook,
  notebookDestinations,
  createNotebookBackupFile,
  parseNotebookBackupFile,
  restoreNotebookBackup,
  updateBook,
  updateBookColor,
  updateNote,
  updateSection,
} from "./store";

beforeEach(() => {
  localStorage.removeItem(NOTEBOOKS_STORAGE_KEY);
  localStorage.removeItem(NOTEBOOK_BACKUPS_STORAGE_KEY);
});

describe("notebook store", () => {
  it("creates, edits, moves, and cascades the book hierarchy", () => {
    const firstBook = createBook("Operations", "#6ea8fe").book;
    const secondBook = createBook("Training", "#63d3a3").book;
    const firstSection = createSection(firstBook.id, "Routers").section!;
    const secondSection = createSection(firstBook.id, "Switches").section!;
    const firstNote = createNote(firstSection.id, "Show commands", "show version").note!;
    const secondNote = createNote(firstSection.id, "Checks", "show clock").note!;

    updateBook(firstBook.id, { title: "Network operations" });
    updateSection(firstSection.id, { title: "IOS routers", color: "#f4c95d" });
    updateNote(firstNote.id, { body: "show version\nshow inventory" });
    moveNote(secondNote.id, secondSection.id);
    moveSection(secondSection.id, secondBook.id);

    const moved = loadNotebooks();
    expect(moved.books.find((book) => book.id === firstBook.id)?.title).toBe("Network operations");
    expect(moved.sections.find((section) => section.id === firstSection.id)).toMatchObject({
      title: "IOS routers",
      color: "#f4c95d",
    });
    expect(moved.notes.find((note) => note.id === firstNote.id)?.body).toContain("show inventory");
    expect(moved.notes.find((note) => note.id === secondNote.id)?.sectionId).toBe(secondSection.id);
    expect(notebookDestinations(moved).find((item) => item.book.id === secondBook.id)?.sections[0].id).toBe(secondSection.id);

    const afterDelete = deleteBook(secondBook.id);
    expect(afterDelete.sections.some((section) => section.id === secondSection.id)).toBe(false);
    expect(afterDelete.notes.some((note) => note.id === secondNote.id)).toBe(false);
    expect(afterDelete.notes.some((note) => note.id === firstNote.id)).toBe(true);
  });

  it("persists deletion tombstones for notes and cascading container deletes", () => {
    const book = createBook("Operations").book;
    const section = createSection(book.id, "Routers").section!;
    const first = createNote(section.id, "First").note!;
    const second = createNote(section.id, "Second").note!;

    const afterNoteDelete = deleteNotes([first.id]);
    expect(afterNoteDelete.notes.map((note) => note.id)).toEqual([second.id]);
    expect(afterNoteDelete.noteTombstones).toEqual([
      expect.objectContaining({ id: first.id, deletedAt: expect.any(Number) }),
    ]);

    const afterSectionDelete = deleteBook(book.id);
    expect(afterSectionDelete.notes).toEqual([]);
    expect(afterSectionDelete.noteTombstones?.map((item) => item.id).sort()).toEqual([
      first.id,
      second.id,
    ].sort());
    expect(loadNotebooks().noteTombstones).toEqual(afterSectionDelete.noteTombstones);
  });

  it("reorders sections to any position including last, and reorders books", () => {
    const book = createBook("Ops").book;
    const a = createSection(book.id, "A").section!;
    const b = createSection(book.id, "B").section!;
    const c = createSection(book.id, "C").section!;

    const sectionOrder = (): string[] =>
      loadNotebooks().sections
        .filter((s) => s.bookId === book.id)
        .sort((x, y) => x.order - y.order)
        .map((s) => s.title);

    expect(sectionOrder()).toEqual(["A", "B", "C"]);

    // Move A to the LAST position (before undefined => append).
    moveSection(a.id, book.id);
    expect(sectionOrder()).toEqual(["B", "C", "A"]);

    // Move C to the front (before B).
    moveSection(c.id, book.id, b.id);
    expect(sectionOrder()).toEqual(["C", "B", "A"]);

    // Reorder books: move the second book before the first.
    const book2 = createBook("Training").book;
    const bookOrder = (): string[] =>
      loadNotebooks().books.sort((x, y) => x.order - y.order).map((bk) => bk.title);
    expect(bookOrder()).toEqual(["Ops", "Training"]);
    moveBook(book2.id, book.id);
    expect(bookOrder()).toEqual(["Training", "Ops"]);
    // Move it back to last (before undefined => append).
    moveBook(book2.id);
    expect(bookOrder()).toEqual(["Ops", "Training"]);
  });

  it("can apply a book color to every section", () => {
    const book = createBook("Operations", "#6ea8fe").book;
    createSection(book.id, "Routers", "#f4c95d");
    createSection(book.id, "Switches", "#f28b82");

    const updated = updateBookColor(book.id, "#63d3a3", true);
    expect(updated.books.find((item) => item.id === book.id)?.color).toBe("#63d3a3");
    expect(updated.sections.filter((item) => item.bookId === book.id).map((item) => item.color)).toEqual([
      "#63d3a3",
      "#63d3a3",
    ]);
  });

  it("captures selected terminal text as a source-labelled Markdown note", () => {
    const book = createBook("Incident notes").book;
    const section = createSection(book.id, "Case 123").section!;
    const captured = captureTerminalSelection(section.id, "edge-router-1", "show ip route\n10.0.0.0/8\nPORT_CHANNEL_STATE").note!;

    expect(captured.source).toMatchObject({ kind: "terminal", sessionTitle: "edge-router-1" });
    expect(captured.title).toContain("edge-router-1");
    expect(captured.body).toContain("```text");
    expect(captured.body).toContain("show ip route");
    expect(captured.body).toContain("PORT_CHANNEL_STATE");
    expect(loadNotebooks().notes).toHaveLength(1);
  });

  it("removes trailing clipboard newlines from captured code fences", () => {
    const book = createBook("Incident notes").book;
    const section = createSection(book.id, "Case 124").section!;
    const captured = captureTerminalSelection(section.id, "edge-router-2", "show version\r\n\r\n").note!;

    expect(captured.body).toContain("```text\nshow version\n```");
    expect(captured.body).not.toContain("show version\n\n```");
  });

  it("drops malformed and orphaned records when loading synced data", () => {
    localStorage.setItem(NOTEBOOKS_STORAGE_KEY, JSON.stringify({
      version: 1,
      books: [{ id: "book-1", title: "Valid", color: "not-a-color", order: 0 }],
      sections: [
        { id: "section-1", bookId: "book-1", title: "Valid", order: 0 },
        { id: "section-orphan", bookId: "missing", title: "Orphan", order: 1 },
      ],
      notes: [
        { id: "note-1", sectionId: "section-1", title: "Valid", body: "ok", order: 0 },
        { id: "note-orphan", sectionId: "section-orphan", title: "Orphan", body: "bad", order: 1 },
      ],
    }));

    const loaded = loadNotebooks();
    expect(loaded.books).toHaveLength(1);
    expect(loaded.books[0].color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(loaded.sections.map((section) => section.id)).toEqual(["section-1"]);
    expect(loaded.notes.map((note) => note.id)).toEqual(["note-1"]);
  });

  it("normalizes book sharing and preserves private defaults", () => {
    const privateBook = createBook("Private").book;
    expect(privateBook.sharing).toEqual({ scope: "private", users: [], access: "read" });

    const shared = updateBook(privateBook.id, {
      sharing: { scope: "users", users: [" User1 ", "USER1", "user2"], access: "write" },
    });
    expect(shared.books[0].sharing).toEqual({ scope: "users", users: ["user1", "user2"], access: "write" });
  });

  it("keeps automatic local snapshots and restores an exported backup", () => {
    const book = createBook("Operations").book;
    const section = createSection(book.id, "Routers").section!;
    createNote(section.id, "Commands", "show version");
    const file = createNotebookBackupFile();

    deleteBook(book.id);
    expect(loadNotebooks().books).toHaveLength(0);
    expect(loadLocalNotebookBackups().some((backup) => backup.store.notes[0]?.body === "show version")).toBe(true);

    const parsed = parseNotebookBackupFile(JSON.stringify(file));
    restoreNotebookBackup(parsed.store);
    expect(loadNotebooks().books[0].title).toBe("Operations");
    expect(loadNotebooks().notes[0].body).toBe("show version");
  });

  it("rejects malformed backup files", () => {
    expect(() => parseNotebookBackupFile("not json")).toThrow("valid JSON");
    expect(() => parseNotebookBackupFile(JSON.stringify({ books: [] }))).toThrow("supported ConnCat");
  });
});
