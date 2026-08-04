import { beforeEach, describe, expect, it } from "vitest";
import {
  compareSessionsForDisplay,
  effectiveSessionConnections,
  effectiveSessionRdpPort,
  listGroups,
  listSessions,
  mergeSessionFormDraft,
  normalizedSessionTunnels,
  rememberRdpSecurityTransport,
  sessionSshForwardArgs,
  sessionSshForwardSpecs,
  upsertGroup,
  upsertSession,
} from "./sessions";

describe("saved Connection groups", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and clears the shared group frame color", () => {
    upsertGroup({
      id: "group-1",
      name: "Production",
      color: "#ef4444",
      order: 0,
      createdAt: 1,
    });

    expect(listGroups()[0].color).toBe("#ef4444");

    upsertGroup({ ...listGroups()[0], color: undefined });
    expect(listGroups()[0].color).toBeUndefined();
  });

  it("keeps connection cards stable when their last-used time changes", () => {
    const older = {
      id: "older",
      name: "Older",
      protocol: "ssh" as const,
      host: "older.example.test",
      port: 22,
      username: "admin",
      createdAt: 1,
      lastUsedAt: 500,
    };
    const newer = {
      ...older,
      id: "newer",
      name: "Newer",
      createdAt: 2,
      lastUsedAt: 100,
    };

    expect([newer, older].sort(compareSessionsForDisplay).map((session) => session.id))
      .toEqual(["older", "newer"]);
  });
});

describe("session RDP ports", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses an override before protocol defaults", () => {
    expect(effectiveSessionRdpPort({ protocol: "ssh", port: 22 })).toBe(3389);
    expect(effectiveSessionRdpPort({ protocol: "ssh", port: 22, rdpPort: 43389 })).toBe(43389);
    expect(effectiveSessionRdpPort({ protocol: "rdp", port: 3390 })).toBe(3390);
    expect(effectiveSessionRdpPort({ protocol: "rdp", port: 3390, rdpPort: 3391 })).toBe(3391);
  });

  it("drops invalid persisted overrides", () => {
    upsertSession({
      id: "rdp-invalid-port",
      name: "RDP",
      protocol: "ssh",
      host: "host.example",
      port: 22,
      username: "user",
      rdpPort: 99999,
      createdAt: 1,
    });
    expect(listSessions()[0].rdpPort).toBeUndefined();
  });
});

