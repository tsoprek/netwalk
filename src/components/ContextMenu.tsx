import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/// One entry in a context menu. `divider: true` renders a horizontal rule
/// and is ignored when computing keyboard nav. Items with `disabled: true`
/// are visible but inert. `onClick` may return a Promise; the menu closes
/// before the promise resolves so async work doesn't keep the overlay up.
export type ContextMenuItem =
  | { divider: true }
  | {
      divider?: false;
      label: string;
      icon?: ReactNode;
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      children?: ContextMenuItem[];
      onClick?: () => void | Promise<void>;
    };

export interface ContextMenuPosition {
  x: number;
  y: number;
  width?: number;
}

/// Translates `event.preventDefault()` + position capture for an
/// `onContextMenu` handler into a `ContextMenuPosition`. Caller stores
/// the position in state and renders `<ContextMenu>` with it.
export function captureContextMenu(e: React.MouseEvent): ContextMenuPosition {
  e.preventDefault();
  e.stopPropagation();
  return { x: e.clientX, y: e.clientY };
}

/// Lightweight right-click menu. Closes on backdrop click, Esc, blur,
/// scroll, or any item activation. Reflows once after mount so it stays
/// inside the viewport.
export default function ContextMenu({
  position,
  items,
  onClose,
  variant = "default",
}: {
  position: ContextMenuPosition;
  items: ContextMenuItem[];
  onClose: () => void;
  variant?: "default" | "select";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [adjusted, setAdjusted] = useState<ContextMenuPosition>(position);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clamp = () => {
      const { offsetWidth: w, offsetHeight: h } = el;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 4;
      let x = position.x;
      let y = position.y;
      if (x + w + pad > vw) x = Math.max(pad, vw - w - pad);
      if (y + h + pad > vh) y = Math.max(pad, vh - h - pad);
      setAdjusted({ x, y });
    };
    clamp();
    // Submenus expand inline, so the menu's height changes after mount. Re-clamp
    // on every resize so an expanded submenu (e.g. a bottom item) shifts the
    // menu up to stay on screen instead of spilling below the viewport.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => clamp()) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [position.x, position.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // A page scroll dismisses the menu, but scrolling inside a tall menu (its
    // own overflow) must not close it.
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "transparent",
      }}
    >
      <div
        ref={ref}
        role="menu"
        className={`context-menu${variant === "select" ? " context-menu--select" : ""}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: adjusted.x,
          top: adjusted.y,
          minWidth: position.width ? `${position.width}px` : "var(--context-menu-min-width, 200px)",
          maxWidth: "var(--context-menu-max-width, 320px)",
          background: "var(--panel, #1c1f24)",
          color: "var(--fg, #e6e6e6)",
          border: "1px solid var(--border, #333)",
          borderRadius: 8,
          boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
          padding: "4px 0",
          fontSize: "var(--context-menu-font-size, 13px)",
          maxHeight: "calc(100vh - 8px)",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <MenuItems
          items={items}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}

function MenuItems({
  items,
  onClose,
  depth = 0,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  depth?: number;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <>
      {items.map((it, i) => {
        if ("divider" in it && it.divider) {
          return (
            <div
              key={`d-${i}`}
              style={{
                height: 1,
                background: "var(--border, #333)",
                margin: "4px 0",
              }}
            />
          );
        }
        const disabled = it.disabled;
        const danger = it.danger;
        const children = it.children?.filter((child) => !("divider" in child && child.divider)) ?? [];
        const hasSubmenu = children.length > 0;
        return (
          <div
            key={i}
            style={{ position: "relative" }}
          >
            <button
              type="button"
              role="menuitem"
              className="context-menu__item"
              data-danger={danger || undefined}
              disabled={disabled}
              aria-haspopup={hasSubmenu ? "menu" : undefined}
              aria-expanded={hasSubmenu ? openIndex === i : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (disabled) return;
                if (hasSubmenu) {
                  setOpenIndex((cur) => (cur === i ? null : i));
                  return;
                }
                onClose();
                Promise.resolve().then(() => it.onClick?.());
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                background: "transparent",
                color: disabled ? "var(--muted, #888)" : danger ? "#e57373" : "inherit",
                border: "none",
                padding: `6px 12px 6px ${12 + depth * 12}px`,
                textAlign: "left",
                cursor: disabled ? "default" : "pointer",
                fontSize: "var(--context-menu-font-size, 13px)",
                lineHeight: 1.4,
              }}
              onMouseEnter={(e) => {
                // Use the accent color at low alpha so the hover row is
                // visible on both dark and light themes (a white overlay
                // is invisible on a white panel).
                if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--accent, #38bdf8) 18%, transparent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {it.icon != null && (
                <span className="context-menu__icon" style={{ width: 16, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{it.icon}</span>
              )}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={it.label}
              >
                {it.label}
              </span>
              {it.hint && (
                <span style={{ color: "var(--muted, #888)", fontSize: 11, marginLeft: 8 }}>{it.hint}</span>
              )}
              {hasSubmenu && (
                <span aria-hidden style={{ color: "var(--muted, #888)", marginLeft: 8 }}>
                  {openIndex === i ? "⌄" : "›"}
                </span>
              )}
            </button>
            {hasSubmenu && openIndex === i && (
              <div
                role="menu"
                style={{
                  margin: "2px 0 4px",
                  padding: "2px 0",
                  borderLeft: "1px solid var(--border, #333)",
                  background: "color-mix(in srgb, var(--panel, #1c1f24) 92%, var(--fg, #e6e6e6))",
                }}
              >
                <MenuItems
                  items={it.children ?? []}
                  onClose={onClose}
                  depth={depth + 1}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
