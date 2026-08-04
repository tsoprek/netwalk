import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  sessionSshForwardArgs,
  touchSession,
  type SavedSession,
} from "../api/sessions";
import { getSshKeyPath } from "../api/standalone";
import {
  hasOnePasswordCredential,
  resolveOnePasswordLogin,
} from "../api/onePassword";
import { pushSshDestPlain, pushSshDestWithVimFix } from "../api/sshVimFix";
import { useAppearance } from "../appearance/AppearanceContext";
import { useConsoles } from "../consoles/useConsoles";
import { buildTranscriptPath } from "../api/transcript";
import { useDirectRdp } from "../api/directRdp";
import { useTerminals } from "./TerminalsContext";

export interface SidebarLaunchers {
  launchSessionSsh: (session: SavedSession, userOverride?: string, group?: string) => Promise<void>;
  launchSessionSftpInApp: (session: SavedSession, group?: string) => Promise<void>;
  launchSessionSftpBrowser: (session: SavedSession) => Promise<void>;
  launchSessionRdp: (session: SavedSession) => Promise<void>;
}

export function useSidebarLaunchers(onError?: (message: string) => void): SidebarLaunchers {
  const navigate = useNavigate();
  const { open } = useTerminals();
  const { openSftp } = useConsoles();
  const { launchSavedRdp } = useDirectRdp();
  const { appearance } = useAppearance();

  const report = useCallback((error: unknown) => {
    onError?.(error instanceof Error ? error.message : String(error));
  }, [onError]);

  const extras = useCallback((session: SavedSession, title: string) => ({
    scrollback: session.scrollback ?? appearance.terminalScrollback,
    transcriptPath: buildTranscriptPath({
      enabled: session.saveTranscript ?? appearance.transcriptEnabled,
      dir: session.transcriptDir?.trim() || appearance.transcriptDir,
      name: title,
    }),
  }), [appearance.terminalScrollback, appearance.transcriptDir, appearance.transcriptEnabled]);

  const launchSessionSsh = useCallback(async (session: SavedSession, userOverride?: string, group?: string) => {
    try {
      if (session.protocol === "shell") {
        await open({
          title: session.name,
          cmd: session.shellCmd?.trim() || (navigator.userAgent.includes("Windows") ? "powershell.exe" : "/bin/sh"),
          args: [],
          accent: session.color,
          group,
          ...extras(session, session.name),
        });
      } else {
        const usesOnePassword = hasOnePasswordCredential(session);
        const credential = usesOnePassword
          ? await resolveOnePasswordLogin(session.onePassword!)
          : null;
        const user = credential?.username ?? userOverride ?? session.username ?? "";
        const args = ["-o", "StrictHostKeyChecking=accept-new", "-p", String(session.port || 22)];
        if (credential) {
          args.push("-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive");
        }
        if (session.keepalive && session.keepalive > 0) {
          args.push("-o", `ServerAliveInterval=${Math.floor(session.keepalive)}`, "-o", "ServerAliveCountMax=3");
        }
        const key = session.sshKeyPath?.trim() || getSshKeyPath();
        if (key && !credential) args.push("-i", key);
        args.push(...sessionSshForwardArgs(session));
        const destination = `${user}${user ? "@" : ""}${session.host}`;
        if (session.vimFix) pushSshDestWithVimFix(args, destination);
        else pushSshDestPlain(args, destination);
        await open({
          title: session.name,
          cmd: "ssh",
          args,
          accent: session.color,
          tintAnsi: session.tintAnsi,
          group,
          rowKey: `s:${session.id}`,
          autoPassword: credential?.password,
          authenticationLabel: usesOnePassword ? "1Password" : undefined,
          passwordCredential: usesOnePassword ? session.onePassword : undefined,
          ...extras(session, session.name),
        });
      }
      touchSession(session.id);
      navigate("/sessions");
    } catch (error) { report(error); }
  }, [extras, navigate, open, report]);

  const launchSessionSftpInApp = useCallback(async (session: SavedSession, group?: string) => {
    try {
      const usesOnePassword = hasOnePasswordCredential(session);
      const credential = usesOnePassword
        ? await resolveOnePasswordLogin(session.onePassword!)
        : null;
      const user = credential?.username ?? session.username ?? "";
      const args = ["-o", "StrictHostKeyChecking=accept-new", "-P", String(session.port || 22)];
      const key = session.sshKeyPath?.trim() || getSshKeyPath();
      if (credential) {
        args.push("-o", "PubkeyAuthentication=no", "-o", "PreferredAuthentications=password,keyboard-interactive");
      } else if (key) args.push("-i", key);
      args.push(`${user}${user ? "@" : ""}${session.host}`);
      await open({
        title: `${session.name} (sftp)`,
        cmd: "sftp",
        args,
        group,
        autoPassword: credential?.password,
        authenticationLabel: usesOnePassword ? "1Password" : undefined,
        passwordCredential: usesOnePassword ? session.onePassword : undefined,
        ...extras(session, session.name),
      });
      touchSession(session.id);
      navigate("/sessions");
    } catch (error) { report(error); }
  }, [extras, navigate, open, report]);

  const launchSessionSftpBrowser = useCallback(async (session: SavedSession) => {
    try {
      openSftp({
        host: session.host,
        port: session.port || 22,
        user: session.username || "",
        keyPath: session.sshKeyPath?.trim() || getSshKeyPath() || undefined,
        autoConnect: true,
        title: `${session.name} (sftp)`,
      });
      touchSession(session.id);
      navigate("/remote-access");
    } catch (error) { report(error); }
  }, [navigate, openSftp, report]);

  const launchSessionRdp = useCallback(async (session: SavedSession) => {
    try { await launchSavedRdp(session); } catch (error) { report(error); }
  }, [launchSavedRdp, report]);

  return { launchSessionSsh, launchSessionSftpInApp, launchSessionSftpBrowser, launchSessionRdp };
}
