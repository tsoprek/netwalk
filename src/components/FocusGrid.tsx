import { ReactNode, useEffect, useRef, useState, type MouseEvent } from "react";

interface FocusItem {
  id: string;
  /// The compact card body shown in the grid. Keep it short (badge +
  /// name + 1-2 lines of metadata) so it fits a ~180×180 square.
  card: ReactNode;
  /// Optional action area rendered at the bottom of the card, outside the
  /// click-to-expand region. Use this for power controls / connect /
  /// book buttons so they are reachable without opening the modal.
  actions?: ReactNode;
  /// Optional right-click handler. Forwards the raw mouse event so the
  /// caller can position a `ContextMenu` at the cursor.
  onContextMenu?: (e: MouseEvent) => void;
}

interface Props {
  items: FocusItem[];
  /// Currently-expanded item id, if any. When set, the centered modal is
  /// rendered with `expandedContent` as its body.
  expandedId: string | null;
  expandedContent?: ReactNode;
  onPick: (id: string) => void;
  onClose: () => void;
  /// Optional double-click handler. Lets callers wire "double-click to
  /// open SSH" (or similar) on a focus card, mirroring the list view.
  onDoubleClick?: (id: string) => void;
  /// When provided, cards become draggable and the user can drop one
  /// card onto another to reorder them within this grid. The grid
  /// reports the move via `onReorder(draggedId, targetId)`; the
  /// caller persists the new order.
  onReorder?: (draggedId: string, targetId: string) => void;
  /// Reports the active drag synchronously to a parent drop zone. This is
  /// needed for cross-group drops because WebView2 may hide custom MIME data.
  onDragChange?: (draggedId: string | null) => void;
  /// Square-card edge length in px. The grid uses this as the minmax
  /// floor in its CSS auto-fill template so columns and rows scale
  /// together. Default: 180.
  cardSize?: number;
  /// Delay before a single click opens the expanded panel when a
  /// double-click handler is also available. Set to 0 for immediate open.
  clickDelayMs?: number;
}

/// Generic responsive grid of square cards with a click-to-expand modal.
/// Used by both DeviceList and Sessions in "focus" view mode. The grid
/// itself stays mounted under the modal so closing returns the user to
/// the same scroll position.
export default function FocusGrid({
  items,
  expandedId,
  expandedContent,
  onPick,
  onClose,
  onDoubleClick,
  onReorder,
  onDragChange,
  cardSize = 180,
  clickDelayMs = 280,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const reorderable = !!onReorder;
  // Defer the single-click `onPick` so a follow-up double-click can
  // cancel it. Without this, a quick double-click would always open the
  // expanded modal on the first click and only then run `onDoubleClick`.
  const clickTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (clickTimerRef.current != null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`,
          gap: 12,
          marginTop: 8,
        }}
      >
        {items.map((it) => {
          const isOver = reorderable && dropTarget === it.id && dragId !== it.id;
          const isDrag = reorderable && dragId === it.id;
          return (
            <div
              key={it.id}
              className="focus-card"
              role="button"
              tabIndex={0}
              draggable={reorderable}
              onClick={() => {
                if (!onDoubleClick) {
                  onPick(it.id);
                  return;
                }
                if (clickDelayMs <= 0) {
                  onPick(it.id);
                  return;
                }
                if (clickTimerRef.current != null) {
                  window.clearTimeout(clickTimerRef.current);
                }
                clickTimerRef.current = window.setTimeout(() => {
                  clickTimerRef.current = null;
                  onPick(it.id);
                }, clickDelayMs);
              }}
              onDoubleClick={onDoubleClick ? () => {
                if (clickTimerRef.current != null) {
                  window.clearTimeout(clickTimerRef.current);
                  clickTimerRef.current = null;
                }
                onDoubleClick(it.id);
              } : undefined}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(it.id);
                }
              }}
              onContextMenu={it.onContextMenu}
              onDragStart={(e) => {
                if (!reorderable) return;
                dragIdRef.current = it.id;
                onDragChange?.(it.id);
                setDragId(it.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/x-catwalk-focus-id", it.id);
                try { e.dataTransfer.setData("text/plain", `catwalk-focus:${it.id}`); } catch { /* ref fallback */ }
              }}
              onDragOver={(e) => {
                const draggedId = dragIdRef.current;
                if (!reorderable || draggedId == null || draggedId === it.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropTarget(it.id);
              }}
              onDragLeave={() => {
                if (!reorderable) return;
                setDropTarget((t) => (t === it.id ? null : t));
              }}
              onDrop={(e) => {
                const draggedId = dragIdRef.current;
                if (!reorderable || draggedId == null || draggedId === it.id) return;
                e.preventDefault();
                onReorder?.(draggedId, it.id);
                dragIdRef.current = null;
                setDragId(null);
                setDropTarget(null);
              }}
              onDragEnd={() => {
                if (!reorderable) return;
                dragIdRef.current = null;
                onDragChange?.(null);
                setDragId(null);
                setDropTarget(null);
              }}
              style={{
                aspectRatio: "1 / 1",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                justifyContent: "space-between",
                background: "var(--surface-panel-bg, var(--card, var(--panel)))",
                color: "var(--text, var(--fg))",
                border: isOver
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
                borderRadius: 8,
                padding: 12,
                textAlign: "left",
                cursor: reorderable ? "grab" : "pointer",
                userSelect: "none",
                opacity: isDrag ? 0.5 : 1,
                transition: "transform 80ms ease, box-shadow 80ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.25)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.transform = "";
                (e.currentTarget as HTMLDivElement).style.boxShadow = "";
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                {it.card}
              </div>
              {it.actions && (
                <div
                  // Stop the card-click from firing when the user clicks
                  // inside the action row. Drag is also disabled here so
                  // pressing a button doesn't pick up the card.
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => e.preventDefault()}
                  draggable={false}
                  style={{
                    marginTop: 5,
                    paddingTop: 5,
                    borderTop: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  {it.actions}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {expandedId && expandedContent && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-bg, var(--bg))",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 16,
              maxWidth: 720,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            }}
          >
            {expandedContent}
          </div>
        </div>
      )}
    </>
  );
}
