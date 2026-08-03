// Manager modal for user-defined templates: lists existing ones with
// Edit/Duplicate/Delete and switches into an inline editor view for
// create/edit. Auto-detects `{{key}}` placeholders in the body and
// surfaces them as editable variable rows (label/default/secret/
// multiline). Persists through userTemplates.ts.

import { useEffect, useMemo, useState } from "react";
import type { TemplateVar } from "./templates";
import {
  USER_TEMPLATE_CATEGORY,
  UserTemplate,
  deleteUserTemplate,
  detectVariables,
  listUserTemplates,
  saveUserTemplate,
} from "./userTemplates";
import Switch from "../components/Switch";
import ThemedSelect from "../components/ThemedSelect";

interface Props {
  onClose: () => void;
  /// Called whenever the user template set changes so callers can
  /// refresh their cached copy used by groupTemplatesForMenu.
  onChange?: () => void;
}

type View =
  | { kind: "list" }
  | { kind: "edit"; draft: Draft };

interface Draft {
  id?: string;
  name: string;
  subcategory: string;
  description: string;
  body: string;
  lineDelayMs: number;
  /// Variable metadata keyed by var key; auto-synced with body scan.
  vars: Record<string, VarMeta>;
}

interface VarMeta {
  label: string;
  default: string;
  hint: string;
  secret: boolean;
  multiline: boolean;
}

const DELAY_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 0,   label: "Paste (instant)" },
  { ms: 30,  label: "Fast (30 ms)" },
  { ms: 60,  label: "Default (60 ms)" },
  { ms: 150, label: "Slow (150 ms)" },
  { ms: 400, label: "Very slow (400 ms)" },
];

function blankDraft(): Draft {
  return {
    name: "",
    subcategory: "",
    description: "",
    body: "",
    lineDelayMs: 60,
    vars: {},
  };
}

function draftFromTemplate(t: UserTemplate): Draft {
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
    id: t.id,
    name: t.name,
    subcategory: t.subcategory ?? "",
    description: t.description ?? "",
    body: t.body,
    lineDelayMs: t.lineDelayMs ?? 60,
    vars,
  };
}

export default function TemplatesManager({ onClose, onChange }: Props) {
  const [items, setItems] = useState<UserTemplate[]>(() => listUserTemplates());
  const [view, setView] = useState<View>({ kind: "list" });

  const refresh = () => {
    setItems(listUserTemplates());
    onChange?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (view.kind === "edit") setView({ kind: "list" });
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [view.kind, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage my templates"
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {view.kind === "list" ? "My templates" : (view.draft.id ? "Edit template" : "New template")}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              {view.kind === "list"
                ? `${items.length} saved \u2022 stored in this browser`
                : `Saved under category \u201C${USER_TEMPLATE_CATEGORY}\u201D`}
            </div>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="Close">×</button>
        </header>

        {view.kind === "list" ? (
          <ListView
            items={items}
            onNew={() => setView({ kind: "edit", draft: blankDraft() })}
            onEdit={(t) => setView({ kind: "edit", draft: draftFromTemplate(t) })}
            onDuplicate={(t) => {
              const d = draftFromTemplate(t);
              d.id = undefined;
              d.name = `${t.name} (copy)`;
              setView({ kind: "edit", draft: d });
            }}
            onDelete={(t) => {
              if (!window.confirm(`Delete template \u201C${t.name}\u201D?`)) return;
              deleteUserTemplate(t.id);
              refresh();
            }}
          />
        ) : (
          <EditorView
            draft={view.draft}
            onCancel={() => setView({ kind: "list" })}
            onSave={(d) => {
              saveUserTemplate({
                id: d.id,
                name: d.name,
                subcategory: d.subcategory,
                description: d.description,
                body: d.body,
                lineDelayMs: d.lineDelayMs,
                variables: detectVariables(d.body).map<TemplateVar>((k) => {
                  const meta = d.vars[k];
                  return {
                    key: k,
                    label: meta?.label?.trim() || k,
                    default: meta?.default ?? "",
                    hint: meta?.hint?.trim() || undefined,
                    secret: meta?.secret || undefined,
                    multiline: meta?.multiline || undefined,
                  };
                }),
              });
              refresh();
              setView({ kind: "list" });
            }}
          />
        )}
      </div>
    </div>
  );
}

interface ListProps {
  items: UserTemplate[];
  onNew: () => void;
  onEdit: (t: UserTemplate) => void;
  onDuplicate: (t: UserTemplate) => void;
  onDelete: (t: UserTemplate) => void;
}

function ListView({ items, onNew, onEdit, onDuplicate, onDelete }: ListProps) {
  return (
    <>
      <div style={bodyStyle}>
        {items.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13, padding: "16px 4px" }}>
            No saved templates yet. Click <b>New template</b> to create one. Use{" "}
            <code style={codeStyle}>{"{{variable}}"}</code> placeholders in the body to prompt for
            values when sending.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((t) => (
              <li key={t.id} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {t.name}
                    {t.subcategory && (
                      <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
                        {"\u00B7 "}{t.subcategory}
                      </span>
                    )}
                  </div>
                  {t.description && (
                    <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                      {t.description}
                    </div>
                  )}
                  <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 4 }}>
                    {(t.variables?.length ?? 0)} variable{(t.variables?.length ?? 0) === 1 ? "" : "s"}
                    {" \u2022 updated "}
                    {new Date(t.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => onEdit(t)} style={btnStyle}>Edit</button>
                  <button type="button" onClick={() => onDuplicate(t)} style={btnStyle}>Duplicate</button>
                  <button type="button" onClick={() => onDelete(t)} style={{ ...btnStyle, ...dangerBtnStyle }}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer style={footerStyle}>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onNew} style={{ ...btnStyle, ...primaryBtnStyle }}>
          New template
        </button>
      </footer>
    </>
  );
}

