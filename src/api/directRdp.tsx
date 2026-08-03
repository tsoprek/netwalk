import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  effectiveSessionRdpPort,
  rdpResolutionDimensions,
  rememberRdpSecurityTransport,
  type RdpQualityProfile,
  type RdpSecurityTransport,
  type SavedSession,
} from "./sessions";
import { hasOnePasswordCredential, onePasswordErrorMessage, resolveOnePasswordLogin } from "./onePassword";
import { addLocalNotification } from "../notifications/localStore";
import { diagnosticEvent } from "./diagnostics";
import { useAppearance } from "../appearance/AppearanceContext";
import NotesIcon from "../components/NotesIcon";
import PasswordInput from "../components/PasswordInput";
import {
  matchesTerminalPasswordShortcut,
  onePasswordShortcutLabel,
} from "../terminals/passwordShortcut";
import { getSessionPrimaryUsername } from "./identities";

export interface DirectRdpLaunchRequest {
  sessionId: string;
  connectionId: string;
  title: string;
  host: string;
  port: number;
  username: string;
  domain: string;
  password: string;
  securityMode?: "nla" | "tls" | "rdp";
  qualityProfile?: RdpQualityProfile;
  theme?: {
    mode: "dark" | "medium" | "light";
    background: string;
    surface: string;
    border: string;
    text: string;
    muted: string;
    titlebar: string;
    accent: string;
  };
  width?: number;
  height?: number;
  resolutionOverride?: boolean;
}

export type DirectRdpEvent =
  | { type: "state"; sessionId: string; state: string; message: string }
  | { type: "certificate_challenge"; sessionId: string; host: string; port: number; subject: string; issuer: string; fingerprint: string; changed?: boolean }
  | { type: "error"; sessionId: string; code: string; message: string }
  | { type: "closed"; sessionId: string }
  | { type: "exit"; sessionId: string; success: boolean; code: number | null };

interface CredentialResult { username: string; domain: string; password: string }
interface CredentialPrompt { session: SavedSession; resolve: (value: CredentialResult | null) => void }
interface CompatibilityPrompt {
  session: SavedSession;
  message: string;
  tlsAttempted: boolean;
  reason: "tls_required" | "standard_security";
}
interface ReconnectPrompt {
  session: SavedSession;
  engine: "ironrdp" | "freerdp";
  securityMode: RdpSecurityTransport;
  phase: "reconnecting" | "exhausted";
}
interface ActiveDirectRdpSession {
  session: SavedSession;
  securityMode: RdpSecurityTransport;
  engine: "ironrdp" | "freerdp";
  startedAt: number;
  connected: boolean;
  failureTracked: boolean;
  negotiationRetryCredentials?: CredentialResult;
}

interface DirectRdpContextValue {
  launchSavedRdp: (session: SavedSession) => Promise<void>;
}

const DirectRdpContext = createContext<DirectRdpContextValue | null>(null);
const DIRECT_RDP_CONNECTIVITY_EVENT = "catwalk:direct-rdp-connectivity";

export function reportDirectRdpConnectivity(online: boolean | null): void {
  window.dispatchEvent(new CustomEvent(DIRECT_RDP_CONNECTIVITY_EVENT, {
    detail: { online },
  }));
}

function rdpLog(level: "debug" | "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}) {
  diagnosticEvent("rdp", level, "catwalk.direct-rdp", message, fields);
  let debugEnabled = false;
  try { debugEnabled = localStorage.getItem("catwalk.rdpDebug") === "1"; } catch { /* diagnostics still records warnings/errors */ }
  if ((level === "debug" || level === "info") && !debugEnabled) return;
  (console[level] ?? console.log).call(console, `[ConneCat Direct RDP] ${message}`, fields);
}

function isMacOs(): boolean {
  return navigator.userAgent.includes("Macintosh") || navigator.userAgent.includes("Mac OS X");
}

function isWindows(): boolean {
  return navigator.userAgent.includes("Windows");
}

function supportsConneCatRdp(): boolean {
  return isMacOs() || isWindows();
}

function trackRdpUsage(
  actionId: string,
  outcome: "started" | "success" | "failure",
  engine: "ironrdp" | "freerdp" | "system",
  securityMode?: RdpSecurityTransport | "system",
  quantityValue?: number,
): void {
  void actionId;
  void outcome;
  void engine;
  void securityMode;
  void quantityValue;
}

function clearCredentialResult(credentials: CredentialResult | undefined): void {
  if (!credentials) return;
  credentials.username = "";
  credentials.domain = "";
  credentials.password = "";
}

function takeNegotiationRetryCredentials(activeSession: ActiveDirectRdpSession | undefined): CredentialResult | null {
  const credentials = activeSession?.negotiationRetryCredentials;
  if (activeSession) activeSession.negotiationRetryCredentials = undefined;
  return credentials ?? null;
}

function rdpDestinationKey(session: SavedSession): string {
  const host = session.host.trim().replace(/^\[(.*)]$/, "$1").toLowerCase();
  return `${host}:${effectiveSessionRdpPort(session)}`;
}

export function effectiveRdpApp(
  session: Pick<SavedSession, "rdpApp">,
  globalDefault?: "catwalk" | "freerdp" | "system",
): "catwalk" | "freerdp" | "system" {
  return session.rdpApp ?? globalDefault ?? (supportsConneCatRdp() ? "catwalk" : "system");
}

