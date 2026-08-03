import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const HOVER_DELAY_MS = 2_000;
const EDGE_GAP = 12;
const MAX_TOOLTIP_WIDTH = 340;

type TooltipState = {
  text: string;
  left: number;
  top: number;
  placement: "above" | "below";
};

function tooltipTarget(rawTarget: EventTarget | null): HTMLElement | null {
  if (!(rawTarget instanceof Element)) return null;
  const element = rawTarget.closest<HTMLElement>("[data-app-tooltip], [title]");
  if (!element) return null;

  const nativeTitle = element.getAttribute("title")?.trim();
  if (nativeTitle) {
    element.dataset.appTooltip = nativeTitle;
    element.removeAttribute("title");
    if (!element.hasAttribute("aria-description")) {
      element.setAttribute("aria-description", nativeTitle);
    }
  }
  return element.dataset.appTooltip?.trim() ? element : null;
}

function tooltipPosition(element: HTMLElement): Omit<TooltipState, "text"> {
  const rect = element.getBoundingClientRect();
  const halfWidth = Math.min(
    MAX_TOOLTIP_WIDTH / 2,
    Math.max(0, (window.innerWidth - EDGE_GAP * 2) / 2),
  );
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, EDGE_GAP + halfWidth),
    window.innerWidth - EDGE_GAP - halfWidth,
  );
  const placement = rect.top >= 64 ? "above" : "below";
  return {
    left,
    top: placement === "above" ? rect.top - 8 : rect.bottom + 8,
    placement,
  };
}

export default function AppTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const keyboardInputRef = useRef(false);

  useEffect(() => {
    const cancelTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const hide = () => {
      cancelTimer();
      targetRef.current = null;
      setTooltip(null);
    };
    const show = (element: HTMLElement, delayed: boolean) => {
      cancelTimer();
      targetRef.current = element;
      const reveal = () => {
        if (targetRef.current !== element || !element.isConnected) return;
        const text = element.dataset.appTooltip?.trim();
        if (!text) return;
        setTooltip({ text, ...tooltipPosition(element) });
      };
      if (delayed && element.dataset.appTooltipImmediate !== "true") {
        timerRef.current = window.setTimeout(reveal, HOVER_DELAY_MS);
      }
      else reveal();
    };
    const onMouseOver = (event: MouseEvent) => {
      const element = tooltipTarget(event.target);
      if (!element) return;
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      show(element, true);
    };
    const onMouseOut = (event: MouseEvent) => {
      const element = tooltipTarget(event.target);
      if (!element || element !== targetRef.current) return;
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      // Pointer clicks move focus too, but should not pin a tooltip to the
      // clicked control. Immediate focus tooltips are for keyboard navigation.
      if (!keyboardInputRef.current) return;
      const element = tooltipTarget(event.target);
      if (element) show(element, false);
    };
    const onFocusOut = (event: FocusEvent) => {
      const element = tooltipTarget(event.target);
      if (element === targetRef.current) hide();
    };
    const onPointerDown = () => {
      keyboardInputRef.current = false;
      hide();
    };
    const onKeyDown = () => {
      keyboardInputRef.current = true;
      hide();
    };
    const onDocumentLeave = (event: MouseEvent) => {
      if (event.relatedTarget === null) hide();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mouseout", onMouseOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("dragstart", hide, true);
    document.addEventListener("mouseleave", onDocumentLeave, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("mouseout", onMouseOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("dragstart", hide, true);
      document.removeEventListener("mouseleave", onDocumentLeave, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tooltip) return null;
  return createPortal(
    <div
      role="tooltip"
      className={`app-tooltip app-tooltip--${tooltip.placement}`}
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>,
    document.body,
  );
}
