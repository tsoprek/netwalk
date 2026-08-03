import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useAppearance } from "../appearance/AppearanceContext";
import ContextMenu, {
  captureContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "../components/ContextMenu";
import NotesIcon from "../components/NotesIcon";
import ThemedSelect from "../components/ThemedSelect";
import VisualMarkdownEditor, {
  type VisualMarkdownCommand,
  type VisualMarkdownEditorHandle,
} from "../components/VisualMarkdownEditor";
import {
  NOTEBOOK_COLORS,
  createBook,
  createNote,
  createNotebookBackupFile,
  createSection,
  deleteBook,
  deleteNote,
  deleteSection,
  loadLocalNotebookBackups,
  loadNotebooks,
  parseNotebookBackupFile,
  restoreNotebookBackup,
  subscribeNotebooks,
  updateBook,
  updateNote,
  updateSection,
  type NotebookBook,
  type NotebookNote,
  type NotebookSection,
} from "../notebooks/store";

const LAYOUT_KEY = "catwalk.notebooks.layout";
const TEXT_FONTS: Record<string, string> = {
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  sans: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};
const TEXT_COLORS = [
  { value: "none", label: "None" },
  { value: "#e6e6e6", label: "Light gray", color: "#e6e6e6" },
  { value: "#ef5350", label: "Red", color: "#ef5350" },
  { value: "#ff9800", label: "Orange", color: "#ff9800" },
  { value: "#f4c95d", label: "Yellow", color: "#f4c95d" },
  { value: "#63d3a3", label: "Green", color: "#63d3a3" },
  { value: "#67d4e8", label: "Cyan", color: "#67d4e8" },
  { value: "#6ea8fe", label: "Blue", color: "#6ea8fe" },
  { value: "#c99cff", label: "Purple", color: "#c99cff" },
];
const HIGHLIGHT_COLORS = [
  { value: "none", label: "None" },
  { value: "#5a4310", label: "Yellow", color: "#d6a725" },
  { value: "#174d36", label: "Green", color: "#3fa879" },
  { value: "#17465a", label: "Cyan", color: "#3c9fc5" },
  { value: "#243f70", label: "Blue", color: "#547fc8" },
  { value: "#513269", label: "Purple", color: "#9a63bf" },
  { value: "#692e35", label: "Red", color: "#be5964" },
];

type NavigationLayout = "stacked" | "side-by-side";
type NavigationPosition = "left" | "right";
type MenuState = { position: ContextMenuPosition; items: ContextMenuItem[] } | null;

function sorted<T extends { order: number; title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function readLayout(): { layout: NavigationLayout; position: NavigationPosition; sidebarWidth: number; hierarchyPercent: number } {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null") as {
      navigationLayout?: string;
      navigationPosition?: string;
      sidebarWidth?: number;
      hierarchyPercent?: number;
    } | null;
    return {
      layout: value?.navigationLayout === "stacked" ? "stacked" : "side-by-side",
      position: value?.navigationPosition === "right" ? "right" : "left",
      sidebarWidth: Math.min(760, Math.max(220, Number(value?.sidebarWidth) || 560)),
      hierarchyPercent: Math.min(78, Math.max(22, Number(value?.hierarchyPercent) || 48)),
    };
  } catch {
    return { layout: "side-by-side", position: "left", sidebarWidth: 560, hierarchyPercent: 48 };
  }
}

