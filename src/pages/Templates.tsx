// Dedicated Templates page. Lists every built-in template (read-only)
// and every user template (full CRUD) side-by-side with an inline
// editor / preview pane. The right-click "Templates" menu in the
// terminals page still works the same — this is just an alternative,
// roomier surface for managing the user library.

import { useEffect, useMemo, useState } from "react";
import {
  CommandTemplate,
  TemplateVar,
  groupTemplatesForMenu,
  preconfiguredCommandTemplates,
  renderTemplate,
} from "../terminals/templates";
import {
  UserTemplate,
  deleteUserTemplate,
  deleteUserTemplateGroup,
  detectVariables,
  listUserTemplateGroups,
  listUserTemplates,
  moveUserTemplate,
  renameUserTemplateGroup,
  reorderUserTemplateGroups,
  saveUserTemplate,
  saveUserTemplateGroup,
} from "../terminals/userTemplates";
import ContextMenu, {
  type ContextMenuItem,
  type ContextMenuPosition,
  captureContextMenu,
} from "../components/ContextMenu";
import Switch from "../components/Switch";
import { useNavMenuItems } from "../components/navMenu";
import NotesIcon from "../components/NotesIcon";
import ThemedSelect from "../components/ThemedSelect";
import { useAppearance } from "../appearance/AppearanceContext";

interface VarMeta {
  label: string;
  default: string;
  hint: string;
  secret: boolean;
  multiline: boolean;
}

interface Draft {
  id?: string;
  name: string;
  subcategory: string;
  description: string;
  body: string;
  lineDelayMs: number;
  vars: Record<string, VarMeta>;
}

type Selection =
  | { kind: "none" }
  | { kind: "new"; group?: string }
  | { kind: "builtin"; id: string }
  | { kind: "user"; id: string };

interface GroupDialogState {
  mode: "create" | "rename";
  current?: string;
  value: string;
  error: string;
}

type PersonalTemplateDrag =
  | { kind: "group"; group: string }
  | { kind: "template"; id: string };

type PersonalTemplateDrop = {
  kind: "group" | "template";
  key: string;
  placement: "before" | "after";
};

const DELAY_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 0,   label: "Paste (instant)" },
  { ms: 30,  label: "Fast (30 ms)" },
  { ms: 60,  label: "Default (60 ms)" },
  { ms: 150, label: "Slow (150 ms)" },
  { ms: 400, label: "Very slow (400 ms)" },
];

