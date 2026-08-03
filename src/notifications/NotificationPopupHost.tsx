import { useCallback, useEffect, useRef, useState } from "react";
import {
  type NotificationPopup,
  subscribeNotificationPopups,
} from "./popupStore";

const AUTO_DISMISS_MS = 20_000;
const MAX_VISIBLE_POPUPS = 5;

interface DismissTimer {
  timerId: number | null;
  remainingMs: number;
  startedAt: number;
}

function popupTone(kind: string): "error" | "success" | "warning" | "info" {
  if (kind === "error" || kind.endsWith("_failed")) return "error";
  if (kind.endsWith("_succeeded")) return "success";
  if (kind === "warning") return "warning";
  return "info";
}

export default function NotificationPopupHost() {
  const [items, setItems] = useState<NotificationPopup[]>([]);
  const timersRef = useRef(new Map<string, DismissTimer>());
  const visibleIdsRef = useRef(new Set<string>());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)?.timerId;
    if (timer != null) window.clearTimeout(timer);
    timersRef.current.delete(id);
    visibleIdsRef.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const scheduleDismiss = useCallback((id: string, delayMs: number) => {
    const timerId = window.setTimeout(() => dismiss(id), delayMs);
    timersRef.current.set(id, {
      timerId,
      remainingMs: delayMs,
      startedAt: Date.now(),
    });
  }, [dismiss]);

  const pauseDismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (!timer || timer.timerId == null) return;
    window.clearTimeout(timer.timerId);
    timersRef.current.set(id, {
      timerId: null,
      remainingMs: Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt)),
      startedAt: 0,
    });
  }, []);

  const resumeDismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (!timer || timer.timerId != null) return;
    scheduleDismiss(id, timer.remainingMs);
  }, [scheduleDismiss]);

  const resumeAfterFocusLeaves = useCallback((id: string, event: React.FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    resumeDismiss(id);
  }, [resumeDismiss]);

  const pauseForPointer = useCallback((id: string) => {
    pauseDismiss(id);
  }, [pauseDismiss]);

  const resumeAfterPointer = useCallback((id: string) => {
    resumeDismiss(id);
  }, [resumeDismiss]);

  useEffect(() => {
    const timers = timersRef.current;
    const dismissExpired = () => {
      const now = Date.now();
      const expiredIds: string[] = [];
      timers.forEach((timer, id) => {
        if (
          timer.timerId != null
          && now - timer.startedAt >= timer.remainingMs
        ) {
          expiredIds.push(id);
        }
      });
      expiredIds.forEach(dismiss);
    };
    const unsubscribe = subscribeNotificationPopups((notification) => {
      if (visibleIdsRef.current.has(notification.id)) return;
      visibleIdsRef.current.add(notification.id);
      setItems((current) => {
        const next = [...current, notification];
        if (next.length <= MAX_VISIBLE_POPUPS) return next;
        const removed = next.shift();
        if (removed) {
          const timer = timers.get(removed.id)?.timerId;
          if (timer != null) window.clearTimeout(timer);
          timers.delete(removed.id);
          visibleIdsRef.current.delete(removed.id);
        }
        return next;
      });
      scheduleDismiss(notification.id, AUTO_DISMISS_MS);
    });
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") dismissExpired();
    };
    window.addEventListener("focus", dismissExpired);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", dismissExpired);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      timers.forEach(({ timerId }) => {
        if (timerId != null) window.clearTimeout(timerId);
      });
      timers.clear();
      visibleIdsRef.current.clear();
    };
  }, [dismiss, scheduleDismiss]);

  if (items.length === 0) return null;

  return (
    <section
      className="notification-popup-stack"
      aria-label="New notifications"
      aria-live="polite"
    >
      {items.map((item) => (
        <article
          key={item.id}
          className={`notification-popup notification-popup--${popupTone(item.kind)}`}
          onPointerEnter={() => pauseForPointer(item.id)}
          onPointerLeave={() => resumeAfterPointer(item.id)}
          onFocusCapture={() => pauseDismiss(item.id)}
          onBlurCapture={(event) => resumeAfterFocusLeaves(item.id, event)}
        >
          <div className="notification-popup__content">
            <strong>{item.title}</strong>
            {item.body && <p>{item.body}</p>}
          </div>
          <button
            type="button"
            className="notification-popup__close"
            onClick={() => dismiss(item.id)}
            aria-label={`Close notification: ${item.title}`}
            title="Close"
          >
            ×
          </button>
        </article>
      ))}
    </section>
  );
}