export function effectiveRdpSecurity(
  session: Pick<SavedSession, "rdpSecurity">,
  remembered?: RdpSecurityTransport,
): RdpSecurityTransport {
  // A user may change the saved transport while ConneCat is still running.
  // The current setting must win over an earlier successful fallback cached
  // for this connection, otherwise selecting TLS can unexpectedly reopen the
  // connection through FreeRDP with Standard RDP Security.
  return session.rdpSecurity ?? remembered ?? "nla";
}

export function DirectRdpProvider({ children }: { children: ReactNode }) {
  const { appearance } = useAppearance();
  const [credentialPrompt, setCredentialPrompt] = useState<CredentialPrompt | null>(null);
  const [compatibilityPrompt, setCompatibilityPrompt] = useState<CompatibilityPrompt | null>(null);
  const [reconnectPrompt, setReconnectPrompt] = useState<ReconnectPrompt | null>(null);
  const [certificateQueue, setCertificateQueue] = useState<Array<Extract<DirectRdpEvent, { type: "certificate_challenge" }>>>([]);
  const certificate = certificateQueue[0] ?? null;
  const [form, setForm] = useState<CredentialResult>({ username: "", domain: "", password: "" });
  const [credentialLookupBusy, setCredentialLookupBusy] = useState(false);
  const [credentialLookupError, setCredentialLookupError] = useState("");
  const credentialLookupRef = useRef(false);
  const credentialPromptGenerationRef = useRef(0);
  const sessionsRef = useRef(new Map<string, ActiveDirectRdpSession>());
  const pendingDestinationsRef = useRef(new Set<string>());
  const successfulSecurityRef = useRef(new Map<string, RdpSecurityTransport>());
  const authPromptingRef = useRef(new Set<string>());
  const reportedFailureRef = useRef(new Set<string>());

  useEffect(() => {
    const onConnectivity = (event: Event) => {
      const online = (event as CustomEvent<{ online?: boolean | null }>).detail?.online;
      if (online !== false) return;
      const activeSession = [...sessionsRef.current.values()]
        .find((session) => session.connected && session.engine === "freerdp");
      if (!activeSession) return;
      setReconnectPrompt((current) => current?.session.id === activeSession.session.id
        ? current
        : {
            session: activeSession.session,
            engine: activeSession.engine,
            securityMode: activeSession.securityMode,
            phase: "reconnecting",
          });
    };
    window.addEventListener(DIRECT_RDP_CONNECTIVITY_EVENT, onConnectivity);
    return () => window.removeEventListener(DIRECT_RDP_CONNECTIVITY_EVENT, onConnectivity);
  }, []);

  const requestCredentials = useCallback((session: SavedSession, errorMessage = "") => new Promise<CredentialResult | null>((resolve) => {
    rdpLog("info", "Showing direct RDP credential prompt", { connection_id: session.id, host: session.host });
    setForm({ username: session.username ?? "", domain: session.rdpDomain ?? "", password: "" });
    setCredentialLookupError(errorMessage);
    credentialPromptGenerationRef.current += 1;
    setCredentialPrompt({ session, resolve });
  }), []);

  const fillCredentialsFromOnePassword = useCallback(async () => {
    const prompt = credentialPrompt;
    if (!prompt || !hasOnePasswordCredential(prompt.session) || credentialLookupRef.current) return;
    credentialLookupRef.current = true;
    const promptGeneration = credentialPromptGenerationRef.current;
    setCredentialLookupBusy(true);
    setCredentialLookupError("");
    rdpLog("info", "RDP credential prompt requested 1Password", {
      connection_id: prompt.session.id,
      host: prompt.session.host,
    });
    try {
      const login = await resolveOnePasswordLogin(prompt.session.onePassword!);
      if (credentialPromptGenerationRef.current !== promptGeneration) return;
      setForm((current) => ({
        username: login.username || current.username || prompt.session.username,
        domain: current.domain || prompt.session.rdpDomain || "",
        password: login.password,
      }));
    } catch (error) {
      if (credentialPromptGenerationRef.current !== promptGeneration) return;
      const message = onePasswordErrorMessage(error);
      setCredentialLookupError(message);
      rdpLog("error", "RDP credential prompt 1Password request failed", {
        connection_id: prompt.session.id,
        error: message,
      });
    } finally {
      credentialLookupRef.current = false;
      setCredentialLookupBusy(false);
    }
  }, [credentialPrompt]);

  useEffect(() => {
    if (!credentialPrompt || !hasOnePasswordCredential(credentialPrompt.session)) return;
    const onPasswordShortcut = (event: KeyboardEvent) => {
      if (!matchesTerminalPasswordShortcut(event, appearance.onePasswordShortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      void fillCredentialsFromOnePassword();
    };
    window.addEventListener("keydown", onPasswordShortcut, true);
    return () => window.removeEventListener("keydown", onPasswordShortcut, true);
  }, [appearance.onePasswordShortcut, credentialPrompt, fillCredentialsFromOnePassword]);

  const launchWithCredentials = useCallback(async (
    session: SavedSession,
    credentials: CredentialResult,
    command: "launch_direct_rdp" | "launch_legacy_rdp" = "launch_direct_rdp",
    securityMode: RdpSecurityTransport = "nla",
  ) => {
    const port = effectiveSessionRdpPort(session);
    const sessionId = crypto.randomUUID?.() ?? `rdp-${Date.now()}-${Math.random()}`;
    const negotiationRetryCredentials = command === "launch_direct_rdp" && securityMode === "nla"
      ? { ...credentials }
      : undefined;
    const engine = command === "launch_legacy_rdp" ? "freerdp" : "ironrdp";
    sessionsRef.current.set(sessionId, {
      session,
      securityMode,
      engine,
      startedAt: Date.now(),
      connected: false,
      failureTracked: false,
      negotiationRetryCredentials,
    });
    trackRdpUsage("connection.start", "started", engine, securityMode);
    rdpLog("info", "Invoking direct RDP client", { session_id: sessionId, connection_id: session.id, host: session.host, port, engine });
    try {
      const computedStyle = getComputedStyle(document.documentElement);
      const themeColor = (property: string, fallback: string) =>
        computedStyle.getPropertyValue(property).trim() || fallback;
      const surface = themeColor("--panel", appearance.colorScheme === "light" ? "#ffffff" : "#1e293b");
      // Ask for a session that renders at the display's real pixel size
      // (capped) so /smart-sizing downscales instead of upscaling, which
      // keeps text crisp when the RDP window is enlarged on Retina/HiDPI.
      const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const resolution = rdpResolutionDimensions(session.rdpResolution);
      const rdpWidth = resolution?.width
        ?? Math.min(3840, Math.max(1024, Math.round((window.screen?.availWidth ?? 1600) * dpr)));
      const rdpHeight = resolution?.height
        ?? Math.min(2160, Math.max(768, Math.round((window.screen?.availHeight ?? 1000) * dpr)));
      await invoke(command, {
        request: {
          sessionId,
          connectionId: session.id,
          title: session.name || session.host,
          host: session.host,
          port,
          username: credentials.username,
          domain: credentials.domain,
          password: credentials.password,
          securityMode,
          qualityProfile: session.rdpQuality ?? "balanced",
          width: rdpWidth,
          height: rdpHeight,
          resolutionOverride: Boolean(resolution),
          theme: {
            mode: appearance.colorScheme,
            background: themeColor("--bg", appearance.colorScheme === "light" ? "#f8fafc" : "#0f172a"),
            surface,
            border: themeColor("--border", appearance.colorScheme === "light" ? "#cbd5e1" : "#334155"),
            text: themeColor("--fg", appearance.colorScheme === "light" ? "#0f172a" : "#e2e8f0"),
            muted: themeColor("--muted", appearance.colorScheme === "light" ? "#64748b" : "#94a3b8"),
            titlebar: surface,
            accent: themeColor("--accent", appearance.brand.accent || "#38bdf8"),
          },
        } satisfies DirectRdpLaunchRequest,
      });
      rdpLog("info", "Direct RDP client accepted launch", { session_id: sessionId, connection_id: session.id, engine });
    } catch (error) {
      const activeSession = sessionsRef.current.get(sessionId);
      if (activeSession && !activeSession.failureTracked) {
        activeSession.failureTracked = true;
        trackRdpUsage("connection.failure", "failure", activeSession.engine, activeSession.securityMode);
      }
      clearCredentialResult(activeSession?.negotiationRetryCredentials);
      sessionsRef.current.delete(sessionId);
      rdpLog("error", "Direct RDP launch command failed", { session_id: sessionId, connection_id: session.id, error: String(error) });
      throw error;
    } finally {
      clearCredentialResult(credentials);
    }
  }, [appearance]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<DirectRdpEvent>("catwalk://direct-rdp-event", ({ payload }) => {
      rdpLog(payload.type === "error" ? "error" : "debug", "Direct RDP event received", {
        session_id: payload.sessionId,
        event_type: payload.type,
        state: payload.type === "state" ? payload.state : undefined,
        code: payload.type === "error" || payload.type === "exit" ? payload.code : undefined,
      });
      if (payload.type === "certificate_challenge") {
        setCertificateQueue((current) => current.some((item) =>
          item.sessionId === payload.sessionId && item.fingerprint === payload.fingerprint)
          ? current
          : [...current, payload]);
        return;
      }
      if (payload.type === "state" && payload.state === "connected") {
        const activeSession = sessionsRef.current.get(payload.sessionId);
        setReconnectPrompt((current) =>
          current?.session.id === activeSession?.session.id ? null : current);
        if (activeSession) {
          if (!activeSession.connected) {
            activeSession.connected = true;
            trackRdpUsage(
              "connection.success",
              "success",
              activeSession.engine,
              activeSession.securityMode,
            );
          }
          clearCredentialResult(activeSession.negotiationRetryCredentials);
          activeSession.negotiationRetryCredentials = undefined;
          successfulSecurityRef.current.set(activeSession.session.id, activeSession.securityMode);
          rememberRdpSecurityTransport(activeSession.session.id, activeSession.securityMode);
          rdpLog("info", "Remembered successful RDP security transport", {
            session_id: payload.sessionId,
            connection_id: activeSession.session.id,
            security_mode: activeSession.securityMode,
          });
        }
      }
      if (payload.type === "state" && payload.state === "reconnecting") {
        const activeSession = sessionsRef.current.get(payload.sessionId);
        if (activeSession?.connected && activeSession.engine === "freerdp") {
          setReconnectPrompt({
            session: activeSession.session,
            engine: activeSession.engine,
            securityMode: activeSession.securityMode,
            phase: "reconnecting",
          });
        }
      }
      if (payload.type === "error") {
        setCertificateQueue((current) =>
          current.filter((item) => item.sessionId !== payload.sessionId));
        reportedFailureRef.current.add(payload.sessionId);
        const activeSession = sessionsRef.current.get(payload.sessionId);
        if (activeSession && !activeSession.failureTracked) {
          activeSession.failureTracked = true;
          trackRdpUsage(
            "connection.failure",
            "failure",
            activeSession.engine,
            activeSession.securityMode,
          );
        }
        const session = activeSession?.session;
        if (
          payload.code === "network_failed"
          && activeSession?.connected
          && activeSession.engine === "freerdp"
          && session
        ) {
          setReconnectPrompt({
            session,
            engine: activeSession.engine,
            securityMode: activeSession.securityMode,
            phase: "exhausted",
          });
        }
        const closeFailedViewer = invoke("disconnect_direct_rdp", { sessionId: payload.sessionId })
          .then(() => {
            rdpLog("debug", "Closed failed direct RDP viewer", {
              session_id: payload.sessionId,
              connection_id: session?.id,
            });
          })
          .catch((error) => {
            // The process may have already exited and removed itself from the
            // native session map. Either outcome means it cannot block retry.
            rdpLog("debug", "Failed direct RDP viewer was already closed", {
              session_id: payload.sessionId,
              connection_id: session?.id,
              error: String(error),
            });
          });
        if (payload.code === "security_protocol_unsupported" && session) {
          const reason = payload.message.toLowerCase().includes("requires enhanced rdp security")
            ? "tls_required"
            : "standard_security";
          const retryCredentials = takeNegotiationRetryCredentials(activeSession);
          sessionsRef.current.delete(payload.sessionId);
          if (activeSession.securityMode === "nla" && retryCredentials) {
            const retryCommand = reason === "standard_security"
              ? "launch_legacy_rdp"
              : "launch_direct_rdp";
            const retrySecurityMode: RdpSecurityTransport = reason === "standard_security"
              ? "rdp"
              : "tls";
            rdpLog(
              "info",
              reason === "standard_security"
                ? "RDP server selected Standard Security; switching automatically to FreeRDP"
                : "NLA negotiation failed; retrying automatically with TLS",
              {
              session_id: payload.sessionId,
              connection_id: session.id,
              host: session.host,
              },
            );
            void closeFailedViewer
              .then(() => launchWithCredentials(
                session,
                retryCredentials,
                retryCommand,
                retrySecurityMode,
              ))
              .catch((error) => {
                const message = onePasswordErrorMessage(error);
                rdpLog("error", reason === "standard_security"
                  ? "Automatic ConneCat FreeRDP fallback failed"
                  : "Automatic ConneCat RDP TLS retry failed", {
                  connection_id: session.id,
                  error: message,
                });
                addLocalNotification({ kind: "error", title: `RDP · ${session.name}`, body: message });
              });
            return;
          }
          clearCredentialResult(retryCredentials ?? undefined);
          setCompatibilityPrompt({
            session,
            message: payload.message,
            tlsAttempted: activeSession.securityMode === "tls",
            reason,
          });
          rdpLog("warn", "RDP server selected unsupported legacy security", {
            session_id: payload.sessionId,
            connection_id: session.id,
            host: session.host,
          });
          return;
        }
        clearCredentialResult(takeNegotiationRetryCredentials(activeSession) ?? undefined);
        if (
          payload.code !== "authentication_failed"
          && !(payload.code === "network_failed" && activeSession?.connected)
        ) {
          addLocalNotification({
            kind: "error",
            title: `RDP${session ? ` · ${session.name}` : ""}`,
            body: payload.message || "The direct RDP session failed.",
          });
        }
        if (payload.code === "authentication_failed" && session && !authPromptingRef.current.has(session.id)) {
          sessionsRef.current.delete(payload.sessionId);
          authPromptingRef.current.add(session.id);
          const retrySecurityMode = activeSession?.securityMode ?? session.rdpSecurity ?? "nla";
          void requestCredentials(
            session,
            "Windows rejected the RDP username, domain, or password. Check the credentials and try again.",
          )
            .then((credentials) => credentials
              ? launchWithCredentials(
                  session,
                  credentials,
                  retrySecurityMode === "rdp" ? "launch_legacy_rdp" : "launch_direct_rdp",
                  retrySecurityMode,
                )
              : undefined)
            .catch((error) => addLocalNotification({ kind: "error", title: `RDP · ${session.name}`, body: String(error) }))
            .finally(() => authPromptingRef.current.delete(session.id));
        }
      }
      if (payload.type === "exit" && !payload.success) {
        if (reportedFailureRef.current.delete(payload.sessionId)) {
          sessionsRef.current.delete(payload.sessionId);
          return;
        }
        const session = sessionsRef.current.get(payload.sessionId)?.session;
        const activeSession = sessionsRef.current.get(payload.sessionId);
        if (activeSession && !activeSession.failureTracked) {
          activeSession.failureTracked = true;
          trackRdpUsage(
            "connection.failure",
            "failure",
            activeSession.engine,
            activeSession.securityMode,
          );
        }
        addLocalNotification({
          kind: "error",
          title: `RDP${session ? ` · ${session.name}` : ""}`,
          body: `ConneCat RDP viewer exited unexpectedly${payload.code == null ? "." : ` (code ${payload.code}).`} Check Settings → Diagnostics → RDP.`,
        });
      }
      if (payload.type === "closed" || payload.type === "exit") {
        setCertificateQueue((current) =>
          current.filter((item) => item.sessionId !== payload.sessionId));
        const activeSession = sessionsRef.current.get(payload.sessionId);
        if (activeSession?.connected) {
          trackRdpUsage(
            "connection.end",
            "success",
            activeSession.engine,
            activeSession.securityMode,
            Math.max(0, Math.round((Date.now() - activeSession.startedAt) / 1000)),
          );
        }
        clearCredentialResult(activeSession?.negotiationRetryCredentials);
        sessionsRef.current.delete(payload.sessionId);
        reportedFailureRef.current.delete(payload.sessionId);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [launchWithCredentials, requestCredentials]);

  const launchSavedRdp = useCallback(async (requestedSession: SavedSession) => {
    const resolvedUsername = getSessionPrimaryUsername(requestedSession.id, requestedSession.username ?? "");
    const session = resolvedUsername === requestedSession.username
      ? requestedSession
      : { ...requestedSession, username: resolvedUsername };
    const port = effectiveSessionRdpPort(session);
    const selectedApp = effectiveRdpApp(session, appearance.savedConnectionRdpApp);
    const destination = rdpDestinationKey(session);
    const destinationActive = pendingDestinationsRef.current.has(destination)
      || [...sessionsRef.current.values()]
        .some((activeSession) => rdpDestinationKey(activeSession.session) === destination);
    if (destinationActive) {
      rdpLog("warn", "Ignored duplicate RDP launch", {
        connection_id: session.id,
        host: session.host,
        port,
        destination,
      });
      addLocalNotification({
        kind: "info",
        title: `RDP · ${session.name}`,
        body: "A connection to this destination is already opening or connected.",
      });
      return;
    }
    pendingDestinationsRef.current.add(destination);
    rdpLog("info", "Saved Connection RDP clicked", {
      connection_id: session.id,
      host: session.host,
      port,
      username_source: resolvedUsername === requestedSession.username ? "saved_session" : "connection_identity",
      selected_app: selectedApp,
      catwalk_rdp_supported: supportsConneCatRdp(),
    });
    if (selectedApp === "system" || !supportsConneCatRdp()) {
      rdpLog("info", "Launching system RDP client", { connection_id: session.id, host: session.host, port });
      trackRdpUsage("connection.start", "started", "system", "system");
      try {
        await invoke("launch_rdp_host", { username: session.username, host: session.host, port });
        trackRdpUsage("connection.success", "success", "system", "system");
      } catch (error) {
        trackRdpUsage("connection.failure", "failure", "system", "system");
        throw error;
      } finally {
        pendingDestinationsRef.current.delete(destination);
      }
      return;
    }

    try {
      let credentials: CredentialResult | null;
      if (hasOnePasswordCredential(session)) {
        rdpLog("info", "Resolving direct RDP credential from 1Password", { connection_id: session.id });
        try {
          const login = await resolveOnePasswordLogin(session.onePassword!);
          credentials = { username: login.username || session.username, domain: session.rdpDomain ?? "", password: login.password };
        } catch (error) {
          throw new Error(onePasswordErrorMessage(error));
        }
      } else {
        credentials = await requestCredentials(session);
      }
      if (!credentials) {
        rdpLog("info", "Direct RDP credential prompt cancelled", { connection_id: session.id });
        return;
      }

      const securityMode = effectiveRdpSecurity(
        session,
        successfulSecurityRef.current.get(session.id),
      );
      await launchWithCredentials(
        session,
        credentials,
        selectedApp === "freerdp" || securityMode === "rdp"
          ? "launch_legacy_rdp"
          : "launch_direct_rdp",
        securityMode,
      );
    } finally {
      pendingDestinationsRef.current.delete(destination);
    }
  }, [appearance.savedConnectionRdpApp, launchWithCredentials, requestCredentials]);

  const closeCredentialPrompt = (result: CredentialResult | null) => {
    const prompt = credentialPrompt;
    credentialPromptGenerationRef.current += 1;
    setCredentialPrompt(null);
    setForm((current) => ({ ...current, password: "" }));
    setCredentialLookupError("");
    prompt?.resolve(result);
  };

  const submitCredentialPrompt = (
    formElement: HTMLFormElement,
    source: "button_or_form" | "keyboard",
  ) => {
    if (credentialLookupBusy) return;
    const values = new FormData(formElement);
    const username = String(values.get("username") ?? form.username).trim();
    const domain = String(values.get("domain") ?? form.domain).trim();
    const password = String(values.get("password") ?? form.password);
    if (!username || !password) {
      rdpLog("warn", "RDP credential prompt submission blocked", {
        connection_id: credentialPrompt?.session.id,
        source,
        has_username: Boolean(username),
        has_password: Boolean(password),
      });
      return;
    }
    rdpLog("info", "RDP credential prompt submitted", {
      connection_id: credentialPrompt?.session.id,
      source,
    });
    closeCredentialPrompt({ username, domain, password });
  };

  const onCredentialSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitCredentialPrompt(event.currentTarget, "button_or_form");
  };

  const onCredentialKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    const enter = event.key === "Enter"
      || event.code === "Enter"
      || event.code === "NumpadEnter";
    if (
      !enter
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || event.nativeEvent.isComposing
      || (event.target as HTMLElement | null)?.tagName !== "INPUT"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    submitCredentialPrompt(event.currentTarget, "keyboard");
  };

  const decideCertificate = async (decision: "connect_once" | "trust" | "cancel") => {
    const challenge = certificate;
    if (!challenge) return;
    setCertificateQueue((current) => current.filter((item) => item.sessionId !== challenge.sessionId || item.fingerprint !== challenge.fingerprint));
    await invoke("direct_rdp_certificate_decision", {
      sessionId: challenge.sessionId,
      fingerprint: challenge.fingerprint,
      decision,
      host: challenge.host,
      port: challenge.port,
    });
  };

  const openSystemCompatibilityClient = async () => {
    const prompt = compatibilityPrompt;
    if (!prompt) return;
    const port = effectiveSessionRdpPort(prompt.session);
    setCompatibilityPrompt(null);
    rdpLog("info", "Opening system RDP client for legacy-security server", {
      connection_id: prompt.session.id,
      host: prompt.session.host,
      port,
    });
    try {
      await invoke("launch_rdp_host", { username: prompt.session.username, host: prompt.session.host, port });
    } catch (error) {
      rdpLog("error", "System RDP compatibility launch failed", { connection_id: prompt.session.id, error: String(error) });
      addLocalNotification({ kind: "error", title: `RDP · ${prompt.session.name}`, body: String(error) });
    }
  };

  const openFreeRdpCompatibilityClient = async () => {
    const prompt = compatibilityPrompt;
    if (!prompt) return;
    setCompatibilityPrompt(null);
    rdpLog("info", "Opening ConneCat FreeRDP for legacy-security server", {
      connection_id: prompt.session.id,
      host: prompt.session.host,
    });
    try {
      let credentials: CredentialResult | null;
      if (hasOnePasswordCredential(prompt.session)) {
        const login = await resolveOnePasswordLogin(prompt.session.onePassword!);
        credentials = {
          username: login.username || prompt.session.username,
          domain: prompt.session.rdpDomain ?? "",
          password: login.password,
        };
      } else {
        credentials = await requestCredentials(prompt.session);
      }
      if (credentials) await launchWithCredentials(prompt.session, credentials, "launch_legacy_rdp", "rdp");
    } catch (error) {
      const message = onePasswordErrorMessage(error);
      rdpLog("error", "ConneCat FreeRDP compatibility launch failed", { connection_id: prompt.session.id, error: message });
      addLocalNotification({ kind: "error", title: `RDP · ${prompt.session.name}`, body: message });
    }
  };

  const openConneCatTlsCompatibilityClient = async () => {
    const prompt = compatibilityPrompt;
    if (!prompt) return;
    setCompatibilityPrompt(null);
    rdpLog("info", "Retrying through branded ConneCat RDP with TLS security", {
      connection_id: prompt.session.id,
      host: prompt.session.host,
    });
    try {
      let credentials: CredentialResult | null;
      if (hasOnePasswordCredential(prompt.session)) {
        const login = await resolveOnePasswordLogin(prompt.session.onePassword!);
        credentials = {
          username: login.username || prompt.session.username,
          domain: prompt.session.rdpDomain ?? "",
          password: login.password,
        };
      } else {
        credentials = await requestCredentials(prompt.session);
      }
      if (credentials) await launchWithCredentials(prompt.session, credentials, "launch_direct_rdp", "tls");
    } catch (error) {
      const message = onePasswordErrorMessage(error);
      rdpLog("error", "ConneCat RDP TLS compatibility launch failed", { connection_id: prompt.session.id, error: message });
      addLocalNotification({ kind: "error", title: `RDP · ${prompt.session.name}`, body: message });
    }
  };

  const closeInterruptedSession = async () => {
    const prompt = reconnectPrompt;
    setReconnectPrompt(null);
    if (!prompt) return;
    const active = [...sessionsRef.current.entries()]
      .find(([, session]) => session.session.id === prompt.session.id);
    if (!active) return;
    try {
      await invoke("disconnect_direct_rdp", { sessionId: active[0] });
    } catch {
      // The external client may have completed its own exit concurrently.
    }
  };

  const reconnectInterruptedSession = async () => {
    const prompt = reconnectPrompt;
    if (!prompt) return;
    setReconnectPrompt(null);
    rdpLog("info", "User requested RDP reconnect after retry exhaustion", {
      connection_id: prompt.session.id,
      engine: prompt.engine,
      security_mode: prompt.securityMode,
    });
    try {
      const active = [...sessionsRef.current.entries()]
        .find(([, session]) => session.session.id === prompt.session.id);
      if (active) {
        try {
          await invoke("disconnect_direct_rdp", { sessionId: active[0] });
        } catch {
          // The RDP process may have completed its exit concurrently.
        }
      }
      let credentials: CredentialResult | null;
      if (hasOnePasswordCredential(prompt.session)) {
        const login = await resolveOnePasswordLogin(prompt.session.onePassword!);
        credentials = {
          username: login.username || prompt.session.username,
          domain: prompt.session.rdpDomain ?? "",
          password: login.password,
        };
      } else {
        credentials = await requestCredentials(prompt.session);
      }
      if (!credentials) return;
      await launchWithCredentials(
        prompt.session,
        credentials,
        prompt.engine === "freerdp" ? "launch_legacy_rdp" : "launch_direct_rdp",
        prompt.securityMode,
      );
    } catch (error) {
      const message = onePasswordErrorMessage(error);
      addLocalNotification({
        kind: "error",
        title: `RDP · ${prompt.session.name}`,
        body: message,
      });
    }
  };

  return <DirectRdpContext.Provider value={{ launchSavedRdp }}>
    {children}
    {reconnectPrompt && <aside className={`card app-dialog direct-rdp-reconnect-status${reconnectPrompt.engine === "freerdp" ? " direct-rdp-reconnect-status--compact" : ""}`} role="dialog" aria-modal="false" aria-live="polite" aria-labelledby="rdp-reconnect-title">
        <header className="app-dialog-header">
          <span className="app-dialog-icon" aria-hidden="true"><NotesIcon name="sync" size={21} /></span>
          <div>
            <h3 id="rdp-reconnect-title">{reconnectPrompt.engine === "freerdp"
              ? reconnectPrompt.phase === "reconnecting" ? "FreeRDP reconnecting" : "FreeRDP interrupted"
              : reconnectPrompt.phase === "reconnecting" ? "Reconnecting RDP" : "RDP connection interrupted"}</h3>
            <p>{reconnectPrompt.session.name} · {reconnectPrompt.session.host}:{effectiveSessionRdpPort(reconnectPrompt.session)}</p>
          </div>
        </header>
        <div className="app-dialog-body">
          <p>{reconnectPrompt.phase === "reconnecting"
            ? reconnectPrompt.engine === "freerdp"
              ? "Waiting for VPN or network. Closes automatically after reconnect."
              : "ConneCat RDP is waiting for the VPN or network to return. This dialog closes automatically when the desktop reconnects."
            : reconnectPrompt.engine === "freerdp"
              ? "Automatic retries finished. Restore the network, then reopen FreeRDP."
              : "Automatic reconnect attempts are finished. Restore the VPN or network, then reconnect the session."}</p>
        </div>
        <div className="app-dialog-actions">
          <button
            type="button"
            className={`outline-action-button outline-action-button--muted${reconnectPrompt.engine === "freerdp" ? " outline-action-button--icon" : ""}`}
            aria-label={reconnectPrompt.phase === "reconnecting" ? "Close FreeRDP session" : "Close reconnect notice"}
            title={reconnectPrompt.phase === "reconnecting" ? "Close session" : "Close"}
            onClick={() => void closeInterruptedSession()}
          >
            <NotesIcon name="cancel" size={15} />
            {reconnectPrompt.engine !== "freerdp" && (reconnectPrompt.phase === "reconnecting" ? "Close session" : "Close")}
          </button>
          {(reconnectPrompt.engine !== "freerdp" || reconnectPrompt.phase === "exhausted") && (
            <button
              type="button"
              className={`outline-action-button${reconnectPrompt.engine === "freerdp" ? " outline-action-button--icon" : ""}`}
              aria-label={reconnectPrompt.engine === "freerdp" ? "Reopen FreeRDP session" : reconnectPrompt.phase === "reconnecting" ? "Reconnect RDP now" : "Reconnect RDP session"}
              title={reconnectPrompt.engine === "freerdp" ? "Reopen FreeRDP" : reconnectPrompt.phase === "reconnecting" ? "Reconnect now" : "Reconnect"}
              onClick={() => void reconnectInterruptedSession()}
            >
              <NotesIcon name="sync" size={15} />
              {reconnectPrompt.engine !== "freerdp" && (reconnectPrompt.phase === "reconnecting" ? "Try now" : "Reconnect")}
            </button>
          )}
        </div>
    </aside>}
    {credentialPrompt && <div className="app-dialog-backdrop" onMouseDown={() => closeCredentialPrompt(null)}>
      <form className="card app-dialog direct-rdp-dialog direct-rdp-credential-dialog" role="dialog" aria-modal="true" aria-labelledby="rdp-credentials-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={onCredentialKeyDown} onSubmit={onCredentialSubmit}>
        <header className="app-dialog-header">
          <span className="app-dialog-icon" aria-hidden="true"><NotesIcon name="rdp" size={21} /></span>
          <div>
            <h3 id="rdp-credentials-title">RDP credentials</h3>
            <p>{credentialPrompt.session.name} · {credentialPrompt.session.host}:{effectiveSessionRdpPort(credentialPrompt.session)}</p>
          </div>
        </header>
        <div className="app-dialog-body direct-rdp-credential-fields">
          <div className="direct-rdp-credential-row">
            <label><span>Username</span><input name="username" autoFocus={!form.username.trim()} autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
            <label><span>Domain <span className="muted">(optional)</span></span><input name="domain" value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} /></label>
          </div>
          <label><span>Password</span><PasswordInput name="password" autoFocus={Boolean(form.username.trim())} autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          {credentialLookupError && <p className="error-banner" role="alert">{credentialLookupError}</p>}
          {hasOnePasswordCredential(credentialPrompt.session) && (
            <p className="direct-rdp-credential-hint">Use the configured 1Password Login with <kbd>{onePasswordShortcutLabel(appearance.onePasswordShortcut, isMacOs())}</kbd>. Credentials remain transient.</p>
          )}
        </div>
        <div className="app-dialog-actions">
          <button type="button" className="outline-action-button outline-action-button--muted btn-small" onClick={() => closeCredentialPrompt(null)}><NotesIcon name="cancel" size={14} />Cancel</button>
          {hasOnePasswordCredential(credentialPrompt.session) && <button type="button" className="outline-action-button outline-action-button--muted btn-small" disabled={credentialLookupBusy} onClick={() => void fillCredentialsFromOnePassword()}><NotesIcon name="choose" size={14} />{credentialLookupBusy ? "Opening…" : "1Password"}</button>}
          <button type="submit" className="outline-action-button btn-small" disabled={credentialLookupBusy || !form.username.trim() || !form.password}><NotesIcon name="rdp" size={14} />Connect</button>
        </div>
      </form>
    </div>}
    {compatibilityPrompt && <div className="app-dialog-backdrop" onMouseDown={() => setCompatibilityPrompt(null)}>
      <section className="card app-dialog direct-rdp-dialog direct-rdp-compatibility-dialog" role="dialog" aria-modal="true" aria-labelledby="legacy-rdp-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="app-dialog-header">
          <span className="app-dialog-icon" aria-hidden="true"><NotesIcon name="warning" size={21} /></span>
          <div>
            <h3 id="legacy-rdp-title">{compatibilityPrompt.tlsAttempted ? "Legacy RDP security required" : "NLA unavailable"}</h3>
            <p>{compatibilityPrompt.session.name}</p>
          </div>
        </header>
        <div className="app-dialog-body">
          <p>{compatibilityPrompt.tlsAttempted
            ? "ConneCat could not complete TLS negotiation with this RDP server."
            : compatibilityPrompt.reason === "tls_required"
              ? "The server requires Enhanced RDP Security, but it did not accept the initial NLA/CredSSP negotiation."
              : "The server selected Standard RDP Security instead of NLA/CredSSP."}</p>
          <p className="muted">{compatibilityPrompt.tlsAttempted
            ? "This older RC4-based mode requires ConneCat's FreeRDP fallback or your external RDP client."
            : "For xrdp servers, ConneCat can retry with TLS in the same branded viewer. TLS encrypts the session but uses the server's graphical login instead of NLA."}</p>
          <details className="app-dialog-details"><summary>Technical detail</summary><p className="fingerprint">{compatibilityPrompt.message}</p></details>
        </div>
        <div className="app-dialog-actions">
          <button type="button" className="outline-action-button outline-action-button--muted" onClick={() => setCompatibilityPrompt(null)}><NotesIcon name="cancel" size={15} />Cancel</button>
          <button type="button" className="outline-action-button outline-action-button--muted" onClick={() => void openSystemCompatibilityClient()}><NotesIcon name="rdp" size={15} />External RDP client</button>
          {compatibilityPrompt.tlsAttempted
            ? <button type="button" className="outline-action-button" autoFocus onClick={() => void openFreeRdpCompatibilityClient()}><NotesIcon name="rdp" size={15} />Open with ConneCat FreeRDP</button>
            : <button type="button" className="outline-action-button" autoFocus onClick={() => void openConneCatTlsCompatibilityClient()}><NotesIcon name="rdp" size={15} />Retry with ConneCat TLS</button>}
        </div>
      </section>
    </div>}
    {certificate && <div className="app-dialog-backdrop">
      <section className="card app-dialog direct-rdp-dialog direct-rdp-certificate-dialog" role="dialog" aria-modal="true" aria-labelledby="rdp-certificate-title">
        <header className="app-dialog-header">
          <span className="app-dialog-icon" aria-hidden="true"><NotesIcon name={certificate.changed ? "warning" : "rdp"} size={21} /></span>
          <div>
            <h3 id="rdp-certificate-title">{certificate.changed ? "RDP certificate changed" : "Trust RDP server?"}</h3>
            <p>{certificate.host}:{certificate.port}</p>
          </div>
        </header>
        <div className="app-dialog-body">
          <p className="muted">Verify the server identity before allowing this RDP connection.</p>
          <dl>
            <dt>Subject</dt><dd>{certificate.subject}</dd>
            <dt>Issuer</dt><dd>{certificate.issuer}</dd>
            <dt>SHA-256</dt><dd className="fingerprint">{certificate.fingerprint.match(/.{1,2}/g)?.join(":")}</dd>
          </dl>
          {certificate.changed && <p className="error-banner">The saved certificate differs. Verify the fingerprint before replacing trust.</p>}
        </div>
        <div className="app-dialog-actions">
          <button type="button" className="outline-action-button outline-action-button--muted" onClick={() => void decideCertificate("cancel")}><NotesIcon name="cancel" size={15} />Cancel</button>
          <button type="button" className="outline-action-button outline-action-button--muted" onClick={() => void decideCertificate("connect_once")}><NotesIcon name="rdp" size={15} />Connect once</button>
          <button type="button" className="outline-action-button" autoFocus onClick={() => void decideCertificate("trust")}><NotesIcon name={certificate.changed ? "sync" : "save"} size={15} />{certificate.changed ? "Replace trust" : "Trust and connect"}</button>
        </div>
      </section>
    </div>}
  </DirectRdpContext.Provider>;
}

export function useDirectRdp(): DirectRdpContextValue {
  const value = useContext(DirectRdpContext);
  if (!value) throw new Error("useDirectRdp must be used inside DirectRdpProvider");
  return value;
}
