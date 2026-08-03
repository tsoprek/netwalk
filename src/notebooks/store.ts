import { normalizeConsoleText } from "../utils/consoleText";

export const NOTEBOOKS_STORAGE_KEY = "connecat.notebooks";
export const NOTEBOOK_BACKUPS_STORAGE_KEY = "connecat.notebooks.localBackups";
export const NOTEBOOK_SYNC_BASE_STORAGE_KEY = "connecat.notebooks.syncBase";
export const NOTEBOOK_PENDING_SYNC_STORAGE_KEY = "connecat.notebooks.pendingSync";
export const NOTEBOOKS_CHANGED_EVENT = "connecat:notebooks-changed";
export const MAX_TERMINAL_CAPTURE_CHARS = 200_000;
export const MAX_LOCAL_NOTEBOOK_BACKUPS = 20;
export const LOCAL_NOTEBOOK_BACKUP_INTERVAL_MS = 5 * 60 * 1000;

export const NOTEBOOK_COLORS = [
  "#6ea8fe",
  "#63d3a3",
  "#f4c95d",
  "#f28b82",
  "#c99cff",
  "#67d4e8",
  "#ff9f68",
  "#a7c957",
  "#ff7aa2",
  "#8fbcff",
  "#52c7a5",
  "#f6a85f",
  "#b7a0ff",
  "#6fcf6a",
  "#e58bc3",
  "#9ca8b8",
];

export interface NotebookBook {
  id: string;
  title: string;
  color: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  sharing: NotebookSharing;
}

export interface NotebookSharing {
  scope: "private" | "everyone" | "users";
  users: string[];
  access: "read" | "write";
}

export interface NotebookSection {
  id: string;
  bookId: string;
  title: string;
  color: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookNoteSource {
  kind: "terminal";
  sessionTitle: string;
  capturedAt: number;
}

export interface NotebookNote {
  id: string;
  sectionId: string;
  title: string;
  body: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  source?: NotebookNoteSource;
}

export interface NotebookNoteTombstone {
  id: string;
  deletedAt: number;
}

export interface NotebookStore {
  version: 1;
  books: NotebookBook[];
  sections: NotebookSection[];
  notes: NotebookNote[];
  /// Synced deletion markers prevent an older portal snapshot from restoring
  /// notes that were intentionally removed on this or another device.
  noteTombstones?: NotebookNoteTombstone[];
}

export interface LocalNotebookBackup {
  createdAt: number;
  store: NotebookStore;
}

export interface NotebookBackupFile extends LocalNotebookBackup {
  format: "catwalk-notebooks-backup";
  backupVersion: 1;
}

export interface NotebookDestination {
  book: NotebookBook;
  sections: NotebookSection[];
}

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function cleanTitle(value: unknown, fallback: string): string {
  const title = String(value ?? "").trim().slice(0, 160);
  return title || fallback;
}

function cleanColor(value: unknown, fallback: string): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function cleanOrder(value: unknown, fallback: number): number {
  const order = Number(value);
  return Number.isFinite(order) ? order : fallback;
}

function cleanSharing(value: unknown): NotebookSharing {
  if (!value || typeof value !== "object") return { scope: "private", users: [], access: "read" };
  const source = value as Partial<NotebookSharing>;
  const scope = source.scope === "everyone" || source.scope === "users" ? source.scope : "private";
  const users = Array.isArray(source.users)
    ? [...new Set(source.users.map((user) => String(user).trim().toLowerCase()).filter(Boolean))].slice(0, 50)
    : [];
  const access = source.access === "write" ? "write" : "read";
  return { scope, users: scope === "users" ? users : [], access };
}

function emptyStore(): NotebookStore {
  return { version: 1, books: [], sections: [], notes: [] };
}

function hasNotebookContent(store: NotebookStore): boolean {
  return store.books.length > 0 || store.sections.length > 0 || store.notes.length > 0;
}

export function normalizeNotebookStore(value: unknown): NotebookStore {
  if (!value || typeof value !== "object") return emptyStore();
  const raw = value as Partial<NotebookStore>;
  const books: NotebookBook[] = [];
  const bookIds = new Set<string>();
  for (const [index, item] of (Array.isArray(raw.books) ? raw.books : []).entries()) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<NotebookBook>;
    const id = String(source.id || "").trim();
    if (!id || bookIds.has(id)) continue;
    bookIds.add(id);
    const createdAt = cleanOrder(source.createdAt, Date.now());
    books.push({
      id,
      title: cleanTitle(source.title, "Untitled book"),
      color: cleanColor(source.color, NOTEBOOK_COLORS[index % NOTEBOOK_COLORS.length]),
      order: cleanOrder(source.order, index),
      createdAt,
      updatedAt: cleanOrder(source.updatedAt, createdAt),
      sharing: cleanSharing(source.sharing),
    });
  }

