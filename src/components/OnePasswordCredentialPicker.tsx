import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  listOnePasswordLogins,
  onePasswordErrorMessage,
  resolveOnePasswordLogin,
  type OnePasswordCredentialRef,
  type OnePasswordItemOption,
} from "../api/onePassword";
import NotesIcon from "./NotesIcon";

interface Props {
  value: OnePasswordCredentialRef;
  onChange: (value: OnePasswordCredentialRef) => void;
  onResolved?: (username: string) => void;
  onClear?: () => void;
}

export default function OnePasswordCredentialPicker({ value, onChange, onResolved, onClear }: Props) {
  const [items, setItems] = useState<OnePasswordItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [tone, setTone] = useState<"error" | "success" | "info">("info");

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.title} ${item.vaultName} ${item.itemReference}`.toLocaleLowerCase().includes(needle));
  }, [items, query]);

  useEffect(() => {
    if (!chooserOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChooserOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  const clearStatus = () => {
    setStatus(null);
    setTone("info");
  };

  const openChooser = async () => {
    if (loading) return;
    setChooserOpen(true);
    setQuery("");
    setItems([]);
    setLoading(true);
    clearStatus();
    try {
      const nextItems = await listOnePasswordLogins(value.account);
      setItems(nextItems);
      if (!nextItems.length) setStatus("No Login items found.");
    } catch (error) {
      setTone("error");
      setStatus(onePasswordErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const chooseItem = (itemReference: string) => {
    onChange({ ...value, itemReference });
    setChooserOpen(false);
    setItems([]);
    setQuery("");
    clearStatus();
  };

  return <>
    <div style={{ marginBottom: 12, border: "1px solid var(--border)", borderRadius: 6, padding: 10 }}>
    <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Account (optional)
      </span>
      <input
        aria-label="1Password account"
        placeholder="Account name or ID"
        value={value.account ?? ""}
        onChange={(event) => {
          setItems([]);
          clearStatus();
          onChange({ ...value, account: event.target.value || undefined });
        }}
      />
    </label>
    <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Login item
      </span>
      <input
        aria-label="1Password login item"
        placeholder="op://Vault/Login item"
        value={value.itemReference}
        onChange={(event) => {
          clearStatus();
          onChange({ ...value, itemReference: event.target.value });
        }}
      />
    </label>
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="outline-action-button btn-small"
        disabled={testing || !value.itemReference.trim()}
        style={{ cursor: testing ? "progress" : undefined }}
        onClick={async () => {
          setTesting(true);
          clearStatus();
          try {
            const login = await resolveOnePasswordLogin(value);
            onResolved?.(login.username);
            setTone("success");
            setStatus(`Matched username: ${login.username}`);
          } catch (error) {
            setTone("error");
            setStatus(onePasswordErrorMessage(error));
          } finally {
            setTesting(false);
          }
        }}
      >
        <NotesIcon name="test" size={15} />
        {testing ? "Authorizing…" : "Test connection"}
      </button>
      <button
        type="button"
        className="outline-action-button btn-small"
        disabled={loading}
        style={{ cursor: loading ? "progress" : undefined }}
        onClick={() => { void openChooser(); }}
      >
        <NotesIcon name="choose" size={15} />
        {loading ? "Loading…" : "Choose"}
      </button>
      {onClear && (
        <button
          type="button"
          className="outline-action-button outline-action-button--muted btn-small"
          disabled={!value.account?.trim() && !value.itemReference.trim()}
          onClick={() => {
            clearStatus();
            onClear();
          }}
          aria-label="Clear configured 1Password Login"
        >
          <NotesIcon name="remove" size={14} />
          Clear
        </button>
      )}
    </div>
    {status && !chooserOpen && <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        marginTop: 8,
        fontSize: 12,
        color: tone === "error"
          ? "var(--danger, #ef6b6b)"
          : tone === "success"
            ? "var(--success, #57c785)"
            : "var(--muted)",
        overflowWrap: "anywhere",
      }}
    >{status}</div>}
    </div>
    {chooserOpen && createPortal(
      <div className="modal-backdrop" onMouseDown={() => setChooserOpen(false)}>
        <section
          className="modal one-password-chooser"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a 1Password Login item"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="one-password-chooser__header">
            <div>
              <h3>Choose Login item</h3>
              <div>{value.account?.trim() ? `1Password account: ${value.account.trim()}` : "Available from 1Password"}</div>
            </div>
            <button
              type="button"
              className="one-password-chooser__close"
              onClick={() => setChooserOpen(false)}
              title="Close"
              aria-label="Close Login item chooser"
            >
              <NotesIcon name="cancel" size={18} />
            </button>
          </header>

          {!loading && items.length > 0 && <div className="one-password-chooser__search">
            <NotesIcon name="find" size={17} />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find by item or vault name"
              aria-label="Find 1Password Login item"
            />
          </div>}

          <div className="one-password-chooser__content">
            {loading && <div className="one-password-chooser__message" role="status">Loading Login items…</div>}
            {!loading && status && <div
              className={`one-password-chooser__message${tone === "error" ? " one-password-chooser__message--error" : ""}`}
              role={tone === "error" ? "alert" : "status"}
            >{status}</div>}
            {!loading && !status && filteredItems.length === 0 && <div className="one-password-chooser__message">
              No matching Login items.
            </div>}
            {!loading && filteredItems.map((item) => {
              const selected = item.itemReference === value.itemReference;
              return <button
                key={item.itemReference}
                type="button"
                className={`one-password-chooser__item${selected ? " is-selected" : ""}`}
                onClick={() => chooseItem(item.itemReference)}
                aria-pressed={selected}
              >
                <span className="one-password-chooser__item-title">{item.title}</span>
                <span className="one-password-chooser__item-vault">{item.vaultName}</span>
              </button>;
            })}
          </div>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
