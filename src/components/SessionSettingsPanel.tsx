import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Switch from "../components/Switch";
import {
  SavedSession,
  SessionGroup,
  RDP_RESOLUTION_PRESETS,
  type RdpResolutionPreset,
  effectiveSessionConnections,
  mergeSessionFormDraft,
  normalizedSessionTunnels,
  upsertSession,
} from "../api/sessions";
import {
  detectTerminals,
  detectSftpGuis,
  getUsername,
  getSshKeyPath,
  SftpGuiApp,
  SSH_APP_INAPP,
  SFTP_APP_INAPP,
  SFTP_APP_BROWSER,
  SFTP_APP_SYSTEM,
  BROWSE_OPEN_IN_APP,
  BROWSE_OPEN_WINDOW,
  BROWSE_OPEN_EXTERNAL,
  TerminalApp,
} from "../api/standalone";
import { useAppearance } from "../appearance/AppearanceContext";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import GuestOsIcon, { DEVICE_TYPE_OPTIONS } from "../components/GuestOsIcon";
import { normalizeOnePasswordItemReference } from "../api/onePassword";
import OnePasswordCredentialPicker from "./OnePasswordCredentialPicker";
import NotesIcon, { type NotesIconName } from "./NotesIcon";
import FieldInfo from "./FieldInfo";
import ThemedSelect from "./ThemedSelect";
import PrivateKeyPathPicker from "./PrivateKeyPathPicker";
import { effectiveRdpApp } from "../api/directRdp";
import {
  type Identity,
  addIdentity,
  findIdentityByUsername,
  getCurrentUserIdentityId,
  getSessionAssignment,
  listIdentities,
  removeAssignment,
  subscribeIdentities,
  upsertAssignment,
} from "../api/identities";

/// Mac- and Windows-specific external terminal app ids. Must stay in sync
/// with `launcher::detect()` in the Rust side. Anything not in these lists
/// falls back to the OS default.
const MAC_TERMINALS = ["Terminal", "iTerm", "Warp"] as const;
const WIN_TERMINALS = ["OpenSSH", "WindowsTerminal", "PuTTY", "KiTTY", "SecureCRT"] as const;

function serialDefaults(session: SavedSession) {
  return session.serial ?? {
    baudRate: 9600,
    dataBits: 8 as const,
    parity: "none" as const,
    stopBits: 1 as const,
    flowControl: "none" as const,
  };
}

function isWindows(): boolean {
  return navigator.userAgent.includes("Windows");
}
function isMacOs(): boolean {
  const ua = navigator.userAgent;
  return ua.includes("Macintosh") || ua.includes("Mac OS X");
}

interface Props {
  session: SavedSession;
  groups: SessionGroup[];
  onSaved: (s: SavedSession) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onConfigureTunnels?: () => void;
  tunnelCount?: number;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveRequest?: (save: (() => Promise<boolean>) | null) => void;
}

type SettingsSection = "connection" | "credentials" | "services" | "rdp" | "terminal" | "tunnels";

const FIELD_SECTIONS: Record<string, SettingsSection> = {
  Name: "connection",
  Group: "connection",
  Color: "connection",
  Icon: "connection",
  "Identity": "credentials",
  Authentication: "credentials",
  "Private key path": "credentials",
  "SSH — Open with": "terminal",
  "External terminal (macOS)": "terminal",
  "External terminal (Windows)": "terminal",
  Command: "terminal",
  "Scrollback (lines)": "terminal",
  "Save transcript": "terminal",
  "Transcript dir": "terminal",
  "SFTP — Open with": "services",
  "Browse — Open with": "services",
  "RDP domain": "rdp",
  "RDP port": "rdp",
  "RDP — Open with": "rdp",
  "RDP — Security layer": "rdp",
  "RDP — Connection quality": "rdp",
  "RDP — Resolution": "rdp",
};

