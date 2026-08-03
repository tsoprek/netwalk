import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionWindowLaunch,
  markSessionWindowAdopted,
  storeSessionWindowLaunch,
  takeSessionWindowLaunch,
} from "./sessionWindow";

describe("session-window launch transfer", () => {
  afterEach(() => localStorage.clear());

  it("keeps an RDP launch available during engine initialization, then clears it", () => {
    const launch = {
      kind: "rdp" as const,
      deviceId: "vm-7",
      title: "Windows VM",
      username: "celab",
      password: "managed-secret",
    };
    const token = storeSessionWindowLaunch(launch);

    expect(takeSessionWindowLaunch(token)).toEqual(launch);
    // Tauri/React can initialize the engine view more than once. The launch
    // must survive that handshake; SessionWindow clears it on its timer.
    expect(takeSessionWindowLaunch(token)).toEqual(launch);
    clearSessionWindowLaunch(token);
    expect(takeSessionWindowLaunch(token)).toBeNull();
  });

  it("records the adoption fallback before native acknowledgement", async () => {
    await markSessionWindowAdopted("handoff-1");
    expect(localStorage.getItem("catwalk.sessionWindowAdopted.handoff-1")).toBe("1");
  });
});
