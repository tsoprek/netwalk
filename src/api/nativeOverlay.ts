const NATIVE_OVERLAY_EVENT = "catwalk:native-overlay-change";
const openOverlayIds = new Set<string>();

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NATIVE_OVERLAY_EVENT, {
    detail: { open: openOverlayIds.size > 0 },
  }));
}

/**
 * Native Tauri child WebViews render above every DOM z-index. Shell popovers
 * use this registry to ask Remote Access to temporarily hide its live native
 * surface while an application-owned overlay is open.
 */
export function setNativeOverlayOpen(id: string, open: boolean): void {
  const changed = open ? !openOverlayIds.has(id) : openOverlayIds.has(id);
  if (open) openOverlayIds.add(id);
  else openOverlayIds.delete(id);
  if (changed) notify();
}

export function isNativeOverlayOpen(): boolean {
  return openOverlayIds.size > 0;
}

export function subscribeNativeOverlayOpen(listener: (open: boolean) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ open?: boolean }>).detail;
    listener(detail?.open === true);
  };
  window.addEventListener(NATIVE_OVERLAY_EVENT, handler);
  listener(isNativeOverlayOpen());
  return () => window.removeEventListener(NATIVE_OVERLAY_EVENT, handler);
}
