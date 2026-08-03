import { open as openDialog } from "@tauri-apps/plugin-dialog";
import NotesIcon from "./NotesIcon";

export default function PrivateKeyPathPicker({
  value,
  inheritedPath,
  onChange,
}: {
  value: string;
  inheritedPath?: string | null;
  onChange: (value: string) => void;
}) {
  const configuredPath = value.trim();

  async function choose() {
    const picked = await openDialog({
      directory: false,
      multiple: false,
      defaultPath: configuredPath || inheritedPath || undefined,
    });
    if (typeof picked === "string" && picked) onChange(picked);
  }

  return (
    <div className="private-key-path-picker">
      {configuredPath && (
        <input
          type="text"
          aria-label="Configured private key path"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <div className="private-key-path-picker__actions">
        <button
          type="button"
          className={`outline-action-button btn-small${configuredPath ? " outline-action-button--icon" : ""}`}
          aria-label={configuredPath ? "Choose a different private key" : undefined}
          title={configuredPath ? "Choose a different private key" : undefined}
          onClick={() => void choose()}
        >
          <NotesIcon name="choose" size={15} />
          {!configuredPath && "Choose"}
        </button>
        <button
          type="button"
          className="outline-action-button outline-action-button--muted outline-action-button--icon btn-small"
          aria-label="Clear private key path"
          title="Clear private key path"
          disabled={!configuredPath}
          onClick={() => onChange("")}
        >
          <NotesIcon name="remove" size={14} />
        </button>
      </div>
    </div>
  );
}
