import { describe, expect, it } from "vitest";
import { labSshTabTitle } from "./tabTitles";

describe("terminal tab titles", () => {
  it("does not repeat SSH for Lab devices", () => {
    expect(labSshTabTitle("C9300-1")).toBe("C9300-1");
  });

  it("retains interface information when it disambiguates an endpoint", () => {
    expect(labSshTabTitle("C9300-1", "Management 1")).toBe("C9300-1 via Management 1");
  });
});