/// Sectioned settings panel for a saved connection. The sidebar keeps the
/// connection, credentials, services, RDP, terminal, and tunnel options from
/// competing for attention while preserving a single draft and Save action.
export default function SessionSettingsPanel({
  session,
  groups,
  onSaved,
  onCancel,
  onDelete,
  onConfigureTunnels,
  onDirtyChange,
  onSaveRequest,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [s, setS] = useState<SavedSession>({ ...session });
  const [savedDraft, setSavedDraft] = useState<SavedSession>({ ...session });
  const [err, setErr] = useState<string | null>(null);
  const [terms, setTerms] = useState<TerminalApp[]>([]);
  const [sftpGuis, setSftpGuis] = useState<SftpGuiApp[]>([]);
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const { appearance } = useAppearance();
  const inheritedSshKey = getSshKeyPath();
  const [identities, setIdentities] = useState<Identity[]>(() => listIdentities());
  const [identityRows, setIdentityRows] = useState<string[]>(() => {
    const assignment = getSessionAssignment(session.id);
    return assignment
      ? [...assignment.identities].sort((a, b) => a.priority - b.priority).map((row) => row.identityId)
      : [];
  });
  const [savedIdentityRows, setSavedIdentityRows] = useState<string[]>(() => [...identityRows]);
  const [addingIdentity, setAddingIdentity] = useState(false);
  const [pickedIdentity, setPickedIdentity] = useState("");
  const [newIdentityUsername, setNewIdentityUsername] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSection>("connection");

  useEffect(() => subscribeIdentities(() => setIdentities(listIdentities())), []);

  useEffect(() => {
    let cancel = false;
    detectTerminals().then((list) => { if (!cancel) setTerms(list); }).catch(() => {});
    detectSftpGuis().then((g) => { if (!cancel) setSftpGuis(g); }).catch(() => {});
    invoke<string[]>("serial_ports").then((ports) => { if (!cancel) setSerialPorts(ports); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const root = rootRef.current;
      const active = document.activeElement;
      if (root && active instanceof Node && active !== document.body && !root.contains(active)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  function save(): boolean {
    if (!s.name.trim()) {
      setErr("Name is required");
      return false;
    }
    if (s.protocol !== "shell" && !s.host.trim()) {
      setErr(s.protocol === "console" ? "Serial port is required" : "Host is required");
      return false;
    }
    if (s.protocol === "console" && (s.serial?.baudRate ?? 9600) <= 0) {
      setErr("Serial speed must be greater than zero");
      return false;
    }
    if (s.rdpPort !== undefined
      && (!Number.isInteger(s.rdpPort) || s.rdpPort < 1 || s.rdpPort > 65535)) {
      setActiveSection("rdp");
      setErr("RDP port must be between 1 and 65535.");
      return false;
    }
    const normalizedTunnels = normalizedSessionTunnels(s);
    if (normalizedTunnels.length !== (s.sshTunnels?.length ?? 0)) {
      setActiveSection("tunnels");
      setErr("Each tunnel needs valid ports from 1 to 65535 and a destination without spaces. Duplicate tunnels are not allowed.");
      return false;
    }
    if (s.onePassword) {
      try {
        normalizeOnePasswordItemReference(s.onePassword!.itemReference);
      } catch (error) {
        setErr((error as Error).message);
        return false;
      }
    }
    const identityRowsToSave = pendingIdentityRows();
    setErr(null);
    if (identityRowsToSave.length === 0) {
      removeAssignment({ kind: "session", sessionId: s.id });
    } else {
      upsertAssignment({
        scope: { kind: "session", sessionId: s.id },
        identities: identityRowsToSave.map((identityId, priority) => ({ identityId, priority })),
        source: "self",
      });
    }
    const currentIdentities = listIdentities();
    const primaryIdentity = currentIdentities.find((identity) => identity.id === identityRowsToSave[0]);
    const primaryUsername = primaryIdentity?.kind === "current-user"
      ? (getUsername() ?? s.username)
      : (primaryIdentity?.username ?? s.username);
    const next = mergeSessionFormDraft({ ...s, username: primaryUsername, sshTunnels: normalizedTunnels });
    upsertSession(next);
    setS(next);
    setSavedDraft(next);
    setIdentities(currentIdentities);
    setIdentityRows(identityRowsToSave);
    setSavedIdentityRows(identityRowsToSave);
    clearPendingIdentity();
    onSaved(next);
    return true;
  }

  const dirty = useMemo(
    () => JSON.stringify(s) !== JSON.stringify(savedDraft)
      || JSON.stringify(identityRows) !== JSON.stringify(savedIdentityRows)
      || Boolean(pickedIdentity || newIdentityUsername.trim()),
    [identityRows, newIdentityUsername, pickedIdentity, s, savedDraft, savedIdentityRows],
  );

  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSaveRequest?.(async () => save());
    return () => onSaveRequest?.(null);
  });

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 4,
    fontSize: 12,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };

  const fieldClassName = (label: string): string => [
    "session-settings-field",
    FIELD_SECTIONS[label] === "terminal"
      ? "session-settings-field--full"
      : "",
    label === "Name" ? "session-settings-field--name" : "",
    label === "Group" ? "session-settings-field--group" : "",
    label === "Icon" ? "session-settings-field--icon" : "",
    label === "Color" ? "session-settings-field--color" : "",
    label === "Authentication" ? "session-settings-field--authentication" : "",
    label === "Identity" || label === "Private key path"
      ? "session-settings-field--credentials-stack-item"
      : "",
    label === "Identity" ? "session-settings-local-credentials-card-start" : "",
    label === "Private key path" ? "session-settings-local-credentials-card-end" : "",
  ].filter(Boolean).join(" ");

  const field = (lbl: string, body: React.ReactNode, hint?: string, infoHint = false) => (
    <div
      className={fieldClassName(lbl)}
      hidden={activeSection !== (FIELD_SECTIONS[lbl] ?? "connection")}
      style={{ marginBottom: 10 }}
    >
      <span style={infoHint ? { ...labelStyle, display: "flex", alignItems: "center", gap: 4 } : labelStyle}>
        {lbl}
        {hint && infoHint && <FieldInfo label={lbl} text={hint} />}
      </span>
      {body}
      {hint && !infoHint && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );

  // Width tiers for the left-column identity inputs. The user asked for
  // Name 3x, Group 2x, Host 4x, Username 2x relative to the original 8ch
  // compact size; numeric port stays compact.
  const nameStyle: React.CSSProperties = { width: "24ch" };
  const groupStyle: React.CSSProperties = { width: "16ch" };
  const hostStyle: React.CSSProperties = { width: "100%", maxWidth: "100%" };
  const userStyle: React.CSSProperties = { width: "16ch" };
  const portStyle: React.CSSProperties = { width: "100%" };
  const showsHostPort = s.protocol !== "web" && s.protocol !== "console";
  const compactSelectStyle: React.CSSProperties = {
    width: "fit-content",
    minWidth: "24ch",
    maxWidth: "100%",
  };
  const tinyStyle: React.CSSProperties = {
    width: "fit-content",
    minWidth: "18ch",
    maxWidth: "100%",
  };

  const currentUserIdentityId = getCurrentUserIdentityId();
  const identityName = (identityId: string): string => {
    if (identityId === currentUserIdentityId) return `Current user (${getUsername() ?? "no login"})`;
    const identity = identities.find((candidate) => candidate.id === identityId);
    if (!identity) return "(unknown)";
    return identity.kind === "literal"
      ? (identity.label ? `${identity.username} — ${identity.label}` : (identity.username ?? ""))
      : (identity.label ?? identity.id);
  };
  const availableIdentities = useMemo(
    () => identities.filter((identity) => !identityRows.includes(identity.id)),
    [identities, identityRows],
  );
  const moveIdentity = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= identityRows.length) return;
    const next = [...identityRows];
    [next[index], next[target]] = [next[target], next[index]];
    setIdentityRows(next);
  };
  const removeIdentity = (index: number) => {
    const next = identityRows.filter((_, rowIndex) => rowIndex !== index);
    setIdentityRows(next);
    if (next.length === 0) {
      setS((current) => ({ ...current, username: "" }));
    }
  };
  const clearConfiguredIdentities = () => {
    setIdentityRows([]);
    setS((current) => ({ ...current, username: "" }));
    setAddingIdentity(false);
    setPickedIdentity("");
    setNewIdentityUsername("");
  };
  const clearPendingIdentity = () => {
    setAddingIdentity(false);
    setPickedIdentity("");
    setNewIdentityUsername("");
  };
  const pendingIdentityRows = (): string[] => {
    let identityId = pickedIdentity;
    if (!identityId) {
      const username = newIdentityUsername.trim();
      if (!username) return identityRows;
      identityId = findIdentityByUsername(username)?.id
        ?? addIdentity({ kind: "literal", username, source: "manual" }).id;
    }
    return identityRows.includes(identityId) ? identityRows : [...identityRows, identityId];
  };
  const addSelectedIdentity = () => {
    setErr(null);
    if (!pickedIdentity && !newIdentityUsername.trim()) {
      setErr("Pick an identity or type a new username.");
      return;
    }
    setIdentityRows(pendingIdentityRows());
    setIdentities(listIdentities());
    clearPendingIdentity();
  };

  const switchRow = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
    hint?: string,
    disabled?: boolean,
  ) => (
    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      title={hint}
    >
      <Switch checked={checked} onChange={onChange} disabled={disabled} title={hint} />
      <span style={{ minWidth: 56, fontSize: 13 }}>{label}</span>
    </label>
  );

  const eff = s.protocol !== "shell" && s.protocol !== "web" && s.protocol !== "console"
    ? effectiveSessionConnections(s)
    : null;
  const setConn = (k: "ssh" | "rdp" | "sftp" | "browse", v: boolean) => {
    commit({ connections: { ...(s.connections ?? {}), [k]: v } });
  };
  // Keep switches and dropdowns in the same draft as text fields. Nothing
  // in this editor is persisted until the user presses Save; otherwise an
  // outside click can appear to discard the form while silently saving it.
  function commit(updates: Partial<SavedSession>) {
    const next = mergeSessionFormDraft({ ...s, ...updates });
    setS(next);
  }

  const tunnels = s.sshTunnels ?? [];
  const updateTunnel = (id: string, updates: Partial<(typeof tunnels)[number]>) => {
    setS((current) => ({
      ...current,
      sshTunnels: (current.sshTunnels ?? []).map((tunnel) => (
        tunnel.id === id ? { ...tunnel, ...updates } : tunnel
      )),
    }));
  };
  const removeTunnel = (id: string) => {
    setS((current) => ({
      ...current,
      sshTunnels: (current.sshTunnels ?? []).filter((tunnel) => tunnel.id !== id),
    }));
  };
  const addTunnel = () => {
    const id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tunnel-${Date.now()}-${tunnels.length}`;
    setS((current) => ({
      ...current,
      sshTunnels: [
        ...(current.sshTunnels ?? []),
        { id, localPort: 15443, destinationHost: current.host, destinationPort: 443 },
      ],
    }));
  };

  const sections: Array<{
    id: SettingsSection;
    label: string;
    description: string;
    icon: NotesIconName;
  }> = [
    { id: "connection", label: "Connection", description: "Address, appearance, and grouping", icon: "connections" },
    { id: "credentials", label: "Credentials", description: "Identity and authentication", icon: "identities" },
    { id: "services", label: "Services", description: "SSH, SFTP, Browse, and ports", icon: "configure" },
    ...(eff?.rdp ? [{ id: "rdp" as const, label: "RDP", description: "Client, quality, domain, and security", icon: "rdp" as const }] : []),
    { id: "terminal", label: "Terminal", description: "Application and session behavior", icon: "sessions" },
    ...(onConfigureTunnels ? [{ id: "tunnels" as const, label: "Tunnels", description: "SSH local port forwarding", icon: "tunnel" as const }] : []),
  ];
  const activeSectionInfo = sections.find((section) => section.id === activeSection) ?? sections[0];

  useEffect(() => {
    if ((activeSection === "rdp" && !eff?.rdp) || (activeSection === "tunnels" && !onConfigureTunnels)) {
      setActiveSection("connection");
    }
  }, [activeSection, eff?.rdp, onConfigureTunnels]);

  return (
    <div
      ref={rootRef}
      className="session-settings-panel"
    >
      <nav className="session-settings-sidebar" aria-label="Connection settings">
        <div className="session-settings-sidebar__eyebrow">Connection options</div>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`session-settings-sidebar__item${activeSection === section.id ? " is-active" : ""}`}
            aria-current={activeSection === section.id ? "page" : undefined}
            onClick={() => setActiveSection(section.id)}
          >
            <NotesIcon name={section.icon} size={18} />
            <span className="session-settings-sidebar__copy">
              <span className="session-settings-sidebar__label">{section.label}</span>
              <span className="session-settings-sidebar__description">{section.description}</span>
            </span>
            {section.id === "tunnels" && tunnels.length > 0 && (
              <span className="session-settings-sidebar__badge">{tunnels.length}</span>
            )}
          </button>
        ))}
      </nav>

      <main className="session-settings-content">
        <header className="session-settings-content__header">
          <span className="session-settings-content__icon"><NotesIcon name={activeSectionInfo.icon} size={20} /></span>
          <div>
            <h3 id="session-settings-section-title">{activeSectionInfo.label}</h3>
            <p>{activeSectionInfo.description}</p>
          </div>
        </header>

        <div
          className={`session-settings-fields${activeSection === "credentials" ? " session-settings-fields--single-column" : ""}`}
          aria-labelledby="session-settings-section-title"
        >
      {/* LEFT COLUMN — identity */}
      <div className="session-settings-column">
        {field(
          "Name",
          <input
            value={s.name}
            onChange={(e) => setS({ ...s, name: e.target.value })}
            style={nameStyle}
          />,
        )}
        {(s.protocol === "ssh" || s.protocol === "rdp") && field(
          "Authentication",
          <div className="session-settings-authentication-stack">
            <ThemedSelect
              ariaLabel={`${s.protocol.toUpperCase()} authentication`}
              value={s.onePassword ? "onepassword" : "standard"}
              onChange={(value) => {
                setS(value === "onepassword"
                  ? { ...s, onePassword: s.onePassword ?? { itemReference: "" }, ...(s.protocol === "ssh" ? { sshKeyPath: undefined, sshApp: undefined } : {}) }
                  : { ...s, onePassword: undefined });
              }}
              style={{ width: "fit-content", minWidth: "30ch", maxWidth: "100%" }}
              options={[
                { value: "standard", label: s.protocol === "rdp" ? "Prompt when connecting" : "Key file or interactive prompt" },
                { value: "onepassword", label: "1Password username + password" },
              ]}
            />
            {s.onePassword && (
              <OnePasswordCredentialPicker
                value={s.onePassword}
                onChange={(onePassword) => setS((current) => ({ ...current, onePassword }))}
                onResolved={(username) => setS((current) => ({ ...current, username }))}
                onClear={() => setS((current) => ({ ...current, onePassword: undefined }))}
              />
            )}
          </div>,
        )}
        {s.protocol !== "shell" && s.protocol !== "web" && s.protocol !== "console" && !s.onePassword && field(
          "Identity",
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {identityRows.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
                {s.username
                  ? `Uses saved username (${s.username}).`
                  : `Inherits the current user (${getUsername() ?? "no login"}).`}
              </div>
            )}
            {identityRows.map((identityId, index) => (
              <div
                key={`${identityId}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--panel)",
                }}
              >
                <span style={{ flex: 1, fontSize: 13 }}>
                  {index === 0 && (
                    <span
                      className="identity-primary-badge"
                    >
                      Primary
                    </span>
                  )}
                  {identityName(identityId)}
                </span>
                <button type="button" className="outline-action-button outline-action-button--icon" onClick={() => moveIdentity(index, -1)} disabled={index === 0} title="Move up" aria-label="Move identity up"><NotesIcon name="up" size={14} /></button>
                <button type="button" className="outline-action-button outline-action-button--icon" onClick={() => moveIdentity(index, 1)} disabled={index === identityRows.length - 1} title="Move down" aria-label="Move identity down"><span className="session-settings-icon--down"><NotesIcon name="up" size={14} /></span></button>
                <button type="button" className="outline-action-button outline-action-button--icon outline-action-button--danger" onClick={() => removeIdentity(index)} title="Remove" aria-label="Remove identity"><NotesIcon name="remove" size={14} /></button>
              </div>
            ))}
            {addingIdentity ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, border: "1px dashed var(--border)", borderRadius: 4 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <ThemedSelect
                    ariaLabel="Existing SSH identity"
                    value={pickedIdentity}
                    onChange={(value) => {
                      setPickedIdentity(value);
                      if (value) setNewIdentityUsername("");
                    }}
                    style={{ minWidth: "18ch" }}
                    options={[
                      { value: "", label: "— Pick existing identity —" },
                      ...availableIdentities.map((identity) => ({ value: identity.id, label: identityName(identity.id) })),
                    ]}
                  />
                  <span style={{ alignSelf: "center", color: "var(--muted)", fontSize: 12 }}>or</span>
                  <input
                    type="text"
                    placeholder="New username"
                    value={newIdentityUsername}
                    onChange={(event) => {
                      setNewIdentityUsername(event.target.value);
                      if (event.target.value) setPickedIdentity("");
                    }}
                    maxLength={32}
                    style={userStyle}
                  />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="outline-action-button" onClick={addSelectedIdentity}><NotesIcon name="add" size={15} />Add</button>
                  <button type="button" className="outline-action-button outline-action-button--muted" onClick={() => { setAddingIdentity(false); setPickedIdentity(""); setNewIdentityUsername(""); }}><NotesIcon name="cancel" size={15} />Cancel</button>
                </div>
              </div>
            ) : (
              <div className="ssh-identity-actions">
                <button type="button" className="outline-action-button btn-small" onClick={() => setAddingIdentity(true)}>
                  <NotesIcon name="choose" size={14} />Choose
                </button>
                <button
                  type="button"
                  className="outline-action-button outline-action-button--muted btn-small"
                  onClick={clearConfiguredIdentities}
                  disabled={identityRows.length === 0 && !s.username}
                  aria-label="Clear configured identity"
                >
                  <NotesIcon name="remove" size={14} />Clear
                </button>
              </div>
            )}
          </div>,
          "The first identity is used for SSH, SFTP, and RDP. Additional identities are available as connection alternatives. Existing saved usernames remain active until an identity is selected.",
          true,
        )}
        {s.protocol !== "shell" && (
          <div className="session-settings-field session-settings-field--full session-settings-field--host" hidden={activeSection !== "connection"} style={{ marginBottom: 10 }}>
            <div className={`session-settings-address-row${showsHostPort ? " session-settings-address-row--with-port" : ""}`}>
              <div className="session-settings-address-row__host">
                <span style={labelStyle}>{s.protocol === "console" ? "Serial port" : "Host"}</span>
                <input
                  list={s.protocol === "console" ? "catwalk-serial-ports" : undefined}
                  value={s.host}
                  placeholder={s.protocol === "console" ? (isWindows() ? "COM3" : "/dev/ttyUSB0") : undefined}
                  onChange={(e) => setS({ ...s, host: e.target.value })}
                  style={hostStyle}
                />
                {s.protocol === "console" && serialPorts.length > 0 && (
                  <datalist id="catwalk-serial-ports">
                    {serialPorts.map((port) => <option key={port} value={port} />)}
                  </datalist>
                )}
              </div>
              {showsHostPort && (
                <div className="session-settings-address-row__port">
                  <span style={labelStyle}>Port</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={s.port}
                    onChange={(e) => setS({ ...s, port: parseInt(e.target.value, 10) || 0 })}
                    style={portStyle}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        {field(
          "Group",
          <ThemedSelect
            ariaLabel="Connection group"
            value={s.groupId ?? ""}
            onChange={(value) => setS({ ...s, groupId: value || undefined })}
            style={groupStyle}
            options={[
              { value: "", label: "(Ungrouped)" },
              ...groups.map((group) => ({ value: group.id, label: group.name })),
            ]}
          />,
        )}
        {s.protocol !== "shell" && s.protocol !== "web" && s.protocol !== "console" && !s.onePassword &&
          field(
            "Private key path",
            <PrivateKeyPathPicker
              value={s.sshKeyPath ?? ""}
              inheritedPath={inheritedSshKey}
              onChange={(sshKeyPath) => setS({
                ...s,
                sshKeyPath: sshKeyPath || undefined,
              })}
            />,
            inheritedSshKey
              ? "Overrides the global private key for this connection. Empty = inherit global key."
              : "Overrides the global private key for this connection.",
            true,
          )}
        {s.protocol === "console" && (
          <div hidden={activeSection !== "connection"} style={{ marginBottom: 10 }}>
            <span style={labelStyle}>Serial settings</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(100px, 1fr))", gap: 8 }}>
              <label>
                <span style={labelStyle}>Speed</span>
                <input
                  type="number"
                  min={1}
                  list="catwalk-serial-speeds"
                  value={s.serial?.baudRate ?? 9600}
                  onChange={(e) => setS({ ...s, serial: { ...serialDefaults(s), baudRate: Number(e.target.value) } })}
                />
                <datalist id="catwalk-serial-speeds">
                  {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400].map((rate) => (
                    <option key={rate} value={rate} />
                  ))}
                </datalist>
              </label>
              <label>
                <span style={labelStyle}>Data bits</span>
                <ThemedSelect
                  ariaLabel="Serial data bits"
                  value={String(s.serial?.dataBits ?? 8)}
                  onChange={(value) => setS({ ...s, serial: { ...serialDefaults(s), dataBits: Number(value) as 5 | 6 | 7 | 8 } })}
                  options={[5, 6, 7, 8].map((bits) => ({ value: String(bits), label: String(bits) }))}
                />
              </label>
              <label>
                <span style={labelStyle}>Parity</span>
                <ThemedSelect
                  ariaLabel="Serial parity"
                  value={s.serial?.parity ?? "none"}
                  onChange={(value) => setS({ ...s, serial: { ...serialDefaults(s), parity: value as "none" | "odd" | "even" } })}
                  options={[
                    { value: "none", label: "None" },
                    { value: "odd", label: "Odd" },
                    { value: "even", label: "Even" },
                  ]}
                />
              </label>
              <label>
                <span style={labelStyle}>Stop bits</span>
                <ThemedSelect
                  ariaLabel="Serial stop bits"
                  value={String(s.serial?.stopBits ?? 1)}
                  onChange={(value) => setS({ ...s, serial: { ...serialDefaults(s), stopBits: Number(value) as 1 | 2 } })}
                  options={[1, 2].map((bits) => ({ value: String(bits), label: String(bits) }))}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                <span style={labelStyle}>Flow control</span>
                <ThemedSelect
                  ariaLabel="Serial flow control"
                  value={s.serial?.flowControl ?? "none"}
                  onChange={(value) => setS({ ...s, serial: { ...serialDefaults(s), flowControl: value as "none" | "software" | "hardware" } })}
                  options={[
                    { value: "none", label: "None" },
                    { value: "software", label: "Software (XON/XOFF)" },
                    { value: "hardware", label: "Hardware (RTS/CTS)" },
                  ]}
                />
              </label>
            </div>
          </div>
        )}
        {s.protocol === "shell" &&
          field(
            "Command",
            <input
              placeholder="/bin/zsh or cmd.exe"
              value={s.shellCmd ?? ""}
              onChange={(e) => setS({ ...s, shellCmd: e.target.value })}
              style={{ width: "100%" }}
            />,
          )}
        {field(
          "Scrollback (lines)",
          <input
            type="number"
            min={100}
            max={100000}
            step={100}
            placeholder={String(appearance.terminalScrollback)}
            value={s.scrollback ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setS({ ...s, scrollback: Number.isFinite(n) ? n : undefined });
            }}
            style={{ width: "14ch" }}
          />,
          `Override the global scrollback for this connection. Empty = inherit (${appearance.terminalScrollback}).`,
          true,
        )}
        {field(
          "Save transcript",
          <ThemedSelect
            ariaLabel="Save transcript"
            value={s.saveTranscript === true ? "on" : s.saveTranscript === false ? "off" : ""}
            onChange={(value) => {
              setS({
                ...s,
                saveTranscript: value === "on" ? true : value === "off" ? false : undefined,
              });
            }}
            style={compactSelectStyle}
            options={[
              { value: "", label: `Inherit (${appearance.transcriptEnabled ? "on" : "off"})` },
              { value: "on", label: "Always save" },
              { value: "off", label: "Never save" },
            ]}
          />,
          "Override the global transcript toggle for this connection.",
          true,
        )}
        {(s.saveTranscript ?? appearance.transcriptEnabled) && field(
          "Transcript dir",
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              placeholder={appearance.transcriptDir || "/path/to/dir"}
              value={s.transcriptDir ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setS({ ...s, transcriptDir: v || undefined });
              }}
              style={{ flex: 1, minWidth: 200 }}
            />
            <button
              type="button"
              className="outline-action-button"
              onClick={async () => {
                const start = s.transcriptDir || appearance.transcriptDir || undefined;
                const picked = await openDialog({ directory: true, multiple: false, defaultPath: start });
                if (typeof picked === "string" && picked) {
                  setS({ ...s, transcriptDir: picked });
                }
              }}
            >
              <NotesIcon name="choose" size={15} />
              Choose
            </button>
          </div>,
          "Directory where this connection's terminal transcripts are saved. Leave it empty to use the global transcript directory from Settings > Appearance.",
          true,
        )}
      </div>

      {/* RIGHT COLUMN — toggles + color + OS terminal pickers */}
      <div className="session-settings-column">
        {field(
          "Color",
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="color"
              style={{ width: 40, padding: 0, height: 28 }}
              value={s.color ?? "#38bdf8"}
              onChange={(e) => setS({ ...s, color: e.target.value })}
            />
            {s.color && (
              <button
                type="button"
                className="outline-action-button outline-action-button--muted"
                onClick={() => setS({ ...s, color: undefined })}
              >
                <NotesIcon name="remove" size={14} />
                Clear
              </button>
            )}
          </div>,
          "Colors this connection's side accent and action icons in Connections and the Sessions sidebar, plus its terminal tab accent. Terminal output text changes only when ANSI tinting is enabled.",
          true,
        )}
        {s.protocol === "ssh" && !s.onePassword && field(
          "SSH \u2014 Open with",
          <ThemedSelect
            ariaLabel="SSH application"
            value={s.sshApp ?? SSH_APP_INAPP}
            onChange={(value) => {
              setS({ ...s, sshApp: value === SSH_APP_INAPP ? undefined : value });
            }}
            style={compactSelectStyle}
            options={[
              { value: SSH_APP_INAPP, label: "In-app terminal (default)" },
              ...terms.map((terminal) => ({ value: terminal, label: terminal })),
            ]}
          />,
          "Selects whether SSH opens as an in-app Sessions terminal or in a detected external terminal application. This connection's identity, credentials, and tunnel settings still apply.",
          true,
        )}
        {s.protocol === "ssh" && field(
          "SFTP \u2014 Open with",
          <ThemedSelect
            ariaLabel="SFTP application"
            value={s.sftpApp ?? SFTP_APP_BROWSER}
            onChange={(value) => {
              setS({ ...s, sftpApp: value === SFTP_APP_BROWSER ? undefined : value });
            }}
            style={compactSelectStyle}
            options={[
              { value: SFTP_APP_BROWSER, label: "In-app SFTP browser (default)" },
              { value: SFTP_APP_INAPP, label: "In-app terminal" },
              { value: SFTP_APP_SYSTEM, label: "External terminal (sftp CLI)" },
              ...sftpGuis.map((app) => ({ value: app.id, label: app.label })),
            ]}
          />,
          "How the SFTP button on this connection opens.",
          true,
        )}
        {eff?.rdp && field(
          "RDP domain",
          <input
            value={s.rdpDomain ?? ""}
            placeholder="Optional Windows domain"
            onChange={(event) => setS({ ...s, rdpDomain: event.target.value || undefined })}
            style={{ width: "18ch" }}
          />,
          "Used with DOMAIN\\username credentials. Leave empty for local accounts or UPN usernames.",
          true,
        )}
        {eff?.rdp && field(
          "RDP port",
          <input
            type="text"
            aria-label="RDP port override"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={5}
            value={s.rdpPort ?? ""}
            placeholder={String(s.protocol === "rdp" ? (s.port || 3389) : 3389)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 5);
              setS({
                ...s,
                rdpPort: digits ? Number(digits) : undefined,
              });
            }}
            style={{ width: "9ch" }}
          />,
          `Optional RDP-specific port. Empty uses ${
            s.protocol === "rdp" ? (s.port || 3389) : 3389
          }.`,
          true,
        )}
        {eff?.rdp && field(
          "RDP — Open with",
          <ThemedSelect
            ariaLabel="RDP application"
            value={s.rdpApp ?? ""}
            onChange={(value) => setS({
              ...s,
              rdpApp: value === "catwalk" || value === "freerdp" || value === "system"
                ? value
                : undefined,
            })}
            style={{ width: "fit-content", maxWidth: "100%" }}
            options={[
              {
                value: "",
                label: `Default - ${
                  effectiveRdpApp(s, appearance.savedConnectionRdpApp) === "catwalk"
                    ? "ConnCat RDP (IronRDP)"
                    : effectiveRdpApp(s, appearance.savedConnectionRdpApp) === "freerdp"
                      ? "ConnCat FreeRDP"
                      : "System RDP"
                }`,
              },
              { value: "catwalk", label: "ConnCat RDP (IronRDP)" },
              { value: "freerdp", label: "ConnCat FreeRDP" },
              { value: "system", label: "System RDP client" },
            ]}
          />,
          "Overrides Settings → App Behavior for this Connection. ConnCat release installers include both IronRDP and the FreeRDP compatibility client. System RDP uses the operating system client.",
          true,
        )}
        {eff?.rdp && field(
          "RDP — Security layer",
          <ThemedSelect
            ariaLabel="RDP security transport layer"
            value={s.rdpSecurity ?? "nla"}
            onChange={(value) => setS({
              ...s,
              rdpSecurity: value === "tls" || value === "rdp" ? value : "nla",
            })}
            style={{ width: "24ch", maxWidth: "100%" }}
            options={[
              { value: "nla", label: "NLA / CredSSP (default)" },
              { value: "tls", label: "TLS / graphical login (xrdp)" },
              { value: "rdp", label: "Standard RDP legacy" },
            ]}
          />,
          "ConnCat starts with NLA by default and remembers the last security layer that connected successfully. TLS keeps the branded ConnCat viewer; Standard RDP uses the FreeRDP compatibility client.",
          true,
        )}
        {eff?.rdp && field(
          "RDP — Connection quality",
          <ThemedSelect
            ariaLabel="RDP connection quality"
            value={s.rdpQuality ?? "balanced"}
            onChange={(value) => setS({
              ...s,
              rdpQuality: value === "low_bandwidth" || value === "very_low_bandwidth"
                ? value
                : undefined,
            })}
            style={{ width: "fit-content", maxWidth: "100%" }}
            options={[
              { value: "balanced", label: "Balanced (32-bit)" },
              { value: "low_bandwidth", label: "Low bandwidth" },
              { value: "very_low_bandwidth", label: "Very low bandwidth" },
            ]}
          />,
          "Lower-bandwidth presets disable wallpaper, themes, window-drag rendering, and animations. Resolution is configured separately below.",
          true,
        )}
        {eff?.rdp && field(
          "RDP — Resolution",
          <ThemedSelect
            ariaLabel="RDP resolution"
            value={s.rdpResolution ?? ""}
            onChange={(value) => setS({
              ...s,
              rdpResolution: RDP_RESOLUTION_PRESETS.some((preset) => preset.value === value)
                ? value as RdpResolutionPreset
                : undefined,
            })}
            style={{ width: "fit-content", maxWidth: "100%" }}
            options={[
              { value: "", label: "Automatic (recommended)" },
              ...RDP_RESOLUTION_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
            ]}
          />,
          "Sets the remote framebuffer size for ConnCat RDP. Higher resolutions use more memory and bandwidth; the window can still be resized using local scaling.",
          true,
        )}
        {s.protocol !== "shell" && s.protocol !== "console" && field(
          "Browse \u2014 Open with",
          <ThemedSelect
            ariaLabel="Browse application"
            value={s.browseOpenMode ?? ""}
            onChange={(value) => {
              setS({
                ...s,
                browseOpenMode: value === BROWSE_OPEN_IN_APP
                  || value === BROWSE_OPEN_WINDOW
                  || value === BROWSE_OPEN_EXTERNAL
                  ? value
                  : undefined,
              });
            }}
            style={compactSelectStyle}
            options={[
              { value: "", label: `Inherit (${appearance.browseOpenMode === BROWSE_OPEN_EXTERNAL
                ? "Default OS browser"
                : appearance.browseOpenMode === BROWSE_OPEN_WINDOW
                  ? "External ConnCat window"
                  : "In-app browser"})` },
              { value: BROWSE_OPEN_IN_APP, label: "In-app browser" },
              { value: BROWSE_OPEN_WINDOW, label: "External ConnCat window" },
              { value: BROWSE_OPEN_EXTERNAL, label: "Default OS browser" },
            ]}
          />,
          "Overrides the global Browse behavior for this connection.",
          true,
        )}
        {s.protocol === "ssh" && isMacOs() &&
          field(
            "External terminal (macOS)",
            <ThemedSelect
              ariaLabel="External terminal on macOS"
              value={s.terminalMac ?? ""}
              onChange={(value) => setS({ ...s, terminalMac: value || undefined })}
              style={tinyStyle}
              options={[
                { value: "", label: "Default" },
                ...MAC_TERMINALS.map((terminal) => ({ value: terminal, label: terminal })),
              ]}
            />,
          )}
        {s.protocol === "ssh" && isWindows() &&
          field(
            "External terminal (Windows)",
            <ThemedSelect
              ariaLabel="External terminal on Windows"
              value={s.terminalWindows ?? ""}
              onChange={(value) => setS({ ...s, terminalWindows: value || undefined })}
              style={tinyStyle}
              options={[
                { value: "", label: "Default" },
                ...WIN_TERMINALS.map((terminal) => ({ value: terminal, label: terminal })),
              ]}
            />,
          )}
        {field(
          "Icon",
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ThemedSelect
              ariaLabel="Connection icon"
              value={s.deviceTypeIcon ?? ""}
              onChange={(value) => setS({ ...s, deviceTypeIcon: value || undefined })}
              style={compactSelectStyle}
              options={[
                { value: "", label: "(none)" },
                ...DEVICE_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
              ]}
            />
            {s.deviceTypeIcon && <GuestOsIcon deviceType={s.deviceTypeIcon} />}
          </div>,
          "Icon shown next to this connection's name in the list and on the focus card.",
          true,
        )}
        {eff && (
          <div
            hidden={activeSection !== "terminal"}
            data-testid="terminal-session-behavior"
            style={{ marginBottom: 10 }}
          >
            <span style={labelStyle}>Session behavior</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {switchRow(
                "Keepalive",
                (s.keepalive ?? 0) > 0,
                (v) => commit({ keepalive: v ? 60 : undefined }),
                "Send ServerAliveInterval=60 so the session survives NAT timeouts",
              )}
              {s.protocol === "ssh" && switchRow(
                "Vim fix",
                s.vimFix === true,
                (v) => commit({ vimFix: v || undefined }),
                "Wraps remote shell with VIMINIT so vim doesn't hang in xterm.js. " +
                "Enable only when needed; the wrapper can hide MOTD/login banners.",
              )}
              {switchRow(
                "Tint ANSI",
                !!s.tintAnsi,
                (v) => commit({ tintAnsi: v || undefined }),
                s.color
                  ? "Remap ANSI palette to shades of the card color"
                  : "Pick a card color first",
                !s.color,
              )}
            </div>
          </div>
        )}
        {eff && (
          <div
            hidden={activeSection !== "services"}
            data-testid="service-connections"
            style={{ marginBottom: 10 }}
          >
            <span style={labelStyle}>Connections</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {switchRow("SSH", eff.ssh, (v) => setConn("ssh", v))}
              {switchRow("RDP", eff.rdp, (v) => setConn("rdp", v))}
              {switchRow("SFTP", eff.sftp, (v) => setConn("sftp", v))}
              {switchRow(
                "Browse",
                eff.browse,
                (v) => {
                  const webPorts = v && (!s.webPorts || s.webPorts.length === 0) ? [443] : s.webPorts;
                  commit({ connections: { ...(s.connections ?? {}), browse: v }, webPorts });
                },
                "Expose HTTPS ports as Browse buttons",
              )}
            </div>
          </div>
        )}
        {(s.protocol === "ssh" || s.protocol === "rdp" || s.protocol === "web") && (
          <div hidden={activeSection !== "services"} style={{ marginBottom: 10 }}>
            <span style={labelStyle}>HTTPS ports</span>
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              {(s.webPorts ?? []).map((p, idx) => (
                <div key={idx} style={{ display: "flex", gap: 2, alignItems: "center" }}>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={p}
                    onChange={(e) => {
                      const ports = [...(s.webPorts ?? [])];
                      ports[idx] = parseInt(e.target.value, 10) || 0;
                      setS({ ...s, webPorts: ports });
                    }}
                    style={{ width: "9ch", minWidth: 76 }}
                  />
                  <button
                    type="button"
                    className="outline-action-button outline-action-button--icon outline-action-button--muted"
                    onClick={() => {
                      const ports = (s.webPorts ?? []).filter((_, i) => i !== idx);
                      setS({ ...s, webPorts: ports });
                    }}
                    title="Remove HTTPS port"
                    aria-label="Remove HTTPS port"
                  >
                    <NotesIcon name="remove" size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="outline-action-button outline-action-button--icon"
                onClick={() => setS({ ...s, webPorts: [...(s.webPorts ?? []), 443] })}
                title="Add HTTPS port"
                aria-label="Add HTTPS port"
              >
                <NotesIcon name="add" size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {activeSection === "tunnels" && onConfigureTunnels && (
        <div className="session-settings-tunnels">
          <div className="session-settings-tunnels__visual"><NotesIcon name="tunnel" size={28} /></div>
          <div className="session-settings-tunnels__intro">
            <h4>{tunnels.length > 0 ? `${tunnels.length} configured ${tunnels.length === 1 ? "tunnel" : "tunnels"}` : "No tunnels configured"}</h4>
            <p>
              Local port forwards open automatically with this SSH connection. Changes are saved with the rest of this Connection.
            </p>
          </div>
          <div className="session-settings-tunnels__editor">
            <div className="session-settings-tunnels__table-wrap">
              <table className="session-settings-tunnels__table">
                <thead>
                  <tr>
                    <th>Local port</th>
                    <th>Destination</th>
                    <th>Port</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {tunnels.length === 0 && (
                    <tr>
                      <td className="session-settings-tunnels__empty" colSpan={4}>No local forwards yet.</td>
                    </tr>
                  )}
                  {tunnels.map((tunnel, index) => (
                    <tr key={tunnel.id}>
                      <td>
                        <input
                          aria-label={`Tunnel ${index + 1} local port`}
                          type="number"
                          min={1}
                          max={65535}
                          value={tunnel.localPort || ""}
                          onChange={(event) => updateTunnel(tunnel.id, { localPort: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Tunnel ${index + 1} destination`}
                          value={tunnel.destinationHost}
                          placeholder="10.0.0.10"
                          onChange={(event) => updateTunnel(tunnel.id, { destinationHost: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Tunnel ${index + 1} destination port`}
                          type="number"
                          min={1}
                          max={65535}
                          value={tunnel.destinationPort || ""}
                          onChange={(event) => updateTunnel(tunnel.id, { destinationPort: Number(event.target.value) })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="outline-action-button outline-action-button--icon outline-action-button--danger"
                          onClick={() => removeTunnel(tunnel.id)}
                          title="Remove tunnel"
                          aria-label={`Remove tunnel ${index + 1}`}
                        >
                          <NotesIcon name="delete" size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="outline-action-button session-settings-tunnels__add" onClick={addTunnel}>
              <NotesIcon name="add" size={15} />
              Add tunnel
            </button>
          </div>
        </div>
      )}
        </div>
      </main>

      <div className="session-settings-footer">
        <button type="button" className="outline-action-button" onClick={save}>
          <NotesIcon name="save" size={15} />
          Save
        </button>
        <button
          type="button"
          className="outline-action-button outline-action-button--muted"
          onClick={onCancel}
        >
          <NotesIcon name="cancel" size={15} />
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            className="outline-action-button outline-action-button--danger"
            onClick={onDelete}
            style={{ marginLeft: "auto" }}
          >
            <NotesIcon name="delete" size={15} />
            Delete
          </button>
        )}
        {err && <span style={{ color: "salmon", fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  );
}
