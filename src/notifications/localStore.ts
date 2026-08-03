//! Tiny in-memory notification log for client-side events (booking errors,
//! action failures, etc.) that the top-of-page toast also surfaces. Lets
//! the NotificationBell show them so the user can review what scrolled
//! off-screen. Not persisted: cleared on app restart.

import { showNotificationPopup } from "./popupStore";
import { userFacingMessage } from "./userMessage";

export interface LocalNotification {
  id: string;
  kind: "error" | "info" | "warning";
  title: string;
  body?: string;
  created_at: string;
  read: boolean;
}

const MAX_ITEMS = 50;
const EVENT_NAME = "catwalk:local-notifications";

let items: LocalNotification[] = [];

function emit() {
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function addLocalNotification(
  n: Omit<LocalNotification, "id" | "created_at" | "read">,
  options: { showPopup?: boolean } = {},
): void {
  const item: LocalNotification = {
    ...n,
    body: n.body ? userFacingMessage(n.body) : undefined,
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    read: false,
  };
  items = [item, ...items].slice(0, MAX_ITEMS);
  emit();
  if (options.showPopup !== false) showNotificationPopup(item);
}

export function getLocalNotifications(): LocalNotification[] {
  return items;
}

export function markLocalNotificationRead(id: string): void {
  let changed = false;
  items = items.map((n) => {
    if (n.id === id && !n.read) { changed = true; return { ...n, read: true }; }
    return n;
  });
  if (changed) emit();
}

export function markAllLocalNotificationsRead(): void {
  let changed = false;
  items = items.map((n) => {
    if (!n.read) { changed = true; return { ...n, read: true }; }
    return n;
  });
  if (changed) emit();
}

export function subscribeLocalNotifications(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
