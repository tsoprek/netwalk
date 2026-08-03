import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { useAppearance } from "../appearance/AppearanceContext";
import ContextMenu, {
  captureContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "../components/ContextMenu";
import NotesIcon from "../components/NotesIcon";
import { useNavMenuItems } from "../components/navMenu";
import { type CommandTemplate, preconfiguredCommandTemplates } from "../terminals/templates";
import {
  deleteUserTemplate,
  deleteUserTemplateGroup,
  detectVariables,
  listUserTemplateGroups,
  listUserTemplates,
  saveUserTemplate,
  saveUserTemplateGroup,
  renameUserTemplateGroup,
  type UserTemplate,
} from "../terminals/userTemplates";

type Selection = { kind: "personal" | "preconfigured"; id: string } | null;

interface Draft {
  id?: string;
  name: string;
  group: string;
  description: string;
  body: string;
  lineDelayMs: number;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  group: "",
  description: "",
  body: "",
  lineDelayMs: 60,
};

function draftFromTemplate(template: UserTemplate): Draft {
  return {
    id: template.id,
    name: template.name,
    group: template.subcategory ?? "",
    description: template.description ?? "",
    body: template.body,
    lineDelayMs: template.lineDelayMs ?? 60,
  };
}

function includesSearch(template: CommandTemplate, search: string): boolean {
  if (!search) return true;
  const haystack = [template.name, template.description, template.category, template.subcategory]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(search);
}

function groupBy<T extends CommandTemplate>(items: T[], orderedGroups: string[]): Array<{ name: string; items: T[] }> {
  const remaining = new Map<string, T[]>();
  for (const item of items) {
    const name = item.subcategory?.trim() || "Ungrouped";
    const list = remaining.get(name) ?? [];
    list.push(item);
    remaining.set(name, list);
  }

  const result: Array<{ name: string; items: T[] }> = [];
  for (const name of orderedGroups) {
    result.push({ name, items: remaining.get(name) ?? [] });
    remaining.delete(name);
  }
  for (const [name, groupedItems] of remaining) result.push({ name, items: groupedItems });
  return result;
}

function groupByCategory<T extends CommandTemplate>(items: T[]): Array<{ name: string; items: T[] }> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const groupedItems = result.get(item.category) ?? [];
    groupedItems.push(item);
    result.set(item.category, groupedItems);
  }
  return [...result].map(([name, groupedItems]) => ({ name, items: groupedItems }));
}