function verticalDropPlacement(event: React.DragEvent<HTMLElement>): "before" | "after" {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function blankDraft(group = ""): Draft {
  return { name: "", subcategory: group, description: "", body: "", lineDelayMs: 60, vars: {} };
}

function draftFrom(t: CommandTemplate, opts: { stripId?: boolean } = {}): Draft {
  const vars: Record<string, VarMeta> = {};
  for (const v of t.variables ?? []) {
    vars[v.key] = {
      label: v.label ?? v.key,
      default: v.default ?? "",
      hint: v.hint ?? "",
      secret: !!v.secret,
      multiline: !!v.multiline,
    };
  }
  return {
    id: opts.stripId ? undefined : t.id,
    name: t.name,
    subcategory: t.subcategory ?? "",
    description: t.description ?? "",
    body: t.body,
    lineDelayMs: t.lineDelayMs ?? 60,
    vars,
  };
}

export default function Templates() {
  const { appearance } = useAppearance();
  const [userTpls, setUserTpls] = useState<UserTemplate[]>(() => listUserTemplates());
  const [personalGroups, setPersonalGroups] = useState<string[]>(() => listUserTemplateGroups());
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null);
  const [personalOpen, setPersonalOpen] = useState(true);
  const [preconfiguredOpen, setPreconfiguredOpen] = useState(true);
  const [openPersonalGroups, setOpenPersonalGroups] = useState<Set<string>>(() => new Set(listUserTemplateGroups()));
  const [openPreconfiguredGroups, setOpenPreconfiguredGroups] = useState<Set<string>>(() => new Set());
  const [personalDrag, setPersonalDrag] = useState<PersonalTemplateDrag | null>(null);
  const [personalDrop, setPersonalDrop] = useState<PersonalTemplateDrop | null>(null);
  const navItems = useNavMenuItems();

  const refresh = () => {
    setUserTpls(listUserTemplates());
    setPersonalGroups(listUserTemplateGroups());
  };

  const persistReorder = () => {
    refresh();
    setPersonalDrag(null);
    setPersonalDrop(null);
  };

  // Clone a built-in or user template into a fresh user-template entry
  // and select it so the user can immediately rename / tweak.
  const cloneToUser = (t: CommandTemplate) => {
    const saved = saveUserTemplate({
      name: `${t.name} (copy)`,
      subcategory: t.subcategory,
      description: t.description,
      body: t.body,
      lineDelayMs: t.lineDelayMs,
      variables: t.variables,
    });
    refresh();
    setSelection({ kind: "user", id: saved.id });
  };

  const openUserMenu = (e: React.MouseEvent, t: UserTemplate) => {
    setMenu({
      pos: captureContextMenu(e),
      items: [
        { label: "Edit", onClick: () => setSelection({ kind: "user", id: t.id }) },
        { label: "Duplicate", onClick: () => cloneToUser(t) },
        { divider: true },
        {
          label: "Delete\u2026",
          danger: true,
          onClick: () => {
            if (!window.confirm(`Delete template \u201C${t.name}\u201D?`)) return;
            deleteUserTemplate(t.id);
            refresh();
            setSelection((cur) => (cur.kind === "user" && cur.id === t.id ? { kind: "none" } : cur));
          },
        },
        { divider: true },
        { label: "New template", onClick: () => setSelection({ kind: "new" }) },
        { divider: true },
        ...navItems,
      ],
    });
  };

  const toggleTreeGroup = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openPersonalGroupMenu = (e: React.MouseEvent, group: string) => {
    setMenu({
      pos: captureContextMenu(e),
      items: [
        { label: "New template in group", onClick: () => setSelection({ kind: "new", group }) },
        { label: "Rename group…", onClick: () => setGroupDialog({ mode: "rename", current: group, value: group, error: "" }) },
        { divider: true },
        {
          label: "Delete group…",
          danger: true,
          onClick: () => {
            if (!window.confirm(`Delete group “${group}”? Templates in it will move to Ungrouped.`)) return;
            deleteUserTemplateGroup(group);
            refresh();
          },
        },
      ],
    });
  };

  const openBuiltinMenu = (e: React.MouseEvent, t: CommandTemplate) => {
    setMenu({
      pos: captureContextMenu(e),
      items: [
        { label: "Preview", onClick: () => setSelection({ kind: "builtin", id: t.id }) },
        { label: "Duplicate to my templates", onClick: () => cloneToUser(t) },
        { divider: true },
        { label: "New template", onClick: () => setSelection({ kind: "new" }) },
        { divider: true },
        ...navItems,
      ],
    });
  };

  const openPageMenu = (e: React.MouseEvent) => {
    setMenu({
      pos: captureContextMenu(e),
      items: [
        { label: "New template", onClick: () => setSelection({ kind: "new" }) },
        { label: "Clear selection", disabled: selection.kind === "none", onClick: () => setSelection({ kind: "none" }) },
        { label: "Clear search", disabled: !search, onClick: () => setSearch("") },
        { divider: true },
        ...navItems,
      ],
    });
  };

  // Built-in templates organised by category, matching the right-click
  // menu grouping so users see the same hierarchy in both places.
  const builtinTree = useMemo(() => groupTemplatesForMenu(), []);

  const filter = (t: CommandTemplate): boolean => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.subcategory ?? "").toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  };

  const filteredUser = useMemo(() => userTpls.filter(filter), [userTpls, search]);
  const personalTree = useMemo(() => {
    const groups = personalGroups.map((name) => ({
      name,
      templates: filteredUser.filter((template) => (template.subcategory ?? "").trim().toLocaleLowerCase() === name.toLocaleLowerCase()),
    }));
    const ungrouped = filteredUser.filter((template) => !(template.subcategory ?? "").trim());
    if (ungrouped.length > 0) groups.push({ name: "", templates: ungrouped });
    return search.trim() ? groups.filter((group) => group.templates.length > 0) : groups;
  }, [personalGroups, filteredUser, search]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filteredBuiltins = useMemo(() => {
    return builtinTree.map((node) => ({
      ...node,
      groups: node.groups
        .map((g) => ({ ...g, templates: g.templates.filter(filter) }))
        .filter((g) => g.templates.length > 0),
    })).filter((node) => node.groups.length > 0);
  }, [builtinTree, search]);

  return (
    <div
      className={`templates-page workspace-page--${appearance.workspaceDesign}`}
      style={{ display: "flex", height: "100%", minHeight: 0, overflow: "hidden" }}
      onContextMenu={openPageMenu}
    >
      <aside className="templates-sidebar" style={leftRailStyle}>
        <div style={{ padding: "12px 4px 10px" }}>
          <div style={{ display: "grid", gap: 14 }}>
            <h1 className="page-view-title" style={{ margin: 0, fontSize: 16 }}>Templates</h1>
            <div style={{ display: "flex", justifyContent: "flex-start", gap: 6 }}>
              <button
                type="button"
                onClick={() => setGroupDialog({ mode: "create", value: "", error: "" })}
                style={{ ...btnStyle, padding: "5px 8px" }}
              >
                <NotesIcon name="group" size={15} />
                Group
              </button>
              <button
                type="button"
                onClick={() => setSelection({ kind: "new" })}
                style={{ ...btnStyle, padding: "5px 8px" }}
              >
                <NotesIcon name="add" size={15} />
                Template
              </button>
            </div>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates"
            style={{ ...inputStyle, marginTop: 8 }}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "0 4px 12px" }}>
          <section className={`template-tree-root-card${personalOpen || search.trim() ? " is-open" : ""}`}>
            <TreeRootRow
              label="Personal"
              count={filteredUser.length}
              open={search.trim() ? true : personalOpen}
              onClick={() => setPersonalOpen((open) => !open)}
            />
            {(personalOpen || search.trim()) && (
              <div style={{ paddingLeft: 4 }}>
              {personalTree.map((group) => {
                const key = group.name || "__ungrouped__";
                const open = search.trim() ? true : openPersonalGroups.has(key);
                return (
                  <div key={key} className="template-tree-group-card">
                    <TreeGroupRow
                      label={group.name || "Ungrouped"}
                      count={group.templates.length}
                      open={open}
                      onClick={() => toggleTreeGroup(setOpenPersonalGroups, key)}
                      onContextMenu={group.name ? (event) => openPersonalGroupMenu(event, group.name) : undefined}
                      onAdd={group.name ? () => setSelection({ kind: "new", group: group.name }) : () => setSelection({ kind: "new" })}
                      draggable={!search.trim() && !!group.name}
                      dragging={personalDrag?.kind === "group" && personalDrag.group === group.name}
                      dropPlacement={personalDrop?.kind === "group" && personalDrop.key === key ? personalDrop.placement : undefined}
                      onDragStart={(event) => {
                        if (!group.name) return;
                        event.stopPropagation();
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", `template-group:${group.name}`);
                        setPersonalDrag({ kind: "group", group: group.name });
                      }}
                      onDragOver={(event) => {
                        if (!personalDrag || (personalDrag.kind === "group" && !group.name)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        setPersonalDrop({ kind: "group", key, placement: verticalDropPlacement(event) });
                      }}
                      onDrop={(event) => {
                        if (!personalDrag) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const placement = verticalDropPlacement(event);
                        if (personalDrag.kind === "group" && group.name) {
                          reorderUserTemplateGroups(personalDrag.group, group.name, placement);
                        } else if (personalDrag.kind === "template") {
                          moveUserTemplate(personalDrag.id, group.name);
                        }
                        persistReorder();
                      }}
                      onDragEnd={() => { setPersonalDrag(null); setPersonalDrop(null); }}
                    />
                    {open && (
                      <ul style={{ ...listStyle, paddingLeft: 2 }}>
                        {group.templates.map((template) => (
                          <TemplateRow
                            key={template.id}
                            template={template}
                            selected={selection.kind === "user" && selection.id === template.id}
                            onClick={() => setSelection({ kind: "user", id: template.id })}
                            onContextMenu={(event) => openUserMenu(event, template)}
                            draggable={!search.trim()}
                            dragging={personalDrag?.kind === "template" && personalDrag.id === template.id}
                            dropPlacement={personalDrop?.kind === "template" && personalDrop.key === template.id ? personalDrop.placement : undefined}
                            onDragStart={(event) => {
                              event.stopPropagation();
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", `template:${template.id}`);
                              setPersonalDrag({ kind: "template", id: template.id });
                            }}
                            onDragOver={(event) => {
                              if (personalDrag?.kind !== "template" || personalDrag.id === template.id) return;
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = "move";
                              setPersonalDrop({ kind: "template", key: template.id, placement: verticalDropPlacement(event) });
                            }}
                            onDrop={(event) => {
                              if (personalDrag?.kind !== "template" || personalDrag.id === template.id) return;
                              event.preventDefault();
                              event.stopPropagation();
                              moveUserTemplate(personalDrag.id, group.name, template.id, verticalDropPlacement(event));
                              persistReorder();
                            }}
                            onDragEnd={() => { setPersonalDrag(null); setPersonalDrop(null); }}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {personalTree.length === 0 && (
                <div style={emptyHintStyle}>{search.trim() ? "No matches." : "No personal templates or groups yet."}</div>
              )}
              </div>
            )}
          </section>

          <section className={`template-tree-root-card${preconfiguredOpen || search.trim() ? " is-open" : ""}`}>
            <TreeRootRow
              label="Preconfigured"
              count={filteredBuiltins.reduce((count, node) => count + node.groups.reduce((sum, group) => sum + group.templates.length, 0), 0)}
              open={search.trim() ? true : preconfiguredOpen}
              onClick={() => setPreconfiguredOpen((open) => !open)}
            />
            {(preconfiguredOpen || search.trim()) && (
              <div style={{ paddingLeft: 4 }}>
              {filteredBuiltins.map((node) => {
                const templates = node.groups.flatMap((group) => group.templates);
                const open = search.trim() ? true : openPreconfiguredGroups.has(node.category);
                return (
                  <div key={node.category} className="template-tree-group-card">
                    <TreeGroupRow label={node.category} count={templates.length} open={open} onClick={() => toggleTreeGroup(setOpenPreconfiguredGroups, node.category)} />
                    {open && (
                      <ul style={{ ...listStyle, paddingLeft: 2 }}>
                        {templates.map((template) => (
                          <TemplateRow
                            key={template.id}
                            template={template}
                            builtin
                            selected={selection.kind === "builtin" && selection.id === template.id}
                            onClick={() => setSelection({ kind: "builtin", id: template.id })}
                            onContextMenu={(event) => openBuiltinMenu(event, template)}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              </div>
            )}
          </section>
        </div>
      </aside>

      <main className="templates-detail" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {selection.kind === "none" && (
          <EmptyDetail onNew={() => setSelection({ kind: "new" })} />
        )}

        {selection.kind === "new" && (
          <EditorPane
            key={`new:${selection.group ?? ""}`}
            initial={blankDraft(selection.group)}
            groups={personalGroups}
            onCancel={() => setSelection({ kind: "none" })}
            onSave={(d) => {
              const saved = saveUserTemplate({
                name: d.name,
                subcategory: d.subcategory,
                description: d.description,
                body: d.body,
                lineDelayMs: d.lineDelayMs,
                variables: variablesFromDraft(d),
              });
              refresh();
              setSelection({ kind: "user", id: saved.id });
            }}
          />
        )}

        {selection.kind === "user" && (() => {
          const t = userTpls.find((u) => u.id === selection.id);
          if (!t) return <EmptyDetail onNew={() => setSelection({ kind: "new" })} />;
          return (
            <EditorPane
              key={t.id}
              initial={draftFrom(t)}
              groups={personalGroups}
              onCancel={() => setSelection({ kind: "none" })}
              onSave={(d) => {
                saveUserTemplate({
                  id: d.id,
                  name: d.name,
                  subcategory: d.subcategory,
                  description: d.description,
                  body: d.body,
                  lineDelayMs: d.lineDelayMs,
                  variables: variablesFromDraft(d),
                });
                refresh();
              }}
              onDelete={() => {
                if (!window.confirm(`Delete template \u201C${t.name}\u201D?`)) return;
                deleteUserTemplate(t.id);
                refresh();
                setSelection({ kind: "none" });
              }}
              onDuplicate={() => {
                const saved = saveUserTemplate({
                  name: `${t.name} (copy)`,
                  subcategory: t.subcategory,
                  description: t.description,
                  body: t.body,
                  lineDelayMs: t.lineDelayMs,
                  variables: t.variables,
                });
                refresh();
                setSelection({ kind: "user", id: saved.id });
              }}
            />
          );
        })()}

        {selection.kind === "builtin" && (() => {
          const t = preconfiguredCommandTemplates().find((b) => b.id === selection.id);
          if (!t) return <EmptyDetail onNew={() => setSelection({ kind: "new" })} />;
          return (
            <BuiltinPreview
              key={t.id}
              template={t}
              onClone={() => {
                const saved = saveUserTemplate({
                  name: `${t.name} (copy)`,
                  subcategory: t.subcategory,
                  description: t.description,
                  body: t.body,
                  lineDelayMs: t.lineDelayMs,
                  variables: t.variables,
                });
                refresh();
                setSelection({ kind: "user", id: saved.id });
              }}
            />
          );
        })()}

      </main>
      {menu && (
        <ContextMenu
          position={menu.pos}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
      {groupDialog && (
        <TemplateGroupDialog
          state={groupDialog}
          onChange={setGroupDialog}
          onClose={() => setGroupDialog(null)}
          onSave={() => {
            try {
              const name = groupDialog.mode === "rename" && groupDialog.current
                ? renameUserTemplateGroup(groupDialog.current, groupDialog.value)
                : saveUserTemplateGroup(groupDialog.value);
              refresh();
              setPersonalOpen(true);
              setOpenPersonalGroups((current) => new Set([...current, name]));
              setGroupDialog(null);
            } catch (error) {
              setGroupDialog((current) => current ? {
                ...current,
                error: error instanceof Error ? error.message : String(error),
              } : null);
            }
          }}
        />
      )}
    </div>
  );
}

function TemplateGroupDialog({
  state,
  onChange,
  onClose,
  onSave,
}: {
  state: GroupDialogState;
  onChange: (state: GroupDialogState | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={dialogBackdropStyle}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={state.mode === "rename" ? "Rename template group" : "New template group"}
        onSubmit={(event) => { event.preventDefault(); onSave(); }}
        style={dialogCardStyle}
      >
        <h2 style={{ margin: "0 0 14px", fontSize: 18 }}>{state.mode === "rename" ? "Rename group" : "New group"}</h2>
        <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 600 }}>
          Group name
          <input autoFocus value={state.value} onChange={(event) => onChange({ ...state, value: event.target.value, error: "" })} style={inputStyle} />
        </label>
        {state.error && <p role="alert" style={{ color: "var(--danger, #ef5350)", fontSize: 12 }}>{state.error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnStyle}><NotesIcon name="cancel" size={15} />Cancel</button>
          <button type="submit" disabled={!state.value.trim()} style={{ ...btnStyle, ...primaryBtnStyle }}><NotesIcon name="save" size={15} />Save</button>
        </div>
      </form>
    </div>
  );
}

function variablesFromDraft(d: Draft): TemplateVar[] {
  return detectVariables(d.body).map<TemplateVar>((k) => {
    const meta = d.vars[k];
    return {
      key: k,
      label: meta?.label?.trim() || k,
      default: meta?.default ?? "",
      hint: meta?.hint?.trim() || undefined,
      secret: meta?.secret || undefined,
      multiline: meta?.multiline || undefined,
    };
  });
}

// ─────────────────────────────── List ────────────────────────────────

function TreeRootRow({ label, count, open, onClick }: { label: string; count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`template-tree-root-row${open ? " is-open" : ""}`}
      onClick={onClick}
      style={{
        width: "100%",
        padding: "10px 10px 7px",
        color: "var(--fg)",
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        display: "flex",
        alignItems: "center",
        gap: 7,
        cursor: "pointer",
      }}
    >
      <span aria-hidden style={{ color: "var(--muted)", width: 10 }}>{open ? "▾" : "▸"}</span>
      <span>{label}</span>
      <span style={{ color: "var(--muted)", fontWeight: 500, marginLeft: "auto" }}>{count}</span>
    </button>
  );
}

function TreeGroupRow({
  label,
  count,
  open,
  onClick,
  onContextMenu,
  onAdd,
  draggable,
  dragging,
  dropPlacement,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  label: string;
  count: number;
  open: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onAdd?: () => void;
  draggable?: boolean;
  dragging?: boolean;
  dropPlacement?: "before" | "after";
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`template-tree-group-heading${dragging ? " is-dragging" : ""}${dropPlacement ? ` drop-${dropPlacement}` : ""}`}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ display: "flex", alignItems: "center", marginTop: 3 }}
    >
      <button type="button" onClick={onClick} onContextMenu={onContextMenu} style={treeGroupButtonStyle}>
        <span aria-hidden style={{ color: "var(--muted)", width: 10 }}>{open ? "▾" : "▸"}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 10 }}>{count}</span>
      </button>
      {onAdd && (
        <button
          type="button"
          aria-label={`Add template to ${label}`}
          title={`Add template to ${label}`}
          onClick={(event) => { event.stopPropagation(); onAdd(); }}
          style={treeAddButtonStyle}
        ><NotesIcon name="add" size={14} />
        </button>
      )}
    </div>
  );
}

function TemplateRow({
  template, selected, onClick, builtin, badge, onContextMenu, draggable, dragging, dropPlacement,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  template: CommandTemplate;
  selected: boolean;
  onClick: () => void;
  builtin?: boolean;
  badge?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
  draggable?: boolean;
  dragging?: boolean;
  dropPlacement?: "before" | "after";
  onDragStart?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLLIElement>) => void;
}) {
  return (
    <li
      className={`template-tree-template${selected ? " selected" : ""}${dragging ? " is-dragging" : ""}${dropPlacement ? ` drop-${dropPlacement}` : ""}`}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      title={draggable ? "Drag to reorder or move to another group" : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        style={{
          ...rowBtnStyle,
          background: selected ? "var(--accent)" : "var(--app-row-bg, var(--bg))",
          color: selected ? "#000" : "var(--fg)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontSize: 12, fontWeight: 600 }}>
              {template.name}
            </span>
            {(badge || builtin) && (
              <span style={{ fontSize: 9, opacity: 0.7, border: "1px solid currentColor", borderRadius: 2, padding: "0 4px" }}>
                {badge ?? "BUILT-IN"}
              </span>
            )}
          </div>
          {template.subcategory && (
            <span style={{ fontSize: 10, opacity: 0.75 }}>{template.subcategory}</span>
          )}
        </div>
      </button>
    </li>
  );
}

// ─────────────────────────────── Detail ──────────────────────────────

function EmptyDetail({ onNew }: { onNew: () => void }) {
  return (
    <div style={{ padding: 40, color: "var(--muted)" }}>
      <h2 style={{ marginTop: 0 }}>Templates</h2>
      <p>
        Select a template on the left to edit (your templates) or preview
        (built-ins).
      </p>
      <p>
        Built-in templates are read-only. Use{" "}
        <b>Duplicate to my templates</b> to create an editable copy.
      </p>
      <button type="button" onClick={onNew} style={{ ...btnStyle, ...primaryBtnStyle }}>
        <NotesIcon name="add" size={15} />
        New template
      </button>
    </div>
  );
}

function BuiltinPreview({ template, onClone }: { template: CommandTemplate; onClone: () => void }) {
  return (
    <div style={detailPadStyle}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {template.category}{template.subcategory ? ` \u00B7 ${template.subcategory}` : ""}
          </div>
          <h2 style={{ margin: "4px 0 0" }}>{template.name}</h2>
          {template.description && (
            <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 0 }}>
              {template.description}
            </p>
          )}
        </div>
        <button type="button" onClick={onClone} style={{ ...btnStyle, ...primaryBtnStyle, whiteSpace: "nowrap" }}>
          <NotesIcon name="add" size={15} />
          Duplicate to my templates
        </button>
      </header>

      {(template.variables ?? []).length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div style={sectionLabelStyle}>Variables</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {(template.variables ?? []).map((v) => (
              <li key={v.key} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                <code style={{ ...codeStyle, minWidth: 140 }}>{`{{${v.key}}}`}</code>
                <span>{v.label}</span>
                {v.default && <span style={{ color: "var(--muted)" }}>default: {v.secret ? "\u2022\u2022\u2022\u2022" : v.default}</span>}
                {v.secret && <span style={{ color: "var(--muted)" }}>(secret)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div style={sectionLabelStyle}>Body</div>
        <pre style={previewStyle}>{renderTemplate(template.body, defaultsOf(template))}</pre>
      </section>
    </div>
  );
}

function defaultsOf(t: CommandTemplate): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of t.variables ?? []) out[v.key] = v.default ?? `{{${v.key}}}`;
  return out;
}

// ─────────────────────────────── Editor ──────────────────────────────

function EditorPane({
  initial, groups, onCancel, onSave, onDelete, onDuplicate,
}: {
  initial: Draft;
  groups: string[];
  onCancel: () => void;
  onSave: (d: Draft) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  // The parent intentionally keys this editor by the selected template. Do
  // not reset from `initial` on ordinary parent renders: draftFrom() returns a
  // fresh object and the 60-second server-template refresh would otherwise
  // replace unsaved text while the user is typing.

  const detected = useMemo(() => detectVariables(d.body), [d.body]);
  useEffect(() => {
    setD((prev) => {
      let changed = false;
      const next = { ...prev.vars };
      for (const k of detected) {
        if (!next[k]) {
          next[k] = { label: k, default: "", hint: "", secret: false, multiline: false };
          changed = true;
        }
      }
      return changed ? { ...prev, vars: next } : prev;
    });
  }, [detected]);

  const preview = useMemo(() => {
    const values: Record<string, string> = {};
    for (const k of detected) values[k] = d.vars[k]?.default || `{{${k}}}`;
    return renderTemplate(d.body, values);
  }, [d.body, d.vars, detected]);

  const valid = d.name.trim().length > 0 && d.body.trim().length > 0;
  const isNew = !d.id;

  return (
    <div style={detailPadStyle}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{isNew ? "New template" : "Edit template"}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          {onDuplicate && (
            <button type="button" onClick={onDuplicate} style={btnStyle}><NotesIcon name="add" size={15} />Duplicate</button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} style={{ ...btnStyle, ...dangerBtnStyle }}><NotesIcon name="delete" size={15} />Delete</button>
          )}
          <button type="button" onClick={onCancel} style={btnStyle}>
            <NotesIcon name="cancel" size={15} />
            {isNew ? "Cancel" : "Close"}
          </button>
          <button
            type="button"
            onClick={() => valid && onSave(d)}
            disabled={!valid}
            style={{ ...btnStyle, ...primaryBtnStyle, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }}
            title={valid ? "Save template" : "Name and body are required"}
          >
            <NotesIcon name={isNew ? "add" : "save"} size={15} />
            {isNew ? "Create" : "Save changes"}
          </button>
        </div>
      </header>

      <div className="template-editor-meta-grid">
        <Labeled label="Name">
          <input
            type="text"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="e.g. Wipe interface counters"
            style={inputStyle}
            autoFocus
          />
        </Labeled>
        <Labeled label="Group">
          <ThemedSelect
            ariaLabel="Template group"
            value={d.subcategory}
            onChange={(value) => setD({ ...d, subcategory: value })}
            style={{ width: "100%" }}
            options={[
              { value: "", label: "Ungrouped" },
              ...groups.map((group) => ({ value: group, label: group })),
              ...(d.subcategory && !groups.includes(d.subcategory)
                ? [{ value: d.subcategory, label: d.subcategory }]
                : []),
            ]}
          />
        </Labeled>
      </div>

      <Labeled label="Description (optional)">
        <input
          type="text"
          value={d.description}
          onChange={(e) => setD({ ...d, description: e.target.value })}
          placeholder="One-line summary shown in the picker"
          style={inputStyle}
        />
      </Labeled>

      <div className="template-editor-workspace">
        <Labeled label="Body (use {{name}} for prompts)">
          <textarea
            value={d.body}
            onChange={(e) => setD({ ...d, body: e.target.value })}
            rows={18}
            style={{ ...inputStyle, fontFamily: "var(--mono, monospace)", whiteSpace: "pre" }}
            placeholder={"configure terminal\ninterface {{intf}}\n description {{desc}}\nend\nwrite memory"}
            spellCheck={false}
          />
        </Labeled>
      </div>

      {detected.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <div style={sectionLabelStyle}>Variables ({detected.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {detected.map((k) => {
              const meta = d.vars[k] ?? { label: k, default: "", hint: "", secret: false, multiline: false };
              const update = (patch: Partial<VarMeta>) =>
                setD({ ...d, vars: { ...d.vars, [k]: { ...meta, ...patch } } });
              return (
                <div key={k} style={varRowStyle}>
                  <code style={{ ...codeStyle, color: "var(--accent)", minWidth: 110 }}>{`{{${k}}}`}</code>
                  <input
                    type="text"
                    value={meta.label}
                    onChange={(e) => update({ label: e.target.value })}
                    placeholder="Label"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    type="text"
                    value={meta.default}
                    onChange={(e) => update({ default: e.target.value })}
                    placeholder="Default"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <input
                    type="text"
                    value={meta.hint}
                    onChange={(e) => update({ hint: e.target.value })}
                    placeholder="Hint (optional)"
                    style={{ ...inputStyle, flex: 1.2 }}
                  />
                  <span style={varSwitchLabelStyle}>
                    <Switch
                      checked={meta.secret}
                      onChange={(checked) => update({ secret: checked })}
                      ariaLabel={`${k} secret`}
                    />
                    <span>Secret</span>
                  </span>
                  <span style={varSwitchLabelStyle}>
                    <Switch
                      checked={meta.multiline}
                      onChange={(checked) => update({ multiline: checked })}
                      ariaLabel={`${k} multiline`}
                    />
                    <span>Multiline</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          Default send rate:
          <ThemedSelect
            ariaLabel="Default template send rate"
            value={String(d.lineDelayMs)}
            onChange={(value) => setD({ ...d, lineDelayMs: Number(value) })}
            style={{ minWidth: 150 }}
            options={DELAY_OPTIONS.map((option) => ({ value: String(option.ms), label: option.label }))}
          />
        </label>
      </section>

      <div className="template-editor-preview">
        <Labeled label="Preview (defaults substituted)">
          <pre style={previewStyle}>{preview}</pre>
        </Labeled>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────── Styles ──────────────────────────────

const leftRailStyle: React.CSSProperties = {
  width: 280,
  borderRight: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  background: "var(--app-structural-bg, var(--bg))",
  flexShrink: 0,
};

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
};

const rowBtnStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  background: "transparent",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  padding: "6px 10px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
};

const treeGroupButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 7,
  padding: "6px 8px",
  border: 0,
  borderRadius: 4,
  background: "transparent",
  color: "var(--fg)",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  cursor: "pointer",
};

const treeAddButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  padding: 0,
  border: 0,
  borderRadius: 4,
  background: "transparent",
  color: "var(--muted)",
  fontSize: 17,
  cursor: "pointer",
};

const emptyHintStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--muted)",
};

const detailPadStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 1200,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--muted)",
  marginBottom: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--fg)",
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  background: "var(--input-bg)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  padding: "4px 8px",
  font: "inherit",
  fontSize: 12,
  boxSizing: "border-box",
  width: "100%",
};

const previewStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  background: "var(--input-bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  minHeight: 220,
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const btnStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--accent)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  padding: "5px 14px",
  fontSize: 12,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};

const dialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1400,
  background: "rgba(0,0,0,0.5)",
  display: "grid",
  placeItems: "center",
  padding: 24,
};

const dialogCardStyle: React.CSSProperties = {
  width: "min(460px, 100%)",
  background: "var(--surface-bg, var(--bg))",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "transparent",
  borderColor: "var(--accent)",
  color: "var(--accent)",
  fontWeight: 600,
};

const dangerBtnStyle: React.CSSProperties = {
  background: "transparent",
  borderColor: "var(--danger, #ef6b6b)",
  color: "var(--danger, #ef6b6b)",
};

const varRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
  rowGap: 6,
  padding: "4px 0",
};

const varSwitchLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
  minWidth: 96,
  fontSize: 11,
  color: "var(--muted)",
};

const codeStyle: React.CSSProperties = {
  fontFamily: "var(--mono, monospace)",
  background: "var(--input-bg)",
  padding: "1px 4px",
  borderRadius: 3,
  fontSize: 12,
};
