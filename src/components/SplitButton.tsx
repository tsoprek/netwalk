import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MENU_MIN_WIDTH = 260;
const MENU_MAX_WIDTH = "min(520px, calc(100vw - 16px))";
const MENU_MAX_HEIGHT = "min(420px, calc(100vh - 32px))";

export interface SplitMenuItem {
  label: string;
  /// Optional leading icon. Dropdown icons use the active theme accent.
  icon?: React.ReactNode;
  /// Optional — omit when `submenu` is provided (the parent entry just
  /// opens the nested panel and does nothing on click).
  onClick?: () => void;
  /// Hide the entry without removing the whole menu. Convenient for
  /// conditionally-available actions (e.g. "Open in Cyberduck" only when
  /// Cyberduck is installed).
  hidden?: boolean;
  /// Nested entries shown in a side flyout. Used to group related actions
  /// (e.g. "Connect as ▸ user1 / user2") under a single parent label so
  /// the top-level menu stays short.
  submenu?: SplitMenuItem[];
}

// Toolbar-button sizing — matches the inline `actBtn` style used on the
// Lab Devices / My Connections rows so the split-button doesn't tower
// over its plain-button neighbours.
const TOOLBAR_BTN_STYLE: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 13,
  lineHeight: 1.2,
};

/// A button with a primary action plus a chevron that opens a dropdown of
/// alternate actions. Primary click runs `onClick`; the menu lists every
/// option (typically including the default) so the user can re-trigger or
/// pick a variant.
export default function SplitButton({
  label,
  onClick,
  menu,
  disabled,
  title,
  buttonStyle,
  primaryButtonStyle,
  ariaLabel,
}: {
  label: React.ReactNode;
  onClick: () => void;
  menu: SplitMenuItem[];
  disabled?: boolean;
  title?: string;
  buttonStyle?: React.CSSProperties;
  primaryButtonStyle?: React.CSSProperties;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visible = menu.filter((m) => !m.hidden);
  const baseButtonStyle = { ...TOOLBAR_BTN_STYLE, ...buttonStyle };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const host = ref.current;
    const menuWidth = Math.max(MENU_MIN_WIDTH, menuRef.current?.offsetWidth ?? MENU_MIN_WIDTH);
    const vw = window.innerWidth;
    const rect = host.getBoundingClientRect();
    const spaceToRight = vw - rect.left;
    const spaceToLeft = rect.right;

    // Prefer opening to the right (left aligned). If it would clip, flip.
    setAlignRight(spaceToRight < menuWidth && spaceToLeft > spaceToRight);
  }, [open, visible.length]);

  return (
    <div ref={ref} className="split-button" style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        style={{
          ...baseButtonStyle,
          ...primaryButtonStyle,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          marginRight: 0,
        }}
      >
        {label}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        disabled={disabled || visible.length === 0}
        title="More options"
        style={{
          ...baseButtonStyle,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeft: "1px solid rgba(0,0,0,0.2)",
          padding: buttonStyle?.padding ?? "4px 6px",
          paddingInline: buttonStyle ? 4 : 6,
          marginLeft: 0,
        }}
      >
        ▾
      </button>
      {open && visible.length > 0 && (
        <div
          ref={menuRef}
          className="split-button__menu"
          style={{
            position: "absolute",
            top: "100%",
            ...(alignRight ? { right: 0 } : { left: 0 }),
            marginTop: 4,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            zIndex: 100,
            minWidth: MENU_MIN_WIDTH,
            maxWidth: MENU_MAX_WIDTH,
            maxHeight: MENU_MAX_HEIGHT,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {visible.map((m, i) => (
            <MenuRow
              key={i}
              item={m}
              onPicked={() => setOpen(false)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/// Single menu row. When the item has a `submenu`, hovering (or focusing)
/// the row reveals a side flyout with the nested entries; clicking the
/// row itself is a no-op so the submenu doesn't snap closed.
function MenuRow({ item, onPicked }: { item: SplitMenuItem; onPicked: () => void }) {
  const [openSub, setOpenSub] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  // `flipLeft` mirrors SplitButton's own clip-detection: if the submenu
  // would run off the right edge, render it on the left of the row.
  const [flipLeft, setFlipLeft] = useState(false);
  const hasSub = !!item.submenu && item.submenu.some((s) => !s.hidden);

  useLayoutEffect(() => {
    if (!openSub || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    const subWidth = Math.max(MENU_MIN_WIDTH, subRef.current?.offsetWidth ?? MENU_MIN_WIDTH);
    const spaceRight = window.innerWidth - rect.right;
    setFlipLeft(spaceRight < subWidth);
  }, [openSub]);

  return (
    <div
      ref={rowRef}
      className="split-button__row"
      onMouseEnter={() => { if (hasSub) setOpenSub(true); }}
      onMouseLeave={() => { if (hasSub) setOpenSub(false); }}
      onClick={() => {
        // Parent rows with a submenu are pure headers — don't dismiss the
        // outer menu. Leaf rows run their click and close everything.
        if (hasSub) return;
        if (item.onClick) {
          item.onClick();
          onPicked();
        }
      }}
      style={{
        position: "relative",
        padding: "6px 12px",
        cursor: hasSub ? "default" : "pointer",
        fontSize: 14,
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderRadius: 4,
      }}
    >
      <span className="split-button__row-label" title={item.label}>
        {item.icon != null && <span className="split-button__row-icon">{item.icon}</span>}
        <span>{item.label}</span>
      </span>
      {hasSub && <span style={{ opacity: 0.6 }}>▸</span>}
      {hasSub && openSub && (
        <div
          ref={subRef}
          className="split-button__menu"
          // The flyout sits flush against the parent row's edge. A 1px
          // overlap keeps the hover region contiguous so moving the cursor
          // from row → flyout doesn't drop the hover state.
          style={{
            position: "absolute",
            top: -4,
            ...(flipLeft
              ? { right: "100%", marginRight: -1 }
              : { left: "100%", marginLeft: -1 }),
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            zIndex: 101,
            minWidth: MENU_MIN_WIDTH,
            maxWidth: MENU_MAX_WIDTH,
            maxHeight: MENU_MAX_HEIGHT,
            overflowY: "auto",
            padding: 4,
          }}
        >
          {item.submenu!.filter((s) => !s.hidden).map((s, i) => (
            <MenuRow key={i} item={s} onPicked={onPicked} />
          ))}
        </div>
      )}
    </div>
  );
}
