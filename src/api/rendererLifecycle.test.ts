import { beforeEach, describe, expect, it } from "vitest";
import {
  RENDERER_AUTO_RATE_LIMIT_MS,
  RENDERER_HANDOFF_TTL_MS,
  RENDERER_HANDOFF_KEY,
  consumeRestoredRendererHandoff,
  createRendererHandoff,
  markRendererAutoReset,
  parseRendererHandoff,
  rendererAutoRateLimited,
  rendererAutoRecoveryEnabled,
  restoreRendererResetHandoff,
  validRendererRoute,
} from "./rendererLifecycle";

describe("renderer lifecycle handoff", () => {
  beforeEach(() => localStorage.clear());

  it("accepts local routes and rejects external or malformed routes", () => {
    expect(validRendererRoute("/devices?view=list#one")).toBe(true);
    expect(validRendererRoute("https://example.test/devices")).toBe(false);
    expect(validRendererRoute("//example.test/devices")).toBe(false);
    expect(validRendererRoute("/devices\nignored")).toBe(false);
  });

  it("expires handoffs and preserves a current handoff", () => {
    const now = 50_000_000;
    const current = JSON.stringify({
      version: 1,
      resetId: "reset-1",
      timestamp: now - 1_000,
      route: "/devices?view=list",
      scrollX: 4,
      scrollY: 80,
    });
    expect(parseRendererHandoff(current, now)?.route).toBe("/devices?view=list");
    expect(parseRendererHandoff(JSON.stringify({
      ...JSON.parse(current),
      timestamp: now - RENDERER_HANDOFF_TTL_MS - 1,
    }), now)).toBeNull();
  });

  it("rate limits automatic resets for one hour", () => {
    const now = 80_000_000;
    markRendererAutoReset(now);
    expect(rendererAutoRateLimited(now + RENDERER_AUTO_RATE_LIMIT_MS - 1)).toBe(true);
    expect(rendererAutoRateLimited(now + RENDERER_AUTO_RATE_LIMIT_MS)).toBe(false);
  });

  it("defaults automatic recovery on only for macOS Tauri and preserves an explicit choice", () => {
    expect(rendererAutoRecoveryEnabled("MacIntel", true)).toBe(true);
    expect(rendererAutoRecoveryEnabled("Win32", true)).toBe(false);
    expect(rendererAutoRecoveryEnabled("MacIntel", false)).toBe(false);
    localStorage.setItem("catwalk.rendererReset.auto.v1", "0");
    expect(rendererAutoRecoveryEnabled("MacIntel", true)).toBe(false);
    localStorage.setItem("catwalk.rendererReset.auto.v1", "1");
    expect(rendererAutoRecoveryEnabled("Win32", true)).toBe(true);
  });

  it("restores the route before render and consumes the short-lived handoff", () => {
    const now = 90_000_000;
    history.replaceState({}, "", "/");
    localStorage.setItem(RENDERER_HANDOFF_KEY, JSON.stringify({
      version: 1,
      resetId: "reset-route",
      timestamp: now,
      route: "/settings?section=renderer#memory",
      scrollX: 2,
      scrollY: 200,
    }));
    expect(restoreRendererResetHandoff(now)?.resetId).toBe("reset-route");
    expect(`${location.pathname}${location.search}${location.hash}`).toBe("/settings?section=renderer#memory");
    expect(localStorage.getItem(RENDERER_HANDOFF_KEY)).toBeNull();
    expect(consumeRestoredRendererHandoff()?.scrollY).toBe(200);
  });

  it("captures the ConnCat content viewport scroll position", () => {
    history.replaceState({}, "", "/settings");
    const app = document.createElement("div");
    app.className = "app";
    const main = document.createElement("main");
    main.scrollLeft = 7;
    main.scrollTop = 340;
    app.append(main);
    document.body.append(app);
    expect(createRendererHandoff("reset-scroll", 100).scrollY).toBe(340);
    app.remove();
  });
});