export default function Templates() {
  const { appearance } = useAppearance();
  const [templates, setTemplates] = useState<UserTemplate[]>(listUserTemplates);
  const [groups, setGroups] = useState<string[]>(listUserTemplateGroups);
  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [personalOpen, setPersonalOpen] = useState(true);
  const [preconfiguredOpen, setPreconfiguredOpen] = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(listUserTemplateGroups()));
  const [message, setMessage] = useState("");
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const navItems = useNavMenuItems();

  const builtIns = useMemo(() => preconfiguredCommandTemplates(), []);
  const selectedPersonal = selection?.kind === "personal"
    ? templates.find((item) => item.id === selection.id) ?? null
    : null;
  const selectedBuiltIn = selection?.kind === "preconfigured"
    ? builtIns.find((item) => item.id === selection.id) ?? null
    : null;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const personalGroups = useMemo(
    () => groupBy(templates.filter((item) => includesSearch(item, normalizedSearch)), [...groups, "Ungrouped"]),
    [groups, normalizedSearch, templates],
  );
  const builtInGroups = useMemo(
    () => groupByCategory(builtIns.filter((item) => includesSearch(item, normalizedSearch))),
    [builtIns, normalizedSearch],
  );

  function reload() {
    setTemplates(listUserTemplates());
    setGroups(listUserTemplateGroups());
  }

  function startNew(group = "") {
    setSelection(null);
    setDraft({ ...EMPTY_DRAFT, group });
    setMessage("");
  }

  function edit(template: UserTemplate) {
    setSelection({ kind: "personal", id: template.id });
    setDraft(draftFromTemplate(template));
    setMessage("");
  }

  function preview(template: CommandTemplate) {
    setSelection({ kind: "preconfigured", id: template.id });
    setDraft(null);
    setMessage("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft?.name.trim()) return;
    const previousVariables = selectedPersonal?.variables ?? [];
    const saved = saveUserTemplate({
      id: draft.id,
      name: draft.name,
      subcategory: draft.group,
      description: draft.description,
      body: draft.body,
      lineDelayMs: draft.lineDelayMs,
      sharing: selectedPersonal?.sharing,
      variables: detectVariables(draft.body).map((key) => {
        const previous = previousVariables.find((variable) => variable.key === key);
        return previous ?? { key, label: key };
      }),
    });
    reload();
    setSelection({ kind: "personal", id: saved.id });
    setDraft(draftFromTemplate(saved));
    setOpenGroups((current) => new Set(current).add(saved.subcategory?.trim() || "Ungrouped"));
    setMessage("Template saved.");
  }

  function createGroup() {
    const proposed = window.prompt("Group name");
    if (!proposed?.trim()) return;
    try {
      const group = saveUserTemplateGroup(proposed);
      reload();
      setOpenGroups((current) => new Set(current).add(group));
      startNew(group);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The group could not be created.");
    }
  }

  function toggleGroup(scope: string, name: string) {
    const key = `${scope}:${name}`;
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key) || (scope === "personal" && next.has(name))) {
        next.delete(key);
        next.delete(name);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function isGroupOpen(scope: string, name: string) {
    return Boolean(normalizedSearch) || openGroups.has(`${scope}:${name}`) || (scope === "personal" && openGroups.has(name));
  }

  function duplicate(template: CommandTemplate) {
    setSelection(null);
    setDraft({
      name: `${template.name} (copy)`,
      group: template.subcategory ?? template.category,
      description: template.description ?? "",
      body: template.body,
      lineDelayMs: template.lineDelayMs ?? 60,
    });
    setMessage("");
  }

  function openTemplateMenu(event: React.MouseEvent, template: UserTemplate) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "Edit", onClick: () => edit(template) },
        { label: "Duplicate", onClick: () => duplicate(template) },
        { divider: true },
        {
          label: "Delete…",
          danger: true,
          onClick: () => {
            if (!window.confirm(`Delete template “${template.name}”?`)) return;
            deleteUserTemplate(template.id);
            reload();
            if (selection?.kind === "personal" && selection.id === template.id) {
              setSelection(null);
              setDraft(null);
            }
          },
        },
        { divider: true },
        { label: "New template", onClick: () => startNew() },
        { divider: true },
        ...navItems,
      ],
    });
  }

  function openBuiltInMenu(event: React.MouseEvent, template: CommandTemplate) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "Preview", onClick: () => preview(template) },
        { label: "Duplicate to my templates", onClick: () => duplicate(template) },
        { divider: true },
        { label: "New template", onClick: () => startNew() },
        { divider: true },
        ...navItems,
      ],
    });
  }

  function openGroupMenu(event: React.MouseEvent, group: string) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "New template in group", onClick: () => startNew(group === "Ungrouped" ? "" : group) },
        {
          label: "Rename group…",
          disabled: group === "Ungrouped",
          onClick: () => {
            const next = window.prompt("Group name", group);
            if (!next?.trim() || next.trim() === group) return;
            try {
              renameUserTemplateGroup(group, next);
              reload();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "The group could not be renamed.");
            }
          },
        },
        { divider: true },
        {
          label: "Delete group…",
          danger: true,
          disabled: group === "Ungrouped",
          onClick: () => {
            if (!window.confirm(`Delete group “${group}”? Templates in it will move to Ungrouped.`)) return;
            deleteUserTemplateGroup(group);
            reload();
          },
        },
      ],
    });
  }

  function openPageMenu(event: React.MouseEvent) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "New template", onClick: () => startNew() },
        {
          label: "Clear selection",
          disabled: !selection && !draft,
          onClick: () => { setSelection(null); setDraft(null); setMessage(""); },
        },
        { label: "Clear search", disabled: !search, onClick: () => setSearch("") },
        { divider: true },
        ...navItems,
      ],
    });
  }

  return (
    <div
      className={`templates-page templates-reference-layout workspace-page--${appearance.workspaceDesign}`}
      onContextMenu={openPageMenu}
    >
      <aside className="templates-sidebar" aria-label="Template library">
        <div className="templates-sidebar-header">
          <h1 className="page-view-title">Templates</h1>
          <div className="templates-sidebar-actions">
            <button type="button" className="outline-action-button" onClick={createGroup}>
              <NotesIcon name="new-folder" size={15} /> Group
            </button>
            <button type="button" className="outline-action-button" onClick={() => startNew()}>
              <NotesIcon name="add" size={15} /> Template
            </button>
          </div>
          <label className="templates-search">
            <span className="sr-only">Search templates</span>
            <input
              type="search"
              placeholder="Search templates"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="templates-tree">
          <TemplateRoot
            label="Personal"
            count={templates.length}
            open={personalOpen || Boolean(normalizedSearch)}
            onToggle={() => setPersonalOpen((value) => !value)}
          >
            {personalGroups.map((group) => (
              <TemplateGroup
                key={`personal:${group.name}`}
                name={group.name}
                count={group.items.length}
                open={isGroupOpen("personal", group.name)}
                onToggle={() => toggleGroup("personal", group.name)}
                onAdd={() => startNew(group.name === "Ungrouped" ? "" : group.name)}
                onContextMenu={(event) => openGroupMenu(event, group.name)}
              >
                {group.items.map((template) => (
                  <TemplateTreeItem
                    key={template.id}
                    template={template}
                    selected={selection?.kind === "personal" && selection.id === template.id}
                    onClick={() => edit(template)}
                    onContextMenu={(event) => openTemplateMenu(event, template)}
                    shared={template.sharing?.scope !== undefined && template.sharing.scope !== "private"}
                  />
                ))}
              </TemplateGroup>
            ))}
          </TemplateRoot>

          <TemplateRoot
            label="Preconfigured"
            count={builtIns.length}
            open={preconfiguredOpen || Boolean(normalizedSearch)}
            onToggle={() => setPreconfiguredOpen((value) => !value)}
          >
            {builtInGroups.map((group) => (
              <TemplateGroup
                key={`preconfigured:${group.name}`}
                name={group.name}
                count={group.items.length}
                open={isGroupOpen("preconfigured", group.name)}
                onToggle={() => toggleGroup("preconfigured", group.name)}
              >
                {group.items.map((template) => (
                  <TemplateTreeItem
                    key={template.id}
                    template={template}
                    selected={selection?.kind === "preconfigured" && selection.id === template.id}
                    onClick={() => preview(template)}
                    onContextMenu={(event) => openBuiltInMenu(event, template)}
                  />
                ))}
              </TemplateGroup>
            ))}
          </TemplateRoot>

          {normalizedSearch && personalGroups.every((group) => group.items.length === 0) && builtInGroups.length === 0 && (
            <p className="templates-tree-empty">No templates match “{search.trim()}”.</p>
          )}
        </div>
      </aside>

      <div className="templates-detail">
        {draft ? (
          <TemplateEditor
            draft={draft}
            setDraft={setDraft}
            editing={Boolean(draft.id)}
            message={message}
            onSubmit={submit}
            onCancel={() => {
              setDraft(null);
              setSelection(null);
              setMessage("");
            }}
            onDelete={selectedPersonal ? () => {
              if (!window.confirm(`Delete “${selectedPersonal.name}”?`)) return;
              deleteUserTemplate(selectedPersonal.id);
              reload();
              setDraft(null);
              setSelection(null);
              setMessage("");
            } : undefined}
          />
        ) : selectedBuiltIn ? (
          <TemplatePreview template={selectedBuiltIn} onDuplicate={() => duplicate(selectedBuiltIn)} />
        ) : (
          <div className="templates-welcome">
            <h2>Templates</h2>
            <p>Select a template on the left to <strong>edit</strong> (your templates) or <strong>preview</strong> (built-ins).</p>
            <p>Built-in templates are read-only. Use <strong>Duplicate to my templates</strong> to create an editable copy.</p>
            <button type="button" className="outline-action-button" onClick={() => startNew()}>
              <NotesIcon name="add" size={16} /> New template
            </button>
          </div>
        )}
      </div>
      {menu && <ContextMenu position={menu.pos} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TemplateRoot({
  label,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`template-tree-root-card${open ? " is-open" : ""}`}>
      <button type="button" className="template-tree-root-row" aria-expanded={open} onClick={onToggle}>
        <span className="template-tree-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <strong>{label}</strong>
        <span className="template-tree-count">{count}</span>
      </button>
      {open && <div className="template-tree-root-content">{children}</div>}
    </section>
  );
}

function TemplateGroup({
  name,
  count,
  open,
  onToggle,
  onAdd,
  onContextMenu,
  children,
}: {
  name: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  children: ReactNode;
}) {
  return (
    <section className="template-tree-group-card" onContextMenu={onContextMenu}>
      <div className="template-tree-group-heading">
        <button type="button" className="template-tree-group-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="template-tree-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <strong>{name}</strong>
        </button>
        <span className="template-tree-count">{count}</span>
        {onAdd && (
          <button type="button" className="template-tree-add" aria-label={`Add template to ${name}`} onClick={onAdd}>
            <NotesIcon name="add" size={15} />
          </button>
        )}
      </div>
      {open && <div className="template-tree-group-content">{children}</div>}
    </section>
  );
}

function TemplateTreeItem({
  template,
  selected,
  shared = false,
  onClick,
  onContextMenu,
}: {
  template: CommandTemplate;
  selected: boolean;
  shared?: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <div className={`template-tree-template${selected ? " selected" : ""}`} onContextMenu={onContextMenu}>
      <button type="button" onClick={onClick} onContextMenu={onContextMenu}>
        <span className="template-tree-item-text">
          <strong>{template.name}</strong>
          <small>{template.subcategory ?? template.category}</small>
        </span>
        {shared && <span className="template-shared-badge">Shared</span>}
      </button>
    </div>
  );
}

function TemplateEditor({
  draft,
  setDraft,
  editing,
  message,
  onSubmit,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  editing: boolean;
  message: string;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const variables = detectVariables(draft.body);
  return (
    <form className="template-editor" onSubmit={onSubmit}>
      <header className="template-detail-header">
        <div>
          <span className="template-detail-kicker">My templates</span>
          <h2>{editing ? "Edit template" : "New template"}</h2>
        </div>
        <div className="template-detail-actions">
          <button type="button" className="outline-action-button outline-action-button--muted" onClick={onCancel}>Cancel</button>
          {onDelete && <button type="button" className="outline-action-button outline-action-button--danger" onClick={onDelete}>Delete</button>}
          <button type="submit" className="outline-action-button" disabled={!draft.name.trim()}>
            <NotesIcon name="save" size={15} /> Save
          </button>
        </div>
      </header>

      <div className="template-editor-scroll">
        {message && <p className="template-editor-message" role="status">{message}</p>}
        <div className="template-editor-meta-grid">
          <label>Name<input value={draft.name} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Group<input value={draft.group} list="template-group-options" onChange={(event) => setDraft({ ...draft, group: event.target.value })} /></label>
        </div>
        <label>Description<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <div className="template-editor-workspace">
          <label>Commands<textarea rows={18} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="show version" /></label>
          <aside className="template-editor-variables">
            <h3>Variables</h3>
            {variables.length ? (
              <ul>{variables.map((variable) => <li key={variable}><code>{`{{${variable}}}`}</code></li>)}</ul>
            ) : <p className="muted">Add placeholders such as <code>{"{{hostname}}"}</code> to prompt for values.</p>}
          </aside>
        </div>
        <label className="template-delay-field">
          Line delay
          <select value={draft.lineDelayMs} onChange={(event) => setDraft({ ...draft, lineDelayMs: Number(event.target.value) })}>
            <option value={0}>Paste instantly</option>
            <option value={30}>Fast · 30 ms</option>
            <option value={60}>Default · 60 ms</option>
            <option value={150}>Slow · 150 ms</option>
            <option value={400}>Very slow · 400 ms</option>
          </select>
        </label>
      </div>
    </form>
  );
}

function TemplatePreview({ template, onDuplicate }: { template: CommandTemplate; onDuplicate: () => void }) {
  return (
    <article className="template-preview">
      <header className="template-detail-header">
        <div>
          <span className="template-detail-kicker">Preconfigured · {template.category}</span>
          <h2>{template.name}</h2>
        </div>
        <button type="button" className="outline-action-button" onClick={onDuplicate}>
          <NotesIcon name="templates" size={16} /> Duplicate to my templates
        </button>
      </header>
      <div className="template-editor-scroll">
        {template.description && <p className="template-preview-description">{template.description}</p>}
        <section className="template-preview-code">
          <h3>Commands</h3>
          <pre>{template.body}</pre>
        </section>
        <section className="template-preview-variables">
          <h3>Variables</h3>
          {template.variables?.length ? (
            <div className="template-variable-grid">
              {template.variables.map((variable) => (
                <div key={variable.key}>
                  <code>{`{{${variable.key}}}`}</code>
                  <strong>{variable.label}</strong>
                  {variable.hint && <small>{variable.hint}</small>}
                </div>
              ))}
            </div>
          ) : <p className="muted">This template has no variables.</p>}
        </section>
      </div>
    </article>
  );
}