describe("session SSH tunnels", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("normalizes valid tunnel rows and drops invalid rows", () => {
    const tunnels = normalizedSessionTunnels({
      sshTunnels: [
        { id: "a", localPort: 15443, destinationHost: "10.0.0.5", destinationPort: 443 },
        { id: "bad-port", localPort: 0, destinationHost: "10.0.0.6", destinationPort: 443 },
        { id: "bad-host", localPort: 18080, destinationHost: " ", destinationPort: 80 },
      ],
    });

    expect(tunnels).toEqual([
      { id: "a", localPort: 15443, destinationHost: "10.0.0.5", destinationPort: 443 },
    ]);
  });

  it("deduplicates tunnel rows and formats SSH -L args", () => {
    const session = {
      sshTunnels: [
        { id: "a", localPort: 15443, destinationHost: "Server.local", destinationPort: 443 },
        { id: "b", localPort: 15443, destinationHost: "server.local", destinationPort: 443 },
        { id: "c", localPort: 18080, destinationHost: "10.0.0.5", destinationPort: 80 },
      ],
    };

    expect(sessionSshForwardSpecs(session)).toEqual([
      "15443:Server.local:443",
      "18080:10.0.0.5:80",
    ]);
    expect(sessionSshForwardArgs(session)).toEqual([
      "-L",
      "15443:Server.local:443",
      "-L",
      "18080:10.0.0.5:80",
    ]);
  });

  it("preserves tunnels when a stale settings draft is saved after tunnel edits", () => {
    upsertSession({
      id: "session-1",
      name: "Router",
      protocol: "ssh",
      host: "10.0.0.1",
      port: 22,
      username: "admin",
      createdAt: 1,
    });

    const staleSettingsDraft = listSessions()[0];
    upsertSession({
      ...staleSettingsDraft,
      sshTunnels: [
        { id: "t1", localPort: 15443, destinationHost: "10.10.10.10", destinationPort: 443 },
      ],
    });

    upsertSession(mergeSessionFormDraft({
      ...staleSettingsDraft,
      name: "Router edited",
    }));

    expect(listSessions()[0]).toMatchObject({
      name: "Router edited",
      sshTunnels: [
        { id: "t1", localPort: 15443, destinationHost: "10.10.10.10", destinationPort: 443 },
      ],
    });
  });

  it("persists a per-connection Browse open-mode override", () => {
    upsertSession({
      id: "web-1",
      name: "Dashboard",
      protocol: "web",
      host: "10.0.0.10",
      port: 443,
      username: "",
      webPorts: [443],
      browseOpenMode: "window",
      createdAt: 1,
    });

    expect(listSessions()[0].browseOpenMode).toBe("window");
  });

  it("defaults RDP security to NLA and remembers a successful transport", () => {
    upsertSession({
      id: "rdp-1",
      name: "Windows host",
      protocol: "rdp",
      host: "windows.example.test",
      port: 3389,
      username: "admin",
      createdAt: 1,
    });

    expect(listSessions()[0].rdpSecurity ?? "nla").toBe("nla");
    rememberRdpSecurityTransport("rdp-1", "tls");
    expect(listSessions()[0].rdpSecurity).toBe("tls");
  });

  it("persists a valid low-bandwidth RDP quality profile", () => {
    upsertSession({
      id: "rdp-quality-1",
      name: "Slow Windows host",
      protocol: "rdp",
      host: "slow.example.test",
      port: 3389,
      username: "admin",
      rdpQuality: "very_low_bandwidth",
      createdAt: 1,
    });

    expect(listSessions()[0].rdpQuality).toBe("very_low_bandwidth");
  });

  it("persists a valid RDP resolution preset", () => {
    upsertSession({
      id: "rdp-resolution-1",
      name: "Large Windows desktop",
      protocol: "rdp",
      host: "windows.example.test",
      port: 3389,
      username: "admin",
      rdpResolution: "2560x1440",
      createdAt: 1,
    });

    expect(listSessions()[0].rdpResolution).toBe("2560x1440");
  });

  it("keeps HTTPS ports when Browse is explicitly disabled", () => {
    const session = {
      id: "ssh-web-1",
      name: "Router",
      protocol: "ssh" as const,
      host: "10.0.0.10",
      port: 22,
      username: "admin",
      webPorts: [443, 8443],
      connections: { browse: false },
      createdAt: 1,
    };

    expect(effectiveSessionConnections(session).browse).toBe(false);
    expect(session.webPorts).toEqual([443, 8443]);
  });

  it("persists serial console settings", () => {
    upsertSession({
      id: "console-1",
      name: "Router console",
      protocol: "console",
      host: "/dev/cu.usbserial-01",
      port: 0,
      username: "",
      serial: {
        baudRate: 115200,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flowControl: "hardware",
      },
      createdAt: 1,
    });

    expect(listSessions()[0]).toMatchObject({
      protocol: "console",
      host: "/dev/cu.usbserial-01",
      serial: { baudRate: 115200, dataBits: 8, parity: "none", stopBits: 1, flowControl: "hardware" },
    });
  });

  it("persists only a 1Password reference, never resolved credentials", () => {
    upsertSession({
      id: "ssh-op",
      name: "Linux host",
      protocol: "ssh",
      host: "linux.example.test",
      port: 22,
      username: "admin",
      onePassword: {
        itemReference: "op://Infrastructure/Linux host",
        account: "CE Labs",
        password: "current-secret",
      } as any,
      createdAt: 1,
    });

    expect(listSessions()[0].onePassword).toEqual({
      itemReference: "op://Infrastructure/Linux host",
      account: "CE Labs",
    });
    expect(localStorage.getItem("catwalk.sessions")).not.toContain("current-secret");
  });
});
