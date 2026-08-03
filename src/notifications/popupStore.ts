export interface NotificationPopup {
  id: string;
  kind: string;
  title: string;
  body?: string;
}

const EVENT_NAME = "catwalk:notification-popup";

export function showNotificationPopup(notification: NotificationPopup): void {
  window.dispatchEvent(new CustomEvent<NotificationPopup>(EVENT_NAME, {
    detail: notification,
  }));
}

export function subscribeNotificationPopups(
  callback: (notification: NotificationPopup) => void,
): () => void {
  const handler = (event: Event) => {
    callback((event as CustomEvent<NotificationPopup>).detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
