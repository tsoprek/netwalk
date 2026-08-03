import { useEffect, useMemo, useState } from "react";
import {
  addIdentity,
  countIdentityUsage,
  getCurrentUserIdentityId,
  listIdentities,
  removeIdentity,
  subscribeIdentities,
  updateIdentity,
  type Identity,
} from "../api/identities";
import { useAppearance } from "../appearance/AppearanceContext";
import ContextMenu, {
  captureContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "../components/ContextMenu";
import NotesIcon from "../components/NotesIcon";
import PrivateKeyPathPicker from "../components/PrivateKeyPathPicker";
import { useNavMenuItems } from "../components/navMenu";

const SSH_KEY = "connecat.sshKeyPath";

export default function Identities() {
  const { appearance } = useAppearance();
  const [identities, setIdentities] = useState(listIdentities);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [sshKey, setSshKey] = useState(() => localStorage.getItem(SSH_KEY) ?? "");
  const [sshKeySaved, setSshKeySaved] = useState(false);
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; items: ContextMenuItem[] } | null>(null);
  const navItems = useNavMenuItems();
  const currentUserId = getCurrentUserIdentityId();
  const literals = useMemo(
    () => identities.filter((identity) => identity.id !== currentUserId),
    [currentUserId, identities],
  );
  const savedSshKey = localStorage.getItem(SSH_KEY) ?? "";

  useEffect(() => subscribeIdentities(() => setIdentities(listIdentities())), []);

  function cancelEditor() {
    setEditing(null);
    setAdding(false);
    setUsername("");
    setLabel("");
    setError("");
  }

  function startAdd() {
    cancelEditor();
    setAdding(true);
  }

  function startEdit(identity: Identity) {
    setAdding(false);
    setEditing(identity.id);
    setUsername(identity.username ?? "");
    setLabel(identity.label ?? "");
    setError("");
  }

  function saveIdentity() {
    const clean = username.trim();
    if (!clean) {
      setError("Username is required.");
      return;
    }
    const duplicate = literals.find((identity) => identity.username === clean && identity.id !== editing);
    if (duplicate) {
      setError(`A “${clean}” identity already exists.`);
      return;
    }
    if (editing) updateIdentity(editing, { username: clean, label: label.trim() });
    else addIdentity({ kind: "literal", username: clean, label: label.trim() || undefined, source: "manual" });
    cancelEditor();
  }

  function openIdentityMenu(event: React.MouseEvent, identity: Identity) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "Edit", onClick: () => startEdit(identity) },
        {
          label: "Copy username",
          disabled: !identity.username,
          onClick: () => void navigator.clipboard?.writeText(identity.username ?? ""),
        },
        { divider: true },
        { label: "Add identity", onClick: startAdd },
        { divider: true },
        { label: "Delete…", danger: true, onClick: () => setConfirmDelete(identity.id) },
        { divider: true },
        ...navItems,
      ],
    });
  }

  function openPageMenu(event: React.MouseEvent) {
    setMenu({
      pos: captureContextMenu(event),
      items: [
        { label: "Add identity", disabled: adding, onClick: startAdd },
        ...(adding ? [{ label: "Cancel new identity", onClick: cancelEditor } as ContextMenuItem] : []),
        { divider: true },
        ...navItems,
      ],
    });
  }

  function renderEditor(target: "new" | string) {
    return (
      <div className="identity-inline-editor">
        <div className="identity-inline-editor__fields">
          <label>
            <span>Username</span>
            <input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. admin, Administrator" />
          </label>
          <label>
            <span>Label (optional)</span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Personal, Lab admin" />
          </label>
        </div>
        {error && <div className="identity-inline-editor__error">{error}</div>}
        <div className="button-row identity-inline-editor__actions">
          <button type="button" onClick={saveIdentity}>
            <NotesIcon name={target === "new" ? "add" : "save"} size={15} />
            {target === "new" ? "Add identity" : "Save changes"}
          </button>
          <button type="button" onClick={cancelEditor}><NotesIcon name="cancel" size={15} /> Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`identities-page workspace-page--${appearance.workspaceDesign}`}
      data-renderer-reset-dirty={adding || editing || sshKey !== savedSshKey ? "true" : undefined}
      onContextMenu={openPageMenu}
    >
      <div className="identities-page-heading">
        <div>
          <h1 className="page-view-title">Identities</h1>
          <p>Usernames ConneCat uses when connecting to devices. Passwords are never stored in ConneCat.</p>
        </div>
      </div>

      <div className="identities-access-grid">
        <section className="identities-access-card identities-auth-card">
          <h2>Authentication</h2>
          <p>ConneCat uses your SSH agent, configured keys, and native connection clients. Credentials remain on this computer.</p>
        </section>
        <section className="identities-access-card identities-ssh-key-card">
          <h2>SSH Private Key</h2>
          <div className="form-row">
            <span className="setting-label">Private key path</span>
            <PrivateKeyPathPicker value={sshKey} onChange={(value) => { setSshKey(value); setSshKeySaved(false); }} />
          </div>
          <div className="ssh-identity-actions">
            <button
              type="button"
              className="outline-action-button btn-small"
              disabled={sshKey === savedSshKey}
              onClick={() => {
                if (sshKey.trim()) localStorage.setItem(SSH_KEY, sshKey.trim());
                else localStorage.removeItem(SSH_KEY);
                setSshKey(sshKey.trim());
                setSshKeySaved(true);
              }}
            >
              <NotesIcon name="save" size={15} /> Save key path
            </button>
            {sshKeySaved && <span className="muted">Saved.</span>}
          </div>
        </section>
      </div>

      <section className="identities-collection-card">
        <div className="identities-collection-heading">
          <div><h2>Users</h2><p>Connection usernames available to ConneCat.</p></div>
          {!adding && <button type="button" onClick={startAdd}><NotesIcon name="add" size={15} /> Add identity</button>}
        </div>

        {adding && renderEditor("new")}
        <div className="identities-compact-grid">
          <div className="identities-compact-cell">
            <IdentityCard title="Current user" subtitle="Resolves to your local login username at connect time." badge="Built-in" />
          </div>
          {literals.length === 0 && !adding && (
            <div className="identities-grid-full identities-empty-state">
              No custom identities yet. Add one when you connect with a different username.
            </div>
          )}
          {literals.map((identity) => {
            const isEditing = editing === identity.id;
            const usage = countIdentityUsage(identity.id);
            return (
              <div key={identity.id} className={isEditing ? "identities-grid-full" : "identities-compact-cell"}>
                {isEditing ? renderEditor(identity.id) : (
                  <IdentityCard
                    title={identity.username || "(empty)"}
                    subtitle={identity.label || (usage ? `Used by ${usage} assignment${usage === 1 ? "" : "s"}` : "Not assigned yet")}
                    onContextMenu={(event) => openIdentityMenu(event, identity)}
                    actions={
                      <div className="identity-card-actions">
                        <button className="outline-action-button outline-action-button--icon" type="button" onClick={() => startEdit(identity)} title={`Edit ${identity.username}`} aria-label={`Edit ${identity.username}`}><NotesIcon name="rename" size={15} /></button>
                        <button className="outline-action-button outline-action-button--icon outline-action-button--danger" type="button" onClick={() => setConfirmDelete(identity.id)} title={`Delete ${identity.username}`} aria-label={`Delete ${identity.username}`}><NotesIcon name="delete" size={15} /></button>
                      </div>
                    }
                  />
                )}
                {confirmDelete === identity.id && (
                  <div className="identity-delete-confirm">
                    <div>Delete identity <strong>{identity.username}</strong>{usage ? `? It is used by ${usage} assignment${usage === 1 ? "" : "s"}.` : "?"}</div>
                    <div className="button-row">
                      <button className="outline-action-button--danger" type="button" onClick={() => { removeIdentity(identity.id); setConfirmDelete(null); }}><NotesIcon name="delete" size={15} /> Delete</button>
                      <button type="button" onClick={() => setConfirmDelete(null)}><NotesIcon name="cancel" size={15} /> Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
      {menu && <ContextMenu position={menu.pos} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function IdentityCard({
  title,
  subtitle,
  badge,
  actions = null,
  onContextMenu,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: React.ReactNode;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <div className="identity-card" onContextMenu={onContextMenu} title={[title, subtitle].filter(Boolean).join(" — ")}>
      <div className="identity-card__copy">
        <div><strong>{title}</strong>{badge && <span className="identity-card__badge">{badge}</span>}</div>
      </div>
      {actions}
    </div>
  );
}
