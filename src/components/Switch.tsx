interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
  id?: string;
  ariaLabel?: string;
  style?: "segmented" | "slider" | "compact" | "icons" | "pill";
}

/// Visual on/off switch backed by a native checkbox for accessibility.
/// Sized in `em` so it scales with the surrounding text.
export default function Switch({ checked, onChange, disabled, title, id, ariaLabel, style }: Props) {
  return (
    <label
      title={title}
      className={`catwalk-switch${checked ? " catwalk-switch--checked" : ""}${disabled ? " catwalk-switch--disabled" : ""}`}
      data-switch-button-style={style}
    >
      <input
        id={id}
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="catwalk-switch__input"
      />
      <span className="catwalk-switch__control" aria-hidden="true">
        <span className="catwalk-switch__option catwalk-switch__option--off">OFF</span>
        <span className="catwalk-switch__option catwalk-switch__option--on">ON</span>
      </span>
    </label>
  );
}