interface EditorProps {
  draft: Draft;
  onCancel: () => void;
  onSave: (d: Draft) => void;
}

function EditorView({ draft: initial, onCancel, onSave }: EditorProps) {
  const [d, setD] = useState<Draft>(initial);

  // Keep the var-meta map in sync with placeholders found in the body.
  // Adds fresh entries for newly-typed keys; preserves user-entered
  // meta when keys are removed (so a typo + retype doesn't wipe the
  // label) by leaving stale entries in place — they're harmless and
  // ignored at save-time via detectVariables(body).
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

  const valid = d.name.trim().length > 0 && d.body.trim().length > 0;

  return (
    <>
      <div style={bodyStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 12 }}>
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
          <Labeled label="Subcategory (optional)">
            <input
              type="text"
              value={d.subcategory}
              onChange={(e) => setD({ ...d, subcategory: e.target.value })}
              placeholder="e.g. Diagnostics"
              style={inputStyle}
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

        <div style={{ marginTop: 12 }}>
          <Labeled label={`Body (use {{name}} for prompts)`}>
            <textarea
              value={d.body}
              onChange={(e) => setD({ ...d, body: e.target.value })}
              rows={10}
              style={{ ...inputStyle, fontFamily: "var(--mono, monospace)", whiteSpace: "pre" }}
              placeholder={"configure terminal\ninterface {{intf}}\n description {{desc}}\nend\nwrite memory"}
            />
          </Labeled>
        </div>

        {detected.length > 0 && (
          <section style={{ marginTop: 12 }}>
            <div style={sectionLabelStyle}>Variables ({detected.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {detected.map((k) => {
                const meta = d.vars[k] ?? { label: k, default: "", hint: "", secret: false, multiline: false };
                const update = (patch: Partial<VarMeta>) =>
                  setD({ ...d, vars: { ...d.vars, [k]: { ...meta, ...patch } } });
                return (
                  <div key={k} style={varRowStyle}>
                    <div style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "var(--accent)", minWidth: 110 }}>
                      {`{{${k}}}`}
                    </div>
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
      </div>

      <footer style={footerStyle}>
        <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
          Default send rate:
          <ThemedSelect
            ariaLabel="Default send rate"
            value={String(d.lineDelayMs)}
            onChange={(value) => setD({ ...d, lineDelayMs: Number(value) })}
            style={{ minWidth: 150 }}
            options={DELAY_OPTIONS.map((option) => ({ value: String(option.ms), label: option.label }))}
          />
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
        <button
          type="button"
          onClick={() => valid && onSave(d)}
          disabled={!valid}
          style={{ ...btnStyle, ...primaryBtnStyle, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }}
          title={valid ? "Save template" : "Name and body are required"}
        >
          {d.id ? "Save changes" : "Save template"}
        </button>
      </footer>
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const modalStyle: React.CSSProperties = {
  width: "min(820px, 94vw)",
  maxHeight: "92vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--panel)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--fg)",
  border: 0,
  fontSize: 20,
  cursor: "pointer",
  lineHeight: 1,
};

const bodyStyle: React.CSSProperties = {
  padding: 16,
  overflowY: "auto",
  flex: 1,
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

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderTop: "1px solid var(--border)",
  background: "var(--panel)",
};

const btnStyle: React.CSSProperties = {
  background: "var(--input-bg)",
  color: "var(--fg)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  padding: "5px 14px",
  fontSize: 12,
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#000",
  fontWeight: 600,
};

const dangerBtnStyle: React.CSSProperties = {
  background: "#3a1414",
  borderColor: "#5a1f1f",
  color: "#ff8a8a",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 8px",
  borderBottom: "1px solid var(--border)",
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
