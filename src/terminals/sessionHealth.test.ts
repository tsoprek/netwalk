import { describe, expect, it } from "vitest";
import { terminalSessionHealth } from "./sessionHealth";

const NOW = 1_000_000;

describe("terminalSessionHealth", () => {
  it("distinguishes active, idle, and exited sessions", () => {
    const base = { exited: false, connectedAt: NOW - 600_000, lastInputAt: NOW - 600_000, exitCode: undefined };
    expect(terminalSessionHealth({ ...base, lastOutputAt: NOW - 10_000 }, NOW).state).toBe("active");
    expect(terminalSessionHealth({ ...base, lastOutputAt: NOW - 90_000 }, NOW).state).toBe("idle");
    expect(terminalSessionHealth({ ...base, lastOutputAt: NOW - 600_000 }, NOW).state).toBe("idle");
    expect(terminalSessionHealth({ ...base, exited: true, exitCode: 255, lastOutputAt: NOW }, NOW)).toEqual({
      state: "exited",
      label: "Exited",
      detail: "Process exited with code 255. Reconnect to start a new session.",
    });
  });
});
