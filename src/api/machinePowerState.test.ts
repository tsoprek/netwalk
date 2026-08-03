import { describe, expect, it } from "vitest";
import { machinePowerState } from "./machinePowerState";

describe("machinePowerState", () => {
  it.each(["POWERED_ON", "on", "BOOTED", "STARTED", "running"])(
    "normalizes %s as on",
    (state) => expect(machinePowerState(state)).toBe("on"),
  );

  it.each(["POWERED_OFF", "off", "STOPPED"])(
    "normalizes %s as off",
    (state) => expect(machinePowerState(state)).toBe("off"),
  );

  it.each(["SUSPENDED", "paused"])(
    "normalizes %s as suspended",
    (state) => expect(machinePowerState(state)).toBe("suspended"),
  );

  it("does not invent a state when the source is empty or unknown", () => {
    expect(machinePowerState(null)).toBeNull();
    expect(machinePowerState("unknown")).toBeNull();
  });
});