  const sections: NotebookSection[] = [];
  const sectionIds = new Set<string>();
  for (const [index, item] of (Array.isArray(raw.sections) ? raw.sections : []).entries()) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<NotebookSection>;
    const id = String(source.id || "").trim();
    const bookId = String(source.bookId || "").trim();
    if (!id || !bookIds.has(bookId) || sectionIds.has(id)) continue;
    sectionIds.add(id);
    const book = books.find((candidate) => candidate.id === bookId)!;
    const createdAt = cleanOrder(source.createdAt, Date.now());
    sections.push({
      id,
      bookId,
      title: cleanTitle(source.title, "Untitled section"),
      color: cleanColor(source.color, book.color),
      order: cleanOrder(source.order, index),
      createdAt,
      updatedAt: cleanOrder(source.updatedAt, createdAt),
    });
  }

  const noteTombstonesById = new Map<string, NotebookNoteTombstone>();
  for (const item of (Array.isArray(raw.noteTombstones) ? raw.noteTombstones : [])) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<NotebookNoteTombstone>;
    const id = String(source.id || "").trim();
    const deletedAt = Number(source.deletedAt);
    if (!id || !Number.isFinite(deletedAt) || deletedAt <= 0) continue;
    const previous = noteTombstonesById.get(id);
    if (!previous || deletedAt > previous.deletedAt) {
      noteTombstonesById.set(id, { id, deletedAt });
    }
  }
  const noteTombstones = [...noteTombstonesById.values()];

  const notes: NotebookNote[] = [];
  const noteIds = new Set<string>();
  for (const [index, item] of (Array.isArray(raw.notes) ? raw.notes : []).entries()) {
    if (!item || typeof item !== "object") continue;
    const source = item as Partial<NotebookNote>;
    const id = String(source.id || "").trim();
    const sectionId = String(source.sectionId || "").trim();
    if (!id || !sectionIds.has(sectionId) || noteIds.has(id) || noteTombstonesById.has(id)) continue;
    noteIds.add(id);
    const createdAt = cleanOrder(source.createdAt, Date.now());
    const rawSource = source.source;
    const terminalSource = rawSource?.kind === "terminal"
      ? {
          kind: "terminal" as const,
          sessionTitle: cleanTitle(rawSource.sessionTitle, "Terminal session"),
          capturedAt: cleanOrder(rawSource.capturedAt, createdAt),
        }
      : undefined;
    notes.push({
      id,
      sectionId,
      title: cleanTitle(source.title, "Untitled note"),
      body: String(source.body ?? ""),
      order: cleanOrder(source.order, index),
      createdAt,
      updatedAt: cleanOrder(source.updatedAt, createdAt),
      source: terminalSource,
    });
  }
  return {
    version: 1,
    books,
    sections,
    notes,
    ...(noteTombstones.length > 0 ? { noteTombstones } : {}),
  };
}

export function loadNotebooks(): NotebookStore {
  try {
    const raw = localStorage.getItem(NOTEBOOKS_STORAGE_KEY);
    return raw ? normalizeNotebookStore(JSON.parse(raw)) : emptyStore();
  } catch {
    return emptyStore();
  }
}

export function loadLocalNotebookBackups(): LocalNotebookBackup[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTEBOOK_BACKUPS_STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const source = entry as Partial<LocalNotebookBackup>;
      const createdAt = Number(source.createdAt);
      const store = normalizeNotebookStore(source.store);
      return Number.isFinite(createdAt) && hasNotebookContent(store) ? [{ createdAt, store }] : [];
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_LOCAL_NOTEBOOK_BACKUPS);
  } catch {
    return [];
  }
}

