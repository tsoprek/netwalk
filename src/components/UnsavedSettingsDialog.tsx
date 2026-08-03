import NotesIcon from "./NotesIcon";

interface Props {
  subject: "device" | "connection";
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

export default function UnsavedSettingsDialog({
  subject,
  saving,
  onSave,
  onDiscard,
  onKeepEditing,
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Unsaved ${subject} settings`}
      onClick={onKeepEditing}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        className="card"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          margin: 0,
          background: "var(--surface-bg, var(--bg))",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--accent)", display: "inline-flex" }}>
            <NotesIcon name="warning" size={20} />
          </span>
          Unsaved settings
        </h3>
        <p style={{ color: "var(--muted)", lineHeight: 1.5, margin: "0 0 18px" }}>
          This {subject} has settings changes that have not been saved.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            className="outline-action-button outline-action-button--muted"
            disabled={saving}
            onClick={onKeepEditing}
            title="Continue editing"
            aria-label="Continue editing"
          >
            <NotesIcon name="cancel" size={15} />
            Continue
          </button>
          <button
            type="button"
            className="outline-action-button outline-action-button--danger"
            disabled={saving}
            onClick={onDiscard}
            title="Close without saving"
            aria-label="Close without saving"
          >
            <NotesIcon name="delete" size={15} />
            Discard
          </button>
          <button
            type="button"
            className="outline-action-button"
            disabled={saving}
            onClick={onSave}
            title="Save and close"
            aria-label="Save and close"
            autoFocus
          >
            <NotesIcon name="save" size={15} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
