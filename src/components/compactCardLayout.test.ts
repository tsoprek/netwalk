import { describe, expect, it } from "vitest";
import { assignCompactCardColumns } from "./compactCardLayout";

describe("compact card column placement", () => {
  it("fills the shorter column beside a two-place note card", () => {
    expect(assignCompactCardColumns([
      false, false,
      false, false,
      true, false,
      false, false,
      false, false,
    ])).toEqual([
      1, 2,
      1, 2,
      1, 2,
      2, 1,
      2, 1,
    ]);
  });
});