export function recordLocalNotebookBackup(store: NotebookStore, createdAt = Date.now(), force = false): void {
  const normalized = normalizeNotebookStore(store);
  if (!hasNotebookContent(normalized)) return;
  const backups = loadLocalNotebookBackups();
  const serialized = JSON.stringify(normalized);
  if (backups[0] && JSON.stringify(backups[0].store) === serialized) return;
  if (!force && backups[0] && createdAt - backups[0].createdAt < LOCAL_NOTEBOOK_BACKUP_INTERVAL_MS) return;
  const next = [{ createdAt, store: normalized }, ...backups].slice(0, MAX_LOCAL_NOTEBOOK_BACKUPS);
  try {
    localStorage.setItem(NOTEBOOK_BACKUPS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep notebook editing available even if the browser storage quota is full.
  }
}

export function createNotebookBackupFile(store = loadNotebooks()): NotebookBackupFile {
  return {
    format: "catwalk-notebooks-backup",
    backupVersion: 1,
    createdAt: Date.now(),
    store: normalizeNotebookStore(store),
  };
}

export function parseNotebookBackupFile(text: string): NotebookBackupFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!value || typeof value !== "object") throw new Error("The selected file is not a notebook backup.");
  const source = value as Partial<NotebookBackupFile>;
  if (source.format !== "catwalk-notebooks-backup" || source.backupVersion !== 1 || !source.store) {
    throw new Error("The selected file is not a supported ConneCat notebook backup.");
  }
  const rawStore = source.store as Partial<NotebookStore>;
  if (!Array.isArray(rawStore.books) || !Array.isArray(rawStore.sections) || !Array.isArray(rawStore.notes)) {
    throw new Error("The notebook backup is incomplete.");
  }
  const store = normalizeNotebookStore(rawStore);
  if (rawStore.books.length > 0 && store.books.length === 0) {
    throw new Error("The notebook backup does not contain valid books.");
  }
  return {
    format: "catwalk-notebooks-backup",
    backupVersion: 1,
    createdAt: Number.isFinite(Number(source.createdAt)) ? Number(source.createdAt) : Date.now(),
    store,
  };
}

function persist(next: NotebookStore): NotebookStore {
  recordLocalNotebookBackup(loadNotebooks());
  const normalized = normalizeNotebookStore(next);
  const previous = localStorage.getItem(NOTEBOOKS_STORAGE_KEY);
  if (!localStorage.getItem(NOTEBOOK_SYNC_BASE_STORAGE_KEY) && previous) {
    localStorage.setItem(NOTEBOOK_SYNC_BASE_STORAGE_KEY, previous);
  }
  localStorage.setItem(NOTEBOOK_PENDING_SYNC_STORAGE_KEY, "1");
  localStorage.setItem(NOTEBOOKS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(NOTEBOOKS_CHANGED_EVENT));
  return normalized;
}

export function restoreNotebookBackup(store: NotebookStore): NotebookStore {
  recordLocalNotebookBackup(loadNotebooks(), Date.now(), true);
  return persist(store);
}

function mutate(change: (draft: NotebookStore) => void): NotebookStore {
  const draft = loadNotebooks();
  change(draft);
  return persist(draft);
}

function addNoteTombstones(draft: NotebookStore, ids: Iterable<string>, deletedAt = Date.now()): void {
  const tombstones = new Map((draft.noteTombstones ?? []).map((item) => [item.id, item]));
  for (const id of ids) {
    const cleanId = String(id).trim();
    if (!cleanId) continue;
    const previous = tombstones.get(cleanId);
    if (!previous || deletedAt > previous.deletedAt) {
      tombstones.set(cleanId, { id: cleanId, deletedAt });
    }
  }
  draft.noteTombstones = [...tombstones.values()];
}

