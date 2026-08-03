import { describe, expect, it, vi } from "vitest";
import { drainRendererPool, remainingLiveTerminalCount } from "./rendererPoolLifecycle";

describe("terminal renderer pool lifecycle", () => {
  it("drains every renderer once and leaves the pool empty", () => {
    const pool = [1, 2];
    const dispose = vi.fn((renderer: number) => ({
      canvasCount: 1,
      backingPixels: renderer * 100,
    }));

    expect(drainRendererPool(pool, dispose)).toEqual({
      disposedRendererCount: 2,
      canvasCount: 2,
      backingPixels: 300,
    });
    expect(pool).toEqual([]);
    expect(drainRendererPool(pool, dispose).disposedRendererCount).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it("treats concurrently closing group members as no longer live", () => {
    const ids = [10, 11, 12];
    const closing = new Set(ids);

    expect(remainingLiveTerminalCount(ids, closing, 10)).toBe(0);
    expect(remainingLiveTerminalCount(ids, new Set([10]), 10)).toBe(2);
  });
});
