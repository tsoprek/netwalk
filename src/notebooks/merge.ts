import type {
  NotebookBook,
  NotebookNote,
  NotebookNoteTombstone,
  NotebookSection,
  NotebookStore,
} from "./store";

type NotebookEntity = NotebookBook | NotebookSection | NotebookNote;

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function byId<T extends NotebookEntity>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function newest<T extends NotebookEntity>(left: T, right: T): T {
  return left.updatedAt >= right.updatedAt ? left : right;
}

function mergeContainers<T extends NotebookBook | NotebookSection>(
  baseItems: T[],
  localItems: T[],
  remoteItems: T[],
): T[] {
  const base = byId(baseItems);
  const local = byId(localItems);
  const remote = byId(remoteItems);
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const result: T[] = [];

  for (const id of ids) {
    const before = base.get(id);
    const here = local.get(id);
    const there = remote.get(id);
    if (!before) {
      if (here && there) result.push(same(here, there) ? here : newest(here, there));
      else if (here) result.push(here);
      else if (there) result.push(there);
      continue;
    }

    const localChanged = !same(here, before);
    const remoteChanged = !same(there, before);
    if (!localChanged && !remoteChanged) result.push(before);
    else if (localChanged && !remoteChanged) { if (here) result.push(here); }
    else if (!localChanged && remoteChanged) { if (there) result.push(there); }
    else if (here && there) result.push(same(here, there) ? here : newest(here, there));
    else if (here) result.push(here); // Preserve an edit when the other side deleted it.
    else if (there) result.push(there);
  }
  return result;
}

function conflictNote(note: NotebookNote, occupied: Set<string>): NotebookNote {
  const stem = `${note.id}-conflict-${note.updatedAt}`;
  let id = stem;
  let suffix = 2;
  while (occupied.has(id)) id = `${stem}-${suffix++}`;
  occupied.add(id);
  const label = " (Conflict copy)";
  const title = `${note.title.slice(0, Math.max(0, 160 - label.length))}${label}`;
  return { ...note, id, title };
}

function mergeNotes(baseItems: NotebookNote[], localItems: NotebookNote[], remoteItems: NotebookNote[]): NotebookNote[] {
  const base = byId(baseItems);
  const local = byId(localItems);
  const remote = byId(remoteItems);
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const occupied = new Set(ids);
  const result: NotebookNote[] = [];

  for (const id of ids) {
    const before = base.get(id);
    const here = local.get(id);
    const there = remote.get(id);
    if (!before) {
      if (here && there) {
        result.push(there);
        if (!same(here, there)) result.push(conflictNote(here, occupied));
      } else if (here) result.push(here);
      else if (there) result.push(there);
      continue;
    }

    const localChanged = !same(here, before);
    const remoteChanged = !same(there, before);
    if (!localChanged && !remoteChanged) result.push(before);
    else if (localChanged && !remoteChanged) { if (here) result.push(here); }
    else if (!localChanged && remoteChanged) { if (there) result.push(there); }
    else if (here && there) {
      result.push(there);
      if (!same(here, there)) result.push(conflictNote(here, occupied));
    } else if (here) result.push(here);
    else if (there) result.push(there);
  }
  return result;
}

function mergeNoteTombstones(
  baseItems: NotebookNoteTombstone[] = [],
  localItems: NotebookNoteTombstone[] = [],
  remoteItems: NotebookNoteTombstone[] = [],
): NotebookNoteTombstone[] {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const local = new Map(localItems.map((item) => [item.id, item]));
  const remote = new Map(remoteItems.map((item) => [item.id, item]));
  const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const result: NotebookNoteTombstone[] = [];

  for (const id of ids) {
    const before = base.get(id);
    const here = local.get(id);
    const there = remote.get(id);
    if (!before) {
      if (here && there) result.push(here.deletedAt >= there.deletedAt ? here : there);
      else if (here) result.push(here);
      else if (there) result.push(there);
      continue;
    }

    const localChanged = !same(here, before);
    const remoteChanged = !same(there, before);
    if (!localChanged && !remoteChanged) result.push(before);
    else if (localChanged && !remoteChanged) { if (here) result.push(here); }
    else if (!localChanged && remoteChanged) { if (there) result.push(there); }
    else if (here && there) result.push(here.deletedAt >= there.deletedAt ? here : there);
    else if (here) result.push(here);
    else if (there) result.push(there);
  }
  return result;
}

function candidateById<T extends NotebookEntity>(id: string, ...groups: T[][]): T | undefined {
  const candidates = groups.flatMap((items) => items.filter((item) => item.id === id));
  return candidates.reduce<T | undefined>((best, item) => best ? newest(best, item) : item, undefined);
}

/** Three-way notebook merge using the last successfully synchronized store as the base. */
export function mergeNotebookStores(base: NotebookStore, local: NotebookStore, remote: NotebookStore): NotebookStore {
  const books = mergeContainers(base.books, local.books, remote.books);
  const sections = mergeContainers(base.sections, local.sections, remote.sections);
  const noteTombstones = mergeNoteTombstones(
    base.noteTombstones,
    local.noteTombstones,
    remote.noteTombstones,
  );
  const deletedNoteIds = new Set(noteTombstones.map((item) => item.id));
  const notes = mergeNotes(base.notes, local.notes, remote.notes)
    .filter((note) => !deletedNoteIds.has(note.id));

  // A delete-vs-edit conflict keeps the edited child. Restore its newest known
  // parent as well so normalization cannot silently discard preserved content.
  const sectionIds = new Set(sections.map((item) => item.id));
  for (const note of notes) {
    if (sectionIds.has(note.sectionId)) continue;
    const section = candidateById(note.sectionId, local.sections, remote.sections, base.sections);
    if (section) { sections.push(section); sectionIds.add(section.id); }
  }
  const bookIds = new Set(books.map((item) => item.id));
  for (const section of sections) {
    if (bookIds.has(section.bookId)) continue;
    const book = candidateById(section.bookId, local.books, remote.books, base.books);
    if (book) { books.push(book); bookIds.add(book.id); }
  }

  return {
    version: 1,
    books,
    sections,
    notes,
    ...(noteTombstones.length > 0 ? { noteTombstones } : {}),
  };
}
