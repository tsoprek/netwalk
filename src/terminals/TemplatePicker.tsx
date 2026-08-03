// Lightweight modal that prompts for any `{{variable}}` declared on a
// CommandTemplate, then sends the rendered body to the caller via
// onSend. Keeps secrets in masked inputs but renders them as plain
// text in the body — sending to a router CLI is what the user asked
// for; nothing here is HTML-injection sensitive.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CommandTemplate,
  TemplateVar,
  renderTemplate,
} from "./templates";
import PasswordInput from "../components/PasswordInput";
import ThemedSelect from "../components/ThemedSelect";

interface Props {
  template: CommandTemplate;
  /// Optional target description shown in the header ("Active tab",
  /// `Group "core"`, …). Purely informational.
  targetLabel?: string;
  onCancel: () => void;
  onSend: (renderedBody: string, lineDelayMs: number) => void | Promise<void>;
}

const DELAY_OPTIONS: Array<{ ms: number; label: string }> = [
  { ms: 0,   label: "Paste (instant)" },
  { ms: 30,  label: "Fast (30 ms)" },
  { ms: 60,  label: "Default (60 ms)" },
  { ms: 150, label: "Slow (150 ms)" },
  { ms: 400, label: "Very slow (400 ms)" },
];

export default function TemplatePicker({ template, targetLabel, onCancel, onSend }: Props) {
  // Pre-fill from defaults. The picker is intentionally uncontrolled-
  // looking from the user's perspective but we keep all values in state
  // so the live preview re-renders on every keystroke.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of template.variables ?? []) init[v.key] = v.default ?? "";
    return init;
  });
  const [lineDelayMs, setLineDelayMs] = useState<number>(template.lineDelayMs ?? 60);
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Focus the first prompt field so the user can start typing immediately.
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Esc → cancel; Cmd/Ctrl+Enter → send. Document-level so it works
  // regardless of which field is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void onSend(rendered, lineDelayMs);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, lineDelayMs]);

  const rendered = useMemo(() => renderTemplate(template.body, values), [template.body, values]);
  // Any placeholder left as `{{…}}` after substitution is an undeclared
  // (or accidentally typed) variable — surface it so the user can fix
  // before sending instead of pasting `{{te_token}}` into a router CLI.
  const missing = useMemo(() => {
    const out = new Set<string>();
    rendered.replace(/\{\{(\w+)\}\}/g, (_m, k) => { out.add(k); return _m; });
    return [...out];
  }, [rendered]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Template: ${template.name}`}
      style={overlayStyle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <form
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void onSend(rendered, lineDelayMs);
        }}
      >
        <header style={headerStyle}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{template.name}</div>
            {template.description && (
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
                {template.description}
              </div>
            )}
            {targetLabel && (
              <div style={{ color: "var(--accent)", fontSize: 12, marginTop: 4 }}>
                Target: {targetLabel}
              </div>
            )}
          </div>
          <button type="button" onClick={onCancel} style={closeBtnStyle} aria-label="Cancel">×</button>
        </header>

        <div style={bodyStyle}>
          {(template.variables ?? []).length > 0 && (
            <section style={{ marginBottom: 12 }}>
              <div style={sectionLabelStyle}>Variables</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(template.variables ?? []).map((v, i) => (
                  <Field
                    key={v.key}
                    variable={v}
                    value={values[v.key] ?? ""}
                    autofocusRef={i === 0 ? firstInputRef : undefined}
                    onChange={(next) => setValues((prev) => ({ ...prev, [v.key]: next }))}
                  />
                ))}
              </div>
            </section>
          )}

          <section style={{ marginBottom: 8 }}>
            <div style={sectionLabelStyle}>
              Preview {missing.length > 0 && (
                <span style={{ color: "#c62828", marginLeft: 8 }}>
                  Missing: {missing.join(", ")}
                </span>
              )}
            </div>
            <pre style={previewStyle}>{rendered}</pre>
          </section>
        </div>

        <footer style={footerStyle}>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
            Send rate:
            <ThemedSelect
              ariaLabel="Template send rate"
              value={String(lineDelayMs)}
              onChange={(value) => setLineDelayMs(Number(value))}
              style={{ minWidth: 150 }}
              options={DELAY_OPTIONS.map((option) => ({ value: String(option.ms), label: option.label }))}
            />
          </label>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onCancel} style={btnStyle}>Cancel</button>
          <button
            type="submit"
            style={{ ...btnStyle, ...primaryBtnStyle }}
            title="Send (Enter or Cmd/Ctrl+Enter)"
          >Send</button>
        </footer>
      </form>
    </div>
  );
}

interface FieldProps {
  variable: TemplateVar;
  value: string;
  onChange: (next: string) => void;
  autofocusRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}

function Field({ variable, value, onChange, autofocusRef }: FieldProps) {
  const id = `tpl-${variable.key}`;
  const common = {
    id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    style: inputStyle,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={fieldLabelStyle}>{variable.label}</label>
      {variable.multiline
        ? <textarea ref={autofocusRef as React.RefObject<HTMLTextAreaElement>} rows={3} {...common} />
        : variable.secret
          ? <PasswordInput
              ref={autofocusRef as React.RefObject<HTMLInputElement>}
              autoComplete="off"
              {...common}
            />
          : <input
              ref={autofocusRef as React.RefObject<HTMLInputElement>}
              type="text"
              autoComplete="off"
              {...common}
            />}
      {variable.hint && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{variable.hint}</div>
      )}
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
  width: "min(720px, 92vw)",
  maxHeight: "90vh",
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

const previewStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  background: "var(--input-bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  maxHeight: 260,
  overflow: "auto",
  fontFamily: "var(--mono, monospace)",
  fontSize: 12,
  whiteSpace: "pre",
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
