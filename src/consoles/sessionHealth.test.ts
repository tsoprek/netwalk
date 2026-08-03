import { describe, expect, it } from "vitest";
import { consoleSessionHealth } from "./sessionHealth";

describe("consoleSessionHealth", () => {
  it("maps connection lifecycle to the shared session health colors", () => {
    expect(consoleSessionHealth({ status: "Connected.", error: "", disconnected: false }).state).toBe("active");
    expect(consoleSessionHealth({ status: "Opening tunnel...", error: "", disconnected: false }).state).toBe("idle");
    expect(consoleSessionHealth({ status: "Disconnected.", error: "", disconnected: true }).state).toBe("exited");
    expect(consoleSessionHealth({ status: "", error: "Authentication failed", disconnected: false })).toEqual({
      state: "exited",
      label: "Disconnected",
      detail: "Authentication failed",
    });
  });
});