export default function Notebooks() {
  const { appearance, userPrefs, setUserPrefs } = useAppearance();
  const initialLayout = useMemo(readLayout, []);
  const [store, setStore] = useState(loadNotebooks);
  const [bookId, setBookId] = useState<string | null>(() => loadNotebooks().books[0]?.id ?? null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(() => new Set(loadNotebooks().books.map((book) => book.id)));
  const [navigationLayout, setNavigationLayout] = useState<NavigationLayout>(initialLayout.layout);
  const [navigationPosition, setNavigationPosition] = useState<NavigationPosition>(initialLayout.position);
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout.sidebarWidth);
  const [hierarchyPercent, setHierarchyPercent] = useState(initialLayout.hierarchyPercent);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [message, setMessage] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);
  const [autoCompactToolbar, setAutoCompactToolbar] = useState(false);
  const editorRef = useRef<VisualMarkdownEditorHandle>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeNotebooks(() => setStore(loadNotebooks())), []);
  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ navigationLayout, navigationPosition, sidebarWidth, hierarchyPercent }));
  }, [hierarchyPercent, navigationLayout, navigationPosition, sidebarWidth]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const update = () => setAutoCompactToolbar(toolbar.clientWidth < 900);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const update = () => setWorkspaceWidth(workspace.clientWidth);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(workspace);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const books = useMemo(() => sorted(store.books), [store.books]);
  const selectedBook = store.books.find((book) => book.id === bookId) ?? books[0] ?? null;
  const sections = useMemo(
    () => sorted(store.sections.filter((section) => section.bookId === selectedBook?.id)),
    [selectedBook?.id, store.sections],
  );
  const selectedSection = store.sections.find((section) => section.id === sectionId)
    ?? sections[0]
    ?? null;
  const sectionNotes = useMemo(
    () => sorted(store.notes.filter((note) => note.sectionId === selectedSection?.id)),
    [selectedSection?.id, store.notes],
  );
  const query = search.trim().toLocaleLowerCase();
  const visibleNotes = useMemo(() => {
    if (!query) return sectionNotes;
    return sorted(store.notes.filter((note) => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(query)));
  }, [query, sectionNotes, store.notes]);
  const selectedNote = store.notes.find((note) => note.id === noteId)
    ?? (!query ? sectionNotes[0] : visibleNotes[0])
    ?? null;

  useEffect(() => {
    if (selectedBook && bookId !== selectedBook.id) setBookId(selectedBook.id);
    if (!selectedBook) setBookId(null);
  }, [bookId, selectedBook]);
  useEffect(() => {
    if (selectedSection && sectionId !== selectedSection.id) setSectionId(selectedSection.id);
    if (!selectedSection) setSectionId(null);
  }, [sectionId, selectedSection]);
  useEffect(() => {
    if (selectedNote && noteId !== selectedNote.id) setNoteId(selectedNote.id);
    if (!selectedNote) setNoteId(null);
  }, [noteId, selectedNote]);
  useEffect(() => {
    setDraftTitle(selectedNote?.title ?? "");
    setDraftBody(selectedNote?.body ?? "");
  }, [selectedNote?.id, selectedNote?.title, selectedNote?.body]);
  useEffect(() => {
    if (!selectedNote) return;
    const timer = window.setTimeout(() => {
      if (draftTitle !== selectedNote.title || draftBody !== selectedNote.body) {
        setStore(updateNote(selectedNote.id, { title: draftTitle, body: draftBody }));
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftBody, draftTitle, selectedNote]);

  const showToolbarText = appearance.notesToolbarDisplay === "iconsAndText" && !autoCompactToolbar;
  const minimumEditorWidth = workspaceWidth > 0 && workspaceWidth < 760 ? 280 : 360;
  const maximumResponsiveSidebar = workspaceWidth > 0
    ? Math.max(220, Math.min(workspaceWidth - minimumEditorWidth - 6, workspaceWidth * 0.65))
    : sidebarWidth;
  const effectiveSidebarWidth = Math.max(220, Math.min(sidebarWidth, maximumResponsiveSidebar));

  function selectBook(book: NotebookBook) {
    setBookId(book.id);
    const firstSection = sorted(store.sections.filter((section) => section.bookId === book.id))[0];
    setSectionId(firstSection?.id ?? null);
    setNoteId(null);
    setExpandedBooks((current) => new Set(current).add(book.id));
  }

  function selectSection(section: NotebookSection) {
    setBookId(section.bookId);
    setSectionId(section.id);
    setNoteId(null);
  }

  function addBook() {
    const title = window.prompt("Book name", "New book")?.trim();
    if (!title) return;
    const result = createBook(title, NOTEBOOK_COLORS[books.length % NOTEBOOK_COLORS.length]);
    const sectionResult = createSection(result.book.id, "Notes");
    setStore(sectionResult.store);
    setBookId(result.book.id);
    setSectionId(sectionResult.section?.id ?? null);
    setNoteId(null);
    setExpandedBooks((current) => new Set(current).add(result.book.id));
  }

  function addSection(book = selectedBook) {
    if (!book) return;
    const title = window.prompt("Section name", "New section")?.trim();
    if (!title) return;
    const result = createSection(book.id, title);
    setStore(result.store);
    setSectionId(result.section?.id ?? null);
    setNoteId(null);
    setExpandedBooks((current) => new Set(current).add(book.id));
  }

  function addNote(section = selectedSection) {
    if (!section) return;
    const result = createNote(section.id, "Untitled note", "");
    setStore(result.store);
    setNoteId(result.note?.id ?? null);
  }

  function rename(kind: "book" | "section" | "note", item: NotebookBook | NotebookSection | NotebookNote) {
    const title = window.prompt(`Rename ${kind}`, item.title)?.trim();
    if (!title) return;
    if (kind === "book") setStore(updateBook(item.id, { title }));
    else if (kind === "section") setStore(updateSection(item.id, { title }));
    else setStore(updateNote(item.id, { title }));
  }

  function flash(value: string) {
    setMessage(value);
    window.setTimeout(() => setMessage(""), 2500);
  }

  function openHierarchyMenu(event: React.MouseEvent, item?: NotebookBook | NotebookSection) {
    const isBook = item && "bookId" in item === false;
    setMenu({
      position: captureContextMenu(event),
      items: item ? [
        isBook
          ? { label: "New section", onClick: () => addSection(item as NotebookBook) }
          : { label: "New note", onClick: () => addNote(item as NotebookSection) },
        { label: `Rename ${isBook ? "book" : "section"}…`, onClick: () => rename(isBook ? "book" : "section", item) },
        { divider: true },
        {
          label: `Delete ${isBook ? "book" : "section"}…`, danger: true,
          onClick: () => {
            if (!window.confirm(`Delete “${item.title}” and everything inside it?`)) return;
            if (isBook) deleteBook(item.id); else deleteSection(item.id);
          },
        },
      ] : [
        { label: "New book", onClick: addBook },
        { label: "New section", disabled: !selectedBook, onClick: () => addSection() },
      ],
    });
  }

  function openNoteMenu(event: React.MouseEvent, note?: NotebookNote) {
    setMenu({
      position: captureContextMenu(event),
      items: note ? [
        { label: "Open note", onClick: () => setNoteId(note.id) },
        { label: "Rename note…", onClick: () => rename("note", note) },
        { divider: true },
        { label: "Delete note…", danger: true, onClick: () => { if (window.confirm(`Delete “${note.title}”?`)) deleteNote(note.id); } },
      ] : [{ label: "New note", disabled: !selectedSection, onClick: () => addNote() }],
    });
  }

  function visualCommand(command: VisualMarkdownCommand) {
    editorRef.current?.command(command);
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const raw = navigationPosition === "right" ? rect.right - pointer.clientX : pointer.clientX - rect.left;
      const editorMinimum = rect.width < 760 ? 280 : 360;
      const maximum = Math.max(220, rect.width - editorMinimum - 6);
      setSidebarWidth(Math.min(maximum, Math.max(220, raw)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startNavigationResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const percent = navigationLayout === "side-by-side"
        ? ((pointer.clientX - rect.left) / Math.max(1, rect.width)) * 100
        : ((pointer.clientY - rect.top) / Math.max(1, rect.height)) * 100;
      setHierarchyPercent(Math.min(78, Math.max(22, percent)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = navigationLayout === "side-by-side" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function openEditorMenu(event: React.MouseEvent) {
    const command = (label: string, value: VisualMarkdownCommand): ContextMenuItem => ({ label, disabled: !selectedNote, onClick: () => visualCommand(value) });
    setMenu({
      position: captureContextMenu(event),
      items: [
        command("Undo", "undo"), command("Redo", "redo"), { divider: true },
        command("Bold", "bold"), command("Italic", "italic"), command("Inline code", "inline-code"), command("Code block", "code-block"),
        { divider: true }, command("Bulleted list", "bullet-list"), command("Numbered list", "numbered-list"), command("Quote", "quote"),
      ],
    });
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(createNotebookBackupFile(store), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `connecat-notes-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const backup = parseNotebookBackupFile(await file.text());
      if (!window.confirm(`Replace local notes with the backup from ${new Date(backup.createdAt).toLocaleString()}?`)) return;
      setStore(restoreNotebookBackup(backup.store));
      setBookId(backup.store.books[0]?.id ?? null);
      setSectionId(null);
      setNoteId(null);
      flash("Notes backup imported.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "The backup could not be imported.");
    }
  }

  function restoreLatestLocalBackup() {
    const backup = loadLocalNotebookBackups()[0];
    if (!backup) { flash("No local backups yet."); return; }
    if (!window.confirm(`Restore the local backup from ${new Date(backup.createdAt).toLocaleString()}?`)) return;
    setStore(restoreNotebookBackup(backup.store));
    setBookId(backup.store.books[0]?.id ?? null);
    setSectionId(null);
    setNoteId(null);
    flash("Local backup restored.");
  }

  return (
    <div className="notebooks-page">
      <header className="notebooks-page-header">
        <div className="notebooks-page-heading"><h1 className="page-view-title">Notes</h1></div>
        <div
          ref={toolbarRef}
          className="notebooks-toolbar"
          onContextMenu={(event) => setMenu({
            position: captureContextMenu(event),
            items: [
              { label: "Icons only", hint: appearance.notesToolbarDisplay === "icons" ? "✓" : undefined, onClick: () => setUserPrefs({ ...userPrefs, notesToolbarDisplay: "icons" }) },
              { label: "Icons and text", hint: appearance.notesToolbarDisplay === "iconsAndText" ? "✓" : undefined, onClick: () => setUserPrefs({ ...userPrefs, notesToolbarDisplay: "iconsAndText" }) },
            ],
          })}
        >
          <div className={`notebooks-toolbar-actions${autoCompactToolbar ? " notebooks-toolbar-actions--compact" : ""}`}>
            <ThemedSelect ariaLabel="Notes navigation layout" className={`notebooks-layout-select${showToolbarText ? "" : " notebooks-toolbar-select--only"}`} showSelectedText={showToolbarText} value={navigationLayout} options={[
              { value: "stacked", label: "Navigation stacked", icon: <NotesIcon name="stacked" /> },
              { value: "side-by-side", label: "Navigation side by side", icon: <NotesIcon name="side-by-side" /> },
            ]} onChange={(value) => setNavigationLayout(value === "side-by-side" ? "side-by-side" : "stacked")} />
            <ThemedSelect ariaLabel="Notes navigation position" className={`notebooks-position-select${showToolbarText ? "" : " notebooks-toolbar-select--only"}`} showSelectedText={showToolbarText} value={navigationPosition} options={[
              { value: "left", label: "Navigation left", icon: <NotesIcon name="navigation-left" /> },
              { value: "right", label: "Navigation right", icon: <NotesIcon name="navigation-right" /> },
            ]} onChange={(value) => setNavigationPosition(value === "right" ? "right" : "left")} />
            <ToolbarButton icon="sync" text="Reload notes" showText={showToolbarText} onClick={() => { setStore(loadNotebooks()); flash("Local notes reloaded."); }} />
            <ToolbarButton icon="backup" text="Backup file" showText={showToolbarText} onClick={downloadBackup} />
            <ToolbarButton icon="import" text="Import backup" showText={showToolbarText} onClick={() => importRef.current?.click()} />
            <ToolbarButton icon="history" text="Local backups" showText={showToolbarText} onClick={restoreLatestLocalBackup} />
            <ToolbarButton icon="find" text="Find" showText={showToolbarText} active={searchOpen} onClick={() => setSearchOpen((open) => !open)} />
            <ToolbarButton icon="send-to-session" text="Send to session" showText={showToolbarText} disabled />
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => { void importBackup(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </div>
        </div>
      </header>

      {searchOpen && <div className="notebooks-searchbar" role="search">
        <NotesIcon name="find" size={16} />
        <input autoFocus type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all notes" aria-label="Search all notes" />
        <span>{query ? `${visibleNotes.length} match${visibleNotes.length === 1 ? "" : "es"}` : ""}</span>
        <button type="button" onClick={() => { setSearch(""); setSearchOpen(false); }} title="Close find" aria-label="Close find"><NotesIcon name="cancel" size={16} /></button>
      </div>}
      {message && <div className="notebooks-message" role="status">{message}</div>}

      <div
        ref={workspaceRef}
        className={`notebooks-workspace notebooks-workspace--split notebooks-workspace--navigation-${navigationPosition}`}
        style={{
          gridTemplateColumns: navigationPosition === "left"
            ? `${effectiveSidebarWidth}px 6px minmax(${minimumEditorWidth}px, 1fr)`
            : `minmax(${minimumEditorWidth}px, 1fr) 6px ${effectiveSidebarWidth}px`,
          gridTemplateAreas: navigationPosition === "left" ? '"navigation divider editor"' : '"editor divider navigation"',
        }}
      >
        <aside ref={sidebarRef} className={`notebooks-sidebar notebooks-sidebar--${navigationLayout}`} style={{ gridArea: "navigation" }} aria-label="Notebook navigation">
          <section className="notebooks-hierarchy-panel" style={{ flexBasis: `${hierarchyPercent}%` }} aria-label="Books and sections" onContextMenu={(event) => openHierarchyMenu(event)}>
            <div className="notebooks-column-header"><strong>Books &amp; sections</strong><div className="notebooks-column-header-actions"><span>{store.sections.length}</span><button type="button" aria-label="Add book" title="Add book" onClick={addBook}><NotesIcon name="add" size={15} /></button></div></div>
            <div className="notebooks-list-heading notebooks-list-heading--hierarchy"><span>Name</span><span>Items</span></div>
            <div className="notebooks-tree-list">
              {books.map((book) => {
                const bookSections = sorted(store.sections.filter((section) => section.bookId === book.id));
                const open = expandedBooks.has(book.id);
                return <div key={book.id} className="notebooks-tree-branch" style={{ "--notebook-color": book.color } as CSSProperties}>
                  <div className={`notebooks-tree-row level-book${selectedBook?.id === book.id ? " active" : ""}`} onClick={() => selectBook(book)} onContextMenu={(event) => openHierarchyMenu(event, book)}>
                    <button type="button" className="notebooks-tree-kind" aria-label={open ? `Collapse ${book.title}` : `Expand ${book.title}`} onClick={(event) => { event.stopPropagation(); setExpandedBooks((current) => { const next = new Set(current); if (next.has(book.id)) next.delete(book.id); else next.add(book.id); return next; }); }}><NotesIcon name="book" size={15} /></button>
                    <strong>{book.title}</strong><span className="notebooks-tree-count">{bookSections.length}</span>
                    <button type="button" className="notebooks-tree-row-add" aria-label={`Add section to ${book.title}`} onClick={(event) => { event.stopPropagation(); addSection(book); }}><NotesIcon name="add" size={14} /></button>
                  </div>
                  {open && bookSections.map((section) => <div key={section.id} className="notebooks-section-group" style={{ "--notebook-color": section.color || book.color } as CSSProperties}>
                    <div className={`notebooks-tree-row level-section${selectedSection?.id === section.id ? " active" : ""}`} onClick={() => selectSection(section)} onContextMenu={(event) => openHierarchyMenu(event, section)}>
                      <span>{section.title}</span><span className="notebooks-tree-count">{store.notes.filter((note) => note.sectionId === section.id).length}</span>
                    </div>
                  </div>)}
                </div>;
              })}
              {books.length === 0 && <div className="notebooks-empty">Use the + button to create your first book.</div>}
            </div>
          </section>
          <div
            className={`notebooks-row-resizer${navigationLayout === "side-by-side" ? " notebooks-row-resizer--vertical" : ""}`}
            role="separator"
            aria-orientation={navigationLayout === "side-by-side" ? "vertical" : "horizontal"}
            aria-label="Resize books and notes panels"
            aria-valuemin={22}
            aria-valuemax={78}
            aria-valuenow={Math.round(hierarchyPercent)}
            tabIndex={0}
            title="Drag to resize. Double-click to reset."
            onPointerDown={startNavigationResize}
            onDoubleClick={() => setHierarchyPercent(48)}
            onKeyDown={(event) => {
              const decrease = navigationLayout === "side-by-side" ? "ArrowLeft" : "ArrowUp";
              const increase = navigationLayout === "side-by-side" ? "ArrowRight" : "ArrowDown";
              if (event.key === decrease) { event.preventDefault(); setHierarchyPercent((value) => Math.max(22, value - 3)); }
              if (event.key === increase) { event.preventDefault(); setHierarchyPercent((value) => Math.min(78, value + 3)); }
            }}
          ><span /></div>
          <section className="notebooks-notes-panel" aria-label="Notes" onContextMenu={(event) => openNoteMenu(event)}>
            <div className="notebooks-column-header"><strong>{query ? "Search results" : selectedSection ? `Notes · ${selectedSection.title}` : "Notes"}</strong><div className="notebooks-column-header-actions"><span>{visibleNotes.length}</span><button type="button" disabled={!selectedSection} aria-label="Add note" onClick={() => addNote()}><NotesIcon name="add" size={15} /></button></div></div>
            <div className="notebooks-list-heading notebooks-list-heading--notes"><span>Title</span></div>
            <div className="notebooks-notes-list">
              {visibleNotes.map((note) => {
                const parentSection = store.sections.find((section) => section.id === note.sectionId);
                const parentBook = store.books.find((book) => book.id === parentSection?.bookId);
                return <div key={note.id} className={`notebooks-note-panel-row${selectedNote?.id === note.id ? " selected active" : ""}`} style={{ "--notebook-color": parentSection?.color || parentBook?.color } as CSSProperties} onClick={() => { if (parentSection) selectSection(parentSection); setNoteId(note.id); }} onContextMenu={(event) => openNoteMenu(event, note)}>
                  <strong>{note.title}</strong>
                </div>;
              })}
              {visibleNotes.length === 0 && <div className="notebooks-empty">{selectedSection ? "No notes in this section." : "Select a section."}</div>}
            </div>
          </section>
        </aside>

        <div
          className="notebooks-column-resizer"
          style={{ gridArea: "divider" }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize notebook navigation"
          aria-valuemin={220}
          aria-valuemax={Math.round(maximumResponsiveSidebar)}
          aria-valuenow={Math.round(effectiveSidebarWidth)}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={startSidebarResize}
          onDoubleClick={() => setSidebarWidth(Math.min(560, maximumResponsiveSidebar))}
          onKeyDown={(event) => {
            const direction = navigationPosition === "right" ? -1 : 1;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setSidebarWidth((width) => Math.min(maximumResponsiveSidebar, Math.max(220, width - 16 * direction)));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setSidebarWidth((width) => Math.min(maximumResponsiveSidebar, Math.max(220, width + 16 * direction)));
            }
          }}
        ><span /></div>
        <section className="notebooks-editor" style={{ gridArea: "editor" }}>
          {selectedNote ? <>
            <div className="notebooks-editor-header">
              <div className="notebooks-editor-path">
                <span>{selectedBook?.title} / {selectedSection?.title}</span>
                <input className="notebooks-note-title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="Note title" />
              </div>
            </div>
            <FormatToolbar editorRef={editorRef} command={visualCommand} />
            <div className="notebooks-editor-surface mode-visual" onContextMenu={openEditorMenu}>
              <VisualMarkdownEditor key={selectedNote.id} ref={editorRef} value={draftBody} onChange={setDraftBody} onOpenUrl={(url) => window.open(url, "_blank", "noopener,noreferrer")} />
            </div>
            <div className="notebooks-editor-footer">Autosaved · Visual formatting · {draftBody.length.toLocaleString()} characters</div>
          </> : <div className="notebooks-editor-empty"><div aria-hidden>▤</div><h2>{selectedSection?.title ?? selectedBook?.title ?? "Select or create a note"}</h2><p>{selectedSection ? "Right-click the section to create a note, or use the + button." : "Use the hierarchy context menu to create and organize books, sections, and notes."}</p></div>}
        </section>
      </div>
      {menu && <ContextMenu position={menu.position} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ToolbarButton({ icon, text, showText, active = false, disabled = false, onClick }: { icon: Parameters<typeof NotesIcon>[0]["name"]; text: string; showText: boolean; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className={`notebooks-icon-button${active ? " active" : ""}${showText ? "" : " notebooks-icon-button--only"}`} aria-label={text} title={text} disabled={disabled} onClick={onClick}><NotesIcon name={icon} />{showText && <span>{text}</span>}</button>;
}

function FormatToolbar({ editorRef, command }: { editorRef: React.RefObject<VisualMarkdownEditorHandle>; command: (command: VisualMarkdownCommand) => void }) {
  return <div className="notebooks-format-toolbar">
    <div className="notebooks-format-selects">
      <ThemedSelect ariaLabel="Text style" value="" placeholder="Text style" options={[{ value: "paragraph", label: "Normal text" }, { value: "heading-1", label: "Heading 1" }, { value: "heading-2", label: "Heading 2" }, { value: "heading-3", label: "Heading 3" }]} onChange={(value) => command(value as VisualMarkdownCommand)} />
      <ThemedSelect ariaLabel="Font" value="" placeholder="Font" options={[{ value: "mono", label: "Monospace" }, { value: "sans", label: "Sans serif" }, { value: "serif", label: "Serif" }]} onChange={(value) => editorRef.current?.applyStyle({ fontFamily: TEXT_FONTS[value] })} />
      <ThemedSelect ariaLabel="Size" value="" placeholder="Size" options={[11, 12, 13, 14, 16, 18, 20, 22, 24].map((size) => ({ value: String(size), label: `${size}px` }))} onChange={(value) => editorRef.current?.applyStyle({ fontSize: `${value}px` })} />
      <ThemedSelect ariaLabel="Align" value="" placeholder="Align" options={[{ value: "align-left", label: "Align left" }, { value: "align-center", label: "Align center" }, { value: "align-right", label: "Align right" }, { value: "align-justify", label: "Justify" }]} onChange={(value) => command(value as VisualMarkdownCommand)} />
    </div>
    <div className="notebooks-format-colors">
      <ThemedSelect ariaLabel="Text color" value="" placeholder="Text color" options={TEXT_COLORS} onChange={(value) => editorRef.current?.applyStyle({ color: value === "none" ? null : value })} />
      <ThemedSelect ariaLabel="Highlight" value="" placeholder="Highlight" options={HIGHLIGHT_COLORS} onChange={(value) => editorRef.current?.applyStyle({ backgroundColor: value === "none" ? null : value })} />
    </div>
    <span className="notebooks-toolbar-divider" />
    <button type="button" title="Bold" onClick={() => command("bold")}><strong>B</strong></button>
    <button type="button" title="Italic" onClick={() => command("italic")}><em>I</em></button>
    <button type="button" title="Inline code" onClick={() => command("inline-code")}><span className="notebooks-inline-code">code</span></button>
    <button type="button" title="Code block" onClick={() => command("code-block")}>{"</>"}</button>
    <span className="notebooks-toolbar-divider" />
    <button type="button" title="Bulleted list" onClick={() => command("bullet-list")}>• List</button>
    <button type="button" title="Numbered list" onClick={() => command("numbered-list")}>1. List</button>
    <button type="button" title="Increase indent" onClick={() => command("list-indent")}><NotesIcon name="indent" size={16} /></button>
    <button type="button" title="Decrease indent" onClick={() => command("list-outdent")}><NotesIcon name="outdent" size={16} /></button>
    <button type="button" title="Quote" onClick={() => command("quote")}>❯</button>
  </div>;
}
