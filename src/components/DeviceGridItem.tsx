import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CompactCardColumn } from "./compactCardLayout";

let activeResizeObserverCount = 0;
let activeResizeObserverTargetCount = 0;
let sharedResizeObserver: ResizeObserver | null = null;
const resizeCallbacks = new WeakMap<Element, () => void>();

function observeCard(card: Element, measure: () => void): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) resizeCallbacks.get(entry.target)?.();
    });
    activeResizeObserverCount = 1;
  }
  resizeCallbacks.set(card, measure);
  sharedResizeObserver.observe(card);
  activeResizeObserverTargetCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resizeCallbacks.delete(card);
    sharedResizeObserver?.unobserve(card);
    activeResizeObserverTargetCount = Math.max(0, activeResizeObserverTargetCount - 1);
    if (activeResizeObserverTargetCount === 0) {
      sharedResizeObserver?.disconnect();
      sharedResizeObserver = null;
      activeResizeObserverCount = 0;
    }
  };
}

export function getDeviceGridDiagnostics() {
  return {
    activeResizeObserverCount,
    activeResizeObserverTargetCount,
  };
}

/**
 * Ordinary device-grid wrapper. Every row remains mounted and rendered.
 * Compact mode shares one ResizeObserver solely to calculate masonry spans;
 * List mode creates no observers at all.
 */
export default function DeviceGridItem({
  id,
  hasNote,
  shouldMeasure,
  column,
  children,
}: {
  id: string;
  hasNote: boolean;
  shouldMeasure: boolean;
  column?: CompactCardColumn;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [span, setSpan] = useState(1);

  useLayoutEffect(() => {
    if (!shouldMeasure) return;
    const item = ref.current;
    const card = item?.firstElementChild as HTMLElement | null;
    if (!item || !card) return;
    const measure = () => {
      const grid = item.parentElement;
      const gridStyle = grid ? window.getComputedStyle(grid) : null;
      const rowHeight = Number.parseFloat(gridStyle?.gridAutoRows ?? "") || 1;
      const rowGap = Number.parseFloat(gridStyle?.rowGap ?? "") || 0;
      const contentHeight = card.getBoundingClientRect().height;
      const nextSpan = Math.max(1, Math.ceil(
        (contentHeight + rowGap) / (rowHeight + rowGap),
      ));
      setSpan((current) => current === nextSpan ? current : nextSpan);
    };
    measure();
    return observeCard(card, measure);
  }, [hasNote, shouldMeasure]);

  return (
    <div
      ref={ref}
      id={`device-row-${id}`}
      className={`compact-list-grid__item${column ? ` compact-list-grid__item--column-${column}` : ""}`}
      style={{ gridRowEnd: shouldMeasure ? `span ${span}` : undefined }}
    >
      {children}
    </div>
  );
}
