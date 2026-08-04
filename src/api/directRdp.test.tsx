// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSessions, upsertSession, type SavedSession } from "./sessions";
import { addIdentity, upsertAssignment } from "./identities";

const {
  invoke,
  listen,
  eventSink,
  hasOnePasswordCredential,
  resolveOnePasswordLogin,
} = vi.hoisted(() => {
  const eventSink: { handler?: (event: { payload: unknown }) => void } = {};
  return {
    invoke: vi.fn(),
    eventSink,
    hasOnePasswordCredential: vi.fn(() => false),
    resolveOnePasswordLogin: vi.fn(),
    listen: vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
      eventSink.handler = handler;
      return () => { if (eventSink.handler === handler) eventSink.handler = undefined; };
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("../notifications/localStore", () => ({ addLocalNotification: vi.fn() }));
vi.mock("../appearance/AppearanceContext", () => ({
  useAppearance: () => ({
    appearance: {
      savedConnectionRdpApp: "catwalk",
      onePasswordShortcut: "primaryShiftP",
      colorScheme: "dark",
      brand: { accent: "#38bdf8" },
    },
  }),
}));
vi.mock("./onePassword", () => ({
  hasOnePasswordCredential,
  onePasswordErrorMessage: (error: unknown) => String(error),
  resolveOnePasswordLogin,
}));

import {
  DirectRdpProvider,
  effectiveRdpApp,
  effectiveRdpSecurity,
  reportDirectRdpConnectivity,
  useDirectRdp,
} from "./directRdp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const session: SavedSession = {
  id: "connection-1",
  name: "Windows lab",
  protocol: "rdp",
  host: "win.lab.example",
  port: 3390,
  username: "alice",
  rdpDomain: "LAB",
  createdAt: 1,
};

function Harness({ value }: { value: SavedSession }) {
  const { launchSavedRdp } = useDirectRdp();
  return <button onClick={() => void launchSavedRdp(value)}>RDP</button>;
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  listen.mockClear();
  hasOnePasswordCredential.mockReset();
  hasOnePasswordCredential.mockReturnValue(false);
  resolveOnePasswordLogin.mockReset();
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("direct saved-connection RDP", () => {
  it("defaults to ConnCat on macOS and Windows, and system elsewhere", () => {
    expect(effectiveRdpApp({})).toBe("catwalk");
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(effectiveRdpApp({})).toBe("catwalk");
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (X11; Linux x86_64)" });
    expect(effectiveRdpApp({})).toBe("system");
    expect(effectiveRdpApp({ rdpApp: "catwalk" })).toBe("catwalk");
    expect(effectiveRdpApp({ rdpApp: "freerdp" })).toBe("freerdp");
    expect(effectiveRdpApp({}, "system")).toBe("system");
    expect(effectiveRdpApp({ rdpApp: "catwalk" }, "system")).toBe("catwalk");
  });

  it("uses the current saved security setting ahead of a stale successful fallback", () => {
    expect(effectiveRdpSecurity({ rdpSecurity: "tls" }, "rdp")).toBe("tls");
    expect(effectiveRdpSecurity({ rdpSecurity: "nla" }, "tls")).toBe("nla");
    expect(effectiveRdpSecurity({}, "tls")).toBe("tls");
    expect(effectiveRdpSecurity({})).toBe("nla");
  });

  it("prompts for transient credentials and passes domain over stdin launch config", async () => {
    await act(async () => root?.render(<DirectRdpProvider><Harness value={session} /></DirectRdpProvider>));
    await act(async () => container?.querySelector("button")?.click());

    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs).toHaveLength(3);
    expect(document.activeElement).toBe(inputs[2]);
    expect(container?.querySelector(".direct-rdp-credential-row")).not.toBeNull();
    expect(
      [...container!.querySelectorAll(".direct-rdp-credential-dialog .app-dialog-actions button")]
        .every((button) => button.classList.contains("btn-small")),
    ).toBe(true);
    await act(async () => {
      setInput(inputs[0], "alice");
      setInput(inputs[1], "LAB");
      setInput(inputs[2], "not-persisted");
    });
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());

    expect(invoke).toHaveBeenCalledWith("launch_direct_rdp", {
      request: expect.objectContaining({
        connectionId: "connection-1",
        host: "win.lab.example",
        port: 3390,
        username: "alice",
        domain: "LAB",
        password: "not-persisted",
        theme: {
          mode: "dark",
          background: "#0f172a",
          surface: "#1e293b",
          border: "#334155",
          text: "#e2e8f0",
          muted: "#94a3b8",
          titlebar: "#1e293b",
          accent: "#38bdf8",
        },
      }),
    });
    expect(session).not.toHaveProperty("password");
  });

  it("submits the Windows RDP credential prompt when Enter is pressed in password", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={session} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());

    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "enter-password"));
    await act(async () => {
      inputs[2].dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(invoke).toHaveBeenCalledWith("launch_direct_rdp", {
      request: expect.objectContaining({
        username: "alice",
        password: "enter-password",
      }),
    });
  });

  it("focuses username when the RDP prompt has no configured identity", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={{ ...session, username: "" }} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());

    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs[0].value).toBe("");
    expect(document.activeElement).toBe(inputs[0]);
  });

  it("prefills the RDP username from the Connection's primary local identity", async () => {
    const identity = addIdentity({
      kind: "literal",
      username: "tsoprek",
      source: "manual",
    });
    upsertAssignment({
      scope: { kind: "session", sessionId: session.id },
      identities: [{ identityId: identity.id, priority: 0 }],
      source: "self",
    });

    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={{ ...session, username: "" }} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());

    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs[0].value).toBe("tsoprek");
  });

  it("prefills the RDP username from the inherited global local identity", async () => {
    const identity = addIdentity({
      kind: "literal",
      username: "shared-rdp-user",
      source: "manual",
    });
    upsertAssignment({
      scope: { kind: "global" },
      identities: [{ identityId: identity.id, priority: 0 }],
      source: "self",
    });

    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={{ ...session, username: "" }} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());

    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    expect(inputs[0].value).toBe("shared-rdp-user");
  });

  it("keeps the explicit system-client fallback", async () => {
    await act(async () => root?.render(<DirectRdpProvider><Harness value={{ ...session, rdpApp: "system" }} /></DirectRdpProvider>));
    await act(async () => container?.querySelector("button")?.click());
    expect(invoke).toHaveBeenCalledWith("launch_rdp_host", { username: "alice", host: "win.lab.example", port: 3390 });
  });

  it("uses the RDP port override when RDP is enabled on an SSH Connection", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider>
        <Harness value={{
          ...session,
          protocol: "ssh",
          port: 22,
          rdpPort: 43389,
          rdpApp: "system",
        }} />
      </DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());

    expect(invoke).toHaveBeenCalledWith("launch_rdp_host", {
      username: "alice",
      host: "win.lab.example",
      port: 43389,
    });
  });

  it("allows FreeRDP as an explicit per-Connection client", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={{ ...session, rdpApp: "freerdp" }} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "free-rdp-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());

    expect(invoke).toHaveBeenCalledWith("launch_legacy_rdp", {
      request: expect.objectContaining({
        securityMode: "nla",
        password: "free-rdp-password",
      }),
    });

    const launch = invoke.mock.calls.find(([command]) => command === "launch_legacy_rdp")?.[1] as {
      request: { sessionId: string };
    };
    await act(async () => eventSink.handler?.({ payload: {
      type: "state",
      sessionId: launch.request.sessionId,
      state: "connected",
      message: "Connected.",
    } }));
    await act(async () => eventSink.handler?.({ payload: {
      type: "closed",
      sessionId: launch.request.sessionId,
    } }));
  });

  it("shows FreeRDP reconnect progress and offers a manual reconnect after exhaustion", async () => {
    const freeRdpSession = { ...session, rdpApp: "freerdp" as const };
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={freeRdpSession} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "free-rdp-password"));
    await act(async () =>
      (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    const launch = invoke.mock.calls.find(([command]) => command === "launch_legacy_rdp")?.[1] as {
      request: { sessionId: string };
    };

    await act(async () => eventSink.handler?.({ payload: {
      type: "state",
      sessionId: launch.request.sessionId,
      state: "connected",
      message: "Connected.",
    } }));
    await act(async () => reportDirectRdpConnectivity(false));
    expect(container?.textContent).toContain("FreeRDP reconnecting");
    expect(container?.textContent).toContain("Waiting for VPN or network");
    const reconnectCard = container?.querySelector(".direct-rdp-reconnect-status");
    expect(reconnectCard?.classList.contains("direct-rdp-reconnect-status--compact")).toBe(true);
    expect(reconnectCard?.getAttribute("aria-modal"))
      .toBe("false");
    expect(reconnectCard?.querySelector('button[aria-label="Reconnect FreeRDP now"]')).toBeNull();
    expect(reconnectCard?.querySelector('button[aria-label="Close FreeRDP session"]')).not.toBeNull();

    await act(async () => eventSink.handler?.({ payload: {
      type: "state",
      sessionId: launch.request.sessionId,
      state: "connected",
      message: "ConnCat FreeRDP connected",
    } }));
    expect(container?.textContent).not.toContain("FreeRDP reconnecting");

    await act(async () => reportDirectRdpConnectivity(false));
    await act(async () => eventSink.handler?.({ payload: {
      type: "error",
      sessionId: launch.request.sessionId,
      code: "network_failed",
      message: "The network remained unavailable.",
    } }));
    expect(container?.textContent).toContain("FreeRDP interrupted");
    const reconnect = container?.querySelector(
      'button[aria-label="Reopen FreeRDP session"]',
    ) as HTMLButtonElement | null;
    await act(async () => reconnect?.click());
    expect(container?.textContent).toContain("RDP credentials");
  });

  it("blocks duplicate launches to the same destination during credential resolution", async () => {
    const onePasswordSession: SavedSession = {
      ...session,
      onePassword: { itemReference: "op://Lab/Windows" },
    };
    hasOnePasswordCredential.mockReturnValue(true);
    let finishLookup: ((value: { username: string; password: string }) => void) | undefined;
    resolveOnePasswordLogin.mockReturnValue(new Promise((resolve) => {
      finishLookup = resolve;
    }));
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={onePasswordSession} /></DirectRdpProvider>,
    ));

    const button = container?.querySelector("button");
    await act(async () => {
      button?.click();
      button?.click();
      await Promise.resolve();
    });

    expect(resolveOnePasswordLogin).toHaveBeenCalledTimes(1);
    finishLookup?.({ username: "alice", password: "secret" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invoke.mock.calls.filter(([command]) => command === "launch_direct_rdp")).toHaveLength(1);
  });

  it("uses the shared ConnCat dialog and buttons for certificate trust", async () => {
    await act(async () => root?.render(<DirectRdpProvider><Harness value={session} /></DirectRdpProvider>));
    await act(async () => eventSink.handler?.({ payload: {
      type: "certificate_challenge",
      sessionId: "rdp-certificate-1",
      host: "win.lab.example",
      port: 3390,
      subject: "CN=win.lab.example",
      issuer: "CN=Lab CA",
      fingerprint: "00112233445566778899aabbccddeeff",
    } }));

    const dialog = container?.querySelector('[role="dialog"][aria-labelledby="rdp-certificate-title"]');
    expect(dialog?.classList.contains("app-dialog")).toBe(true);
    expect(dialog?.querySelector(".app-dialog-header")?.textContent).toContain("Trust RDP server?");
    expect(dialog?.querySelectorAll(".outline-action-button")).toHaveLength(3);
    const trust = [...(dialog?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent?.includes("Trust and connect"));
    await act(async () => trust?.click());
    expect(invoke).toHaveBeenCalledWith("direct_rdp_certificate_decision", expect.objectContaining({
      sessionId: "rdp-certificate-1",
      decision: "trust",
    }));
  });

  it("removes a certificate prompt when its viewer closes", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={session} /></DirectRdpProvider>,
    ));
    await act(async () => eventSink.handler?.({ payload: {
      type: "certificate_challenge",
      sessionId: "rdp-stale-certificate",
      host: "win.lab.example",
      port: 3390,
      subject: "CN=win.lab.example",
      issuer: "CN=Lab CA",
      fingerprint: "00112233445566778899aabbccddeeff",
    } }));
    expect(container?.textContent).toContain("Trust RDP server?");

    await act(async () => eventSink.handler?.({ payload: {
      type: "closed",
      sessionId: "rdp-stale-certificate",
    } }));
    expect(container?.textContent).not.toContain("Trust RDP server?");
  });

  it("starts with a saved TLS transport", async () => {
    await act(async () => root?.render(<DirectRdpProvider><Harness value={{ ...session, rdpSecurity: "tls" }} /></DirectRdpProvider>));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "tls-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());

    expect(invoke).toHaveBeenCalledWith("launch_direct_rdp", {
      request: expect.objectContaining({ securityMode: "tls" }),
    });
  });

  it("passes the saved low-bandwidth quality profile to the viewer", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={{ ...session, rdpQuality: "low_bandwidth" }} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "slow-link-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());

    expect(invoke).toHaveBeenCalledWith("launch_direct_rdp", {
      request: expect.objectContaining({ qualityProfile: "low_bandwidth" }),
    });
  });

  it("passes an explicit saved resolution to the viewer", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={{ ...session, rdpResolution: "1920x1080" }} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "full-hd-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());

    expect(invoke).toHaveBeenCalledWith("launch_direct_rdp", {
      request: expect.objectContaining({ width: 1920, height: 1080, resolutionOverride: true }),
    });
  });

  it("opens the compatibility client directly for a saved Standard RDP transport", async () => {
    await act(async () => root?.render(<DirectRdpProvider><Harness value={{ ...session, rdpSecurity: "rdp" }} /></DirectRdpProvider>));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "legacy-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());

    expect(invoke).toHaveBeenCalledWith("launch_legacy_rdp", {
      request: expect.objectContaining({ password: "legacy-password" }),
    });
  });

  it("fills a retry credential prompt from 1Password with Ctrl/Cmd+Shift+P", async () => {
    const onePasswordSession: SavedSession = {
      ...session,
      onePassword: { itemReference: "op://Lab/Windows" },
    };
    await act(async () => root?.render(<DirectRdpProvider><Harness value={onePasswordSession} /></DirectRdpProvider>));
    await act(async () => container?.querySelector("button")?.click());
    const initialInputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(initialInputs[2], "wrong-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    const launch = invoke.mock.calls.find(([command]) => command === "launch_direct_rdp")?.[1] as { request: { sessionId: string } };

    hasOnePasswordCredential.mockReturnValue(true);
    resolveOnePasswordLogin.mockResolvedValue({ username: "vault-admin", password: "vault-password" });
    await act(async () => eventSink.handler?.({ payload: {
      type: "error",
      sessionId: launch.request.sessionId,
      code: "authentication_failed",
      message: "CredSSP logon failed",
    } }));
    expect(container?.textContent).toContain("1Password");
    expect(container?.textContent).toContain("Windows rejected the RDP username");
    expect(container?.textContent).not.toContain("CredSSP logon failed");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "P", code: "KeyP", metaKey: true, shiftKey: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const retryInputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    expect(retryInputs[0].value).toBe("vault-admin");
    expect(retryInputs[2].value).toBe("vault-password");
    expect(resolveOnePasswordLogin).toHaveBeenCalledWith(onePasswordSession.onePassword);
  });

  it("automatically retries NLA negotiation failures with TLS before offering FreeRDP", async () => {
    upsertSession(session);
    await act(async () => root?.render(<DirectRdpProvider><Harness value={session} /></DirectRdpProvider>));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => {
      setInput(inputs[2], "not-persisted");
    });
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    const launch = invoke.mock.calls.find(([command]) => command === "launch_direct_rdp")?.[1] as { request: { sessionId: string } };

    await act(async () => {
      eventSink.handler?.({ payload: {
        type: "error",
        sessionId: launch.request.sessionId,
        code: "security_protocol_unsupported",
        message: "negotiation failure: server requires Enhanced RDP Security with TLS or CredSSP",
      } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledWith("disconnect_direct_rdp", { sessionId: launch.request.sessionId });
    expect(container?.textContent).not.toContain("NLA unavailable");
    const directLaunches = invoke.mock.calls.filter(([command]) => command === "launch_direct_rdp");
    expect(directLaunches[1]?.[1]).toEqual({
      request: expect.objectContaining({
        securityMode: "tls",
        password: "not-persisted",
      }),
    });
    const tlsLaunch = directLaunches[1]?.[1] as { request: { sessionId: string } };

    await act(async () => eventSink.handler?.({ payload: {
      type: "state",
      sessionId: tlsLaunch.request.sessionId,
      state: "connected",
      message: "Connected.",
    } }));
    expect(listSessions().find((candidate) => candidate.id === session.id)?.rdpSecurity).toBe("tls");

    await act(async () => eventSink.handler?.({ payload: {
      type: "error",
      sessionId: tlsLaunch.request.sessionId,
      code: "security_protocol_unsupported",
      message: "client advertised SSL, but server selected STANDARD_RDP_SECURITY",
    } }));
    expect(container?.textContent).toContain("Legacy RDP security required");
    const freeRdpButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Open with ConnCat FreeRDP");
    await act(async () => freeRdpButton?.click());
    const legacyInputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(legacyInputs[2], "legacy-password"));
    await act(async () => (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    expect(invoke).toHaveBeenCalledWith("launch_legacy_rdp", {
      request: expect.objectContaining({
        host: "win.lab.example",
        port: 3390,
        password: "legacy-password",
      }),
    });

  });

  it("switches directly from NLA to FreeRDP when the server selects Standard Security", async () => {
    await act(async () => root?.render(
      <DirectRdpProvider><Harness value={session} /></DirectRdpProvider>,
    ));
    await act(async () => container?.querySelector("button")?.click());
    const inputs = [...container!.querySelectorAll("input")] as HTMLInputElement[];
    await act(async () => setInput(inputs[2], "legacy-password"));
    await act(async () =>
      (container?.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    const launch = invoke.mock.calls.find(([command]) => command === "launch_direct_rdp")?.[1] as {
      request: { sessionId: string };
    };

    await act(async () => {
      eventSink.handler?.({ payload: {
        type: "error",
        sessionId: launch.request.sessionId,
        code: "security_protocol_unsupported",
        message: "client advertised HYBRID | HYBRID_EX, but server selected STANDARD_RDP_SECURITY",
      } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("disconnect_direct_rdp", {
      sessionId: launch.request.sessionId,
    });
    expect(container?.textContent).not.toContain("NLA unavailable");
    expect(invoke).toHaveBeenCalledWith("launch_legacy_rdp", {
      request: expect.objectContaining({
        host: "win.lab.example",
        port: 3390,
        securityMode: "rdp",
        password: "legacy-password",
      }),
    });
  });
});
