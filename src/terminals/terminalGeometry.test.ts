import { describe, expect, it } from "vitest";
import {
  initialTerminalGrid,
  isUsableTerminalGeometry,
  isUsableTerminalGrid,
} from "./terminalGeometry";

describe("terminal geometry guards", () => {
  it("rejects detached and transiently collapsed panes", () => {
    expect(isUsableTerminalGeometry(0, 0)).toBe(false);
    expect(isUsableTerminalGeometry(79, 400)).toBe(false);
    expect(isUsableTerminalGeometry(400, 39)).toBe(false);
    expect(isUsableTerminalGrid(2, 30)).toBe(false);
    expect(isUsableTerminalGrid(120, 1)).toBe(false);
  });

  it("accepts usable compact terminal dimensions", () => {
    expect(isUsableTerminalGeometry(80, 40)).toBe(true);
    expect(isUsableTerminalGeometry(200, 90)).toBe(true);
    expect(isUsableTerminalGrid(8, 3)).toBe(true);
    expect(isUsableTerminalGrid(20, 5)).toBe(true);
  });
});

describe("initialTerminalGrid", () => {
  it("uses the available window instead of a fixed 100-column grid", () => {
    expect(initialTerminalGrid(1600, 1200, 14)).toEqual({ cols: 152, rows: 60 });
  });

  it("keeps small and very large windows within safe bounds", () => {
    expect(initialTerminalGrid(320, 240, 14)).toEqual({ cols: 80, rows: 24 });
    expect(initialTerminalGrid(5000, 4000, 14)).toEqual({ cols: 240, rows: 100 });
  });
});