export function subscribeNotebooks(listener: () => void): () => void {
  const onLocal = () => listener();
  const onStorage = (event: StorageEvent) => {
    if (event.key === NOTEBOOKS_STORAGE_KEY) listener();
  };
  window.addEventListener(NOTEBOOKS_CHANGED_EVENT, onLocal);
  window.addEventListener("catwalk:cloud-settings-applied", onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(NOTEBOOKS_CHANGED_EVENT, onLocal);
    window.removeEventListener("catwalk:cloud-settings-applied", onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

function nextOrder(items: Array<{ order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
}

export function createBook(title = "New book", color = NOTEBOOK_COLORS[0]): { store: NotebookStore; book: NotebookBook } {
  const now = Date.now();
  const current = loadNotebooks();
  const book: NotebookBook = {
    id: newId("book"),
    title: cleanTitle(title, "New book"),
    color: cleanColor(color, NOTEBOOK_COLORS[0]),
    order: nextOrder(current.books),
    createdAt: now,
    updatedAt: now,
    sharing: { scope: "private", users: [], access: "read" },
  };
  current.books.push(book);
  return { store: persist(current), book };
}

export function updateBook(id: string, patch: Partial<Pick<NotebookBook, "title" | "color" | "sharing">>): NotebookStore {
  return mutate((draft) => {
    const book = draft.books.find((item) => item.id === id);
    if (!book) return;
    if (patch.title !== undefined) book.title = cleanTitle(patch.title, book.title);
    if (patch.color !== undefined) book.color = cleanColor(patch.color, book.color);
    if (patch.sharing !== undefined) book.sharing = cleanSharing(patch.sharing);
    book.updatedAt = Date.now();
  });
}

export function updateBookColor(id: string, color: string, applyToSections = false): NotebookStore {
  return mutate((draft) => {
    const book = draft.books.find((item) => item.id === id);
    if (!book) return;
    const nextColor = cleanColor(color, book.color);
    const updatedAt = Date.now();
    book.color = nextColor;
    book.updatedAt = updatedAt;
    if (applyToSections) {
      for (const section of draft.sections) {
        if (section.bookId !== id) continue;
        section.color = nextColor;
        section.updatedAt = updatedAt;
      }
    }
  });
}

export function deleteBook(id: string): NotebookStore {
  recordLocalNotebookBackup(loadNotebooks(), Date.now(), true);
  return mutate((draft) => {
    const sectionIds = new Set(draft.sections.filter((item) => item.bookId === id).map((item) => item.id));
    const deletedNoteIds = draft.notes.filter((item) => sectionIds.has(item.sectionId)).map((item) => item.id);
    addNoteTombstones(draft, deletedNoteIds);
    draft.books = draft.books.filter((item) => item.id !== id);
    draft.sections = draft.sections.filter((item) => item.bookId !== id);
    draft.notes = draft.notes.filter((item) => !sectionIds.has(item.sectionId));
  });
}

export function createSection(bookId: string, title = "New section", color?: string): { store: NotebookStore; section: NotebookSection | null } {
  const current = loadNotebooks();
  const book = current.books.find((item) => item.id === bookId);
  if (!book) return { store: current, section: null };
  const siblings = current.sections.filter((item) => item.bookId === bookId);
  const now = Date.now();
  const section: NotebookSection = {
    id: newId("section"),
    bookId,
    title: cleanTitle(title, "New section"),
    color: cleanColor(color, book.color),
    order: nextOrder(siblings),
    createdAt: now,
    updatedAt: now,
  };
  current.sections.push(section);
  return { store: persist(current), section };
}

export function updateSection(id: string, patch: Partial<Pick<NotebookSection, "title" | "color">>): NotebookStore {
  return mutate((draft) => {
    const section = draft.sections.find((item) => item.id === id);
    if (!section) return;
    if (patch.title !== undefined) section.title = cleanTitle(patch.title, section.title);
    if (patch.color !== undefined) section.color = cleanColor(patch.color, section.color);
    section.updatedAt = Date.now();
  });
}

export function deleteSection(id: string): NotebookStore {
  recordLocalNotebookBackup(loadNotebooks(), Date.now(), true);
  return mutate((draft) => {
    addNoteTombstones(draft, draft.notes.filter((item) => item.sectionId === id).map((item) => item.id));
    draft.sections = draft.sections.filter((item) => item.id !== id);
    draft.notes = draft.notes.filter((item) => item.sectionId !== id);
  });
}

function reorder<T extends { id: string; order: number }>(items: T[], movedId: string, beforeId?: string): void {
  const ordered = [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const movedIndex = ordered.findIndex((item) => item.id === movedId);
  if (movedIndex < 0) return;
  const [moved] = ordered.splice(movedIndex, 1);
  const targetIndex = beforeId ? ordered.findIndex((item) => item.id === beforeId) : -1;
  ordered.splice(targetIndex >= 0 ? targetIndex : ordered.length, 0, moved);
  ordered.forEach((item, index) => { item.order = index; });
}

export function moveSection(sectionId: string, bookId: string, beforeSectionId?: string): NotebookStore {
  return mutate((draft) => {
    const section = draft.sections.find((item) => item.id === sectionId);
    if (!section || !draft.books.some((item) => item.id === bookId)) return;
    section.bookId = bookId;
    section.updatedAt = Date.now();
    reorder(draft.sections.filter((item) => item.bookId === bookId), sectionId, beforeSectionId);
  });
}

export function moveBook(bookId: string, beforeBookId?: string): NotebookStore {
  return mutate((draft) => {
    const book = draft.books.find((item) => item.id === bookId);
    if (!book) return;
    book.updatedAt = Date.now();
    reorder(draft.books, bookId, beforeBookId);
  });
}

export function createNote(sectionId: string, title = "Untitled note", body = ""): { store: NotebookStore; note: NotebookNote | null } {
  const current = loadNotebooks();
  if (!current.sections.some((item) => item.id === sectionId)) return { store: current, note: null };
  const now = Date.now();
  const note: NotebookNote = {
    id: newId("note"),
    sectionId,
    title: cleanTitle(title, "Untitled note"),
    body,
    order: nextOrder(current.notes.filter((item) => item.sectionId === sectionId)),
    createdAt: now,
    updatedAt: now,
  };
  current.notes.push(note);
  return { store: persist(current), note };
}

export function updateNote(id: string, patch: Partial<Pick<NotebookNote, "title" | "body">>): NotebookStore {
  return mutate((draft) => {
    const note = draft.notes.find((item) => item.id === id);
    if (!note) return;
    if (patch.title !== undefined) note.title = cleanTitle(patch.title, note.title);
    if (patch.body !== undefined) note.body = patch.body;
    note.updatedAt = Date.now();
  });
}

export function deleteNote(id: string): NotebookStore {
  return deleteNotes([id]);
}

export function deleteNotes(ids: Iterable<string>): NotebookStore {
  const noteIds = new Set(ids);
  if (noteIds.size === 0) return loadNotebooks();
  recordLocalNotebookBackup(loadNotebooks(), Date.now(), true);
  return mutate((draft) => {
    const deletedIds = draft.notes.filter((item) => noteIds.has(item.id)).map((item) => item.id);
    addNoteTombstones(draft, deletedIds);
    draft.notes = draft.notes.filter((item) => !noteIds.has(item.id));
  });
}

export function moveNote(noteId: string, sectionId: string, beforeNoteId?: string): NotebookStore {
  return mutate((draft) => {
    const note = draft.notes.find((item) => item.id === noteId);
    if (!note || !draft.sections.some((item) => item.id === sectionId)) return;
    note.sectionId = sectionId;
    note.updatedAt = Date.now();
    reorder(draft.notes.filter((item) => item.sectionId === sectionId), noteId, beforeNoteId);
  });
}

export function notebookDestinations(store = loadNotebooks()): NotebookDestination[] {
  return [...store.books]
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map((book) => ({
      book,
      sections: store.sections
        .filter((section) => section.bookId === book.id)
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    }));
}

export function captureTerminalSelection(
  sectionId: string,
  sessionTitle: string,
  selection: string,
): { store: NotebookStore; note: NotebookNote | null } {
  const current = loadNotebooks();
  if (!current.sections.some((item) => item.id === sectionId)) return { store: current, note: null };
  const now = Date.now();
  const cleanSessionTitle = cleanTitle(sessionTitle, "Terminal session");
  const clipped = normalizeConsoleText(String(selection || "").slice(0, MAX_TERMINAL_CAPTURE_CHARS))
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "");
  const stamp = new Date(now).toLocaleString();
  const note: NotebookNote = {
    id: newId("note"),
    sectionId,
    title: `${cleanSessionTitle} — ${stamp}`.slice(0, 160),
    body: `# ${cleanSessionTitle}\n\nCaptured ${stamp}\n\n\`\`\`text\n${clipped}\n\`\`\``,
    order: nextOrder(current.notes.filter((item) => item.sectionId === sectionId)),
    createdAt: now,
    updatedAt: now,
    source: { kind: "terminal", sessionTitle: cleanSessionTitle, capturedAt: now },
  };
  current.notes.push(note);
  return { store: persist(current), note };
}
