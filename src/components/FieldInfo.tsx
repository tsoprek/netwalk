import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NotesIcon from "./NotesIcon";

export default function FieldInfo({ label, text }: { label: string; text: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipId = useId();
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const show = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const tooltipWidth = Math.min(300, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - tooltipWidth - 8));
    const above = rect.bottom + 110 > window.innerHeight;
    setPosition({ left, top: above ? rect.top - 6 : rect.bottom + 6, above });
  };

  return <>
    <button
      ref={buttonRef}
      type="button"
      className="field-info"
      aria-label={`${label}: ${text}`}
      aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={() => setPosition(null)}
      onFocus={show}
      onBlur={() => setPosition(null)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        show();
      }}
    >
      <NotesIcon name="legend" size={13} />
    </button>
    {position && createPortal(
      <div
        id={tooltipId}
        role="tooltip"
        className={`field-info-tooltip${position.above ? " field-info-tooltip--above" : ""}`}
        style={{ left: position.left, top: position.top }}
      >
        {text}
      </div>,
      document.body,
    )}
  </>;
}
