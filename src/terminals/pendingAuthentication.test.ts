import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { failPendingAuthentication } from "./pendingAuthentication";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("pending terminal authentication", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  });

  it("ends the placeholder PTY and tells the user how to retry", async () => {
    const writeNotice = vi.fn();

    await failPendingAuthentication(42, "1Password", "authorization prompt dismissed", writeNotice);

    expect(writeNotice).toHaveBeenCalledWith(
      42,
      expect.stringContaining("Double-click this tab or choose Reconnect to try again."),
      "error",
    );
    expect(invoke).toHaveBeenCalledWith("pty_kill", { id: 42 });
  });
});
