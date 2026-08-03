// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationPopupHost from "./NotificationPopupHost";
import { showNotificationPopup } from "./popupStore";

describe("NotificationPopupHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<NotificationPopupHost />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function publish() {
    act(() => {
      showNotificationPopup({
        id: "notification-1",
        kind: "info",
        title: "VM power queued",
        body: "Working on ubuntu-1.",
      });
    });
  }

  it("shows new notifications and closes them with the dismiss button", () => {
    publish();
    expect(host.textContent).toContain("VM power queued");

    act(() => {
      host.querySelector<HTMLButtonElement>(".notification-popup__close")?.click();
    });
    expect(host.querySelector(".notification-popup")).toBeNull();
  });

  it("auto-dismisses after 20 seconds without interaction", () => {
    publish();
    act(() => vi.advanceTimersByTime(19_999));
    expect(host.querySelector(".notification-popup")).not.toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(host.querySelector(".notification-popup")).toBeNull();
  });

  it("clears an expired popup when the app resumes after timers were suspended", () => {
    publish();
    vi.setSystemTime(Date.now() + 20_001);

    act(() => window.dispatchEvent(new Event("focus")));

    expect(host.querySelector(".notification-popup")).toBeNull();
  });

  it("pauses while the user interacts, then resumes the remaining countdown", () => {
    publish();
    act(() => {
      host.querySelector<HTMLButtonElement>(".notification-popup__close")?.focus();
      vi.advanceTimersByTime(20_000);
    });
    expect(host.querySelector(".notification-popup")).not.toBeNull();

    act(() => {
      host.querySelector<HTMLButtonElement>(".notification-popup__close")?.blur();
      vi.advanceTimersByTime(19_999);
    });
    expect(host.querySelector(".notification-popup")).not.toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(host.querySelector(".notification-popup")).toBeNull();
  });
});
