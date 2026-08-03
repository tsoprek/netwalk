import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export interface ThemedSelectOption {
  value: string;
  label: string;
  color?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export default function ThemedSelect({
  ariaLabel,
  value,
  options,
  placeholder,
  onChange,
  autoFocus = false,
  className = "",
  showSelectedText = true,
  disabled = false,
  style,
}: {
  ariaLabel: string;
  value: string;
  options: ThemedSelectOption[];
  placeholder?: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  className?: string;
  showSelectedText?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (autoFocus) buttonRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture is intentional: dialogs stop bubbling mouse events so clicks
    // do not reach their backdrops. A bubbling document listener therefore
    // left selects open when the user clicked another field in a dialog.
    document.addEventListener("mousedown", close, true);
    return () => document.removeEventListener("mousedown", close, true);
  }, [open]);

  function show() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    onChange(option.value);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function chooseFromClick(event: ReactMouseEvent<HTMLButtonElement>, index: number) {
    // ThemedSelect is often placed inside a visual field <label>. Without
    // cancelling the option click's default action, that label can activate
    // the select trigger after this menu closes and immediately reopen it.
    event.preventDefault();
    event.stopPropagation();
    choose(index);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex); else show();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { show(); return; }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        let next = index;
        for (let count = 0; count < options.length; count += 1) {
          next = (next + direction + options.length) % options.length;
          if (!options[next]?.disabled) return next;
        }
        return index;
      });
    }
  }

  return (
    <div ref={rootRef} className={`themed-select ${open ? "open" : ""} ${className}`.trim()} style={style}>
      <button
        ref={buttonRef}
        type="button"
        className="themed-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={!showSelectedText ? selected?.label : undefined}
        onClick={() => { if (open) setOpen(false); else show(); }}
        onKeyDown={keyDown}
      >
        <span className="themed-select-selected-label">
          {selected?.icon && <span className="themed-select-option-icon" aria-hidden>{selected.icon}</span>}
          {showSelectedText && (selected?.label ?? placeholder ?? "Select")}
        </span>
        <span className="themed-select-chevron" aria-hidden />
      </button>
      {open && (
        <div className="themed-select-menu" role="listbox" aria-label={`${ariaLabel} options`}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`${index === activeIndex ? "active" : ""}${option.value === value ? " selected" : ""}`}
              key={option.value}
              disabled={option.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={(event) => chooseFromClick(event, index)}
            >
              <span className="themed-select-option-label">
                {option.color && <span className="themed-select-swatch" style={{ background: option.color }} aria-hidden />}
                {option.icon && <span className="themed-select-option-icon" aria-hidden>{option.icon}</span>}
                {option.label}
              </span>
              {option.value === value && <span aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
