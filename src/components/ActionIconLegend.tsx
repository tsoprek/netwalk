import { useEffect, useRef } from "react";
import NotesIcon, { type NotesIconName } from "./NotesIcon";

export type ActionIconLegendItem = {
  icon: NotesIconName;
  label: string;
};

export default function ActionIconLegend({ items }: { items: ActionIconLegendItem[] }) {
  const legendRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const legend = legendRef.current;
      if (!legend?.open || !(event.target instanceof Node) || legend.contains(event.target)) return;
      legend.open = false;
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  return (
    <details ref={legendRef} className="action-icon-legend">
      <summary title="Action icon legend" aria-label="Action icon legend">
        <NotesIcon name="legend" size={18} />
      </summary>
      <div className="action-icon-legend__panel">
        <strong>Icon legend</strong>
        <div className="action-icon-legend__items">
          {items.map((item) => (
            <div className="action-icon-legend__item" key={`${item.icon}:${item.label}`}>
              <span className="action-icon-legend__glyph"><NotesIcon name={item.icon} size={17} /></span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
