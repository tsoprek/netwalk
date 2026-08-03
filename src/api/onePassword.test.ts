import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  getConsoleOnePasswordCredential,
  getDefaultLabOnePasswordConfig,
  getDefaultLabOnePasswordCredential,
  getDeviceOnePasswordCredential,
  listOnePasswordLogins,
  normalizeOnePasswordItemReference,
  onePasswordErrorMessage,
  resolveOnePasswordLogin,
  selectDeviceLogin,
  setDeviceOnePasswordCredential,
  setDefaultLabOnePasswordConfig,
} from "./onePassword";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("1Password connection credentials", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    localStorage.clear();
  });

  it("normalizes an item reference without accepting field references", () => {
    expect(normalizeOnePasswordItemReference(" op://Infra/Linux host/ ")).toBe("op://Infra/Linux host");
    expect(() => normalizeOnePasswordItemReference("Infra/Linux host")).toThrow("start with op://");
    expect(() => normalizeOnePasswordItemReference("op://Infra/Linux host/password")).toThrow("op://Vault/Item");
  });

  it("resolves username and password through the native desktop bridge", async () => {
    vi.mocked(invoke).mockResolvedValue({ username: "admin", password: "current-secret" });

    await expect(resolveOnePasswordLogin({
      itemReference: "op://Infra/Linux host",
      account: "CE Labs",
    })).resolves.toEqual({ username: "admin", password: "current-secret" });
    expect(invoke).toHaveBeenCalledWith("onepassword_resolve_login", {
      itemReference: "op://Infra/Linux host",
      account: "CE Labs",
    });
  });

  it("lists Login items for the picker without retrieving their secrets", async () => {
    vi.mocked(invoke).mockResolvedValue([{ title: "Router", vaultName: "Infra", itemReference: "op://v/i" }]);
    await expect(listOnePasswordLogins("CE Labs")).resolves.toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("onepassword_list_logins", { account: "CE Labs" });
  });

  it("preserves string errors returned by Tauri commands", () => {
    expect(onePasswordErrorMessage("No 1Password CLI account is available")).toBe(
      "No 1Password CLI account is available",
    );
  });

  it("stores only the Lab device item reference and account selector", () => {
    setDeviceOnePasswordCredential("device-1", {
      itemReference: "op://Infra/Linux host",
      account: " CE Labs ",
    });
    const raw = localStorage.getItem("catwalk.deviceOnePassword.device-1");
    expect(JSON.parse(raw!)).toEqual({
      itemReference: "op://Infra/Linux host",
      account: "CE Labs",
    });
    expect(getDeviceOnePasswordCredential("device-1")).toEqual({
      itemReference: "op://Infra/Linux host",
      account: "CE Labs",
    });
  });

  it("keeps the default Lab item while its use is disabled", () => {
    setDefaultLabOnePasswordConfig({
      enabled: false,
      credential: { itemReference: "op://Infra/LDAP", account: " CE Labs " },
    });
    expect(getDefaultLabOnePasswordConfig()).toEqual({
      enabled: false,
      credential: { itemReference: "op://Infra/LDAP", account: "CE Labs" },
    });
    expect(getDefaultLabOnePasswordCredential()).toBeNull();

    setDefaultLabOnePasswordConfig({
      ...getDefaultLabOnePasswordConfig(),
      enabled: true,
    });
    expect(getDefaultLabOnePasswordCredential()).toEqual({
      itemReference: "op://Infra/LDAP",
      account: "CE Labs",
    });
  });

  it("prioritizes the enabled default credential for VM and CML consoles", () => {
    setDeviceOnePasswordCredential("vm-7", {
      itemReference: "op://Connections/Per device",
      account: "work",
    });
    setDefaultLabOnePasswordConfig({
      enabled: true,
      credential: { itemReference: "op://Infrastructure/Console LDAP" },
    });

    expect(getConsoleOnePasswordCredential("vm-7")).toEqual({
      itemReference: "op://Infrastructure/Console LDAP",
    });
  });

  it("falls back to the per-device credential when the default is disabled", () => {
    setDeviceOnePasswordCredential("vm-7", {
      itemReference: "op://Connections/Per device",
    });
    setDefaultLabOnePasswordConfig({
      enabled: false,
      credential: { itemReference: "op://Infrastructure/Console LDAP" },
    });

    expect(getConsoleOnePasswordCredential("vm-7")).toEqual({
      itemReference: "op://Connections/Per device",
    });
  });

  it("keeps RDP usernames paired with the credential source", () => {
    expect(selectDeviceLogin(
      { username: "onepass-user", password: "onepass-secret" },
      { username: "vm-user", password: "vm-secret" },
      "logged-in-user",
    )).toEqual({ username: "onepass-user", password: "onepass-secret" });
    expect(selectDeviceLogin(
      null,
      { username: "vm-user", password: "vm-secret" },
      "logged-in-user",
    )).toEqual({ username: "vm-user", password: "vm-secret" });
  });
});
