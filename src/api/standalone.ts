import { invoke } from "@tauri-apps/api/core";

export type TerminalApp = string;
export interface SftpGuiApp { id: string; label: string }
export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mtime?: number | null;
  mode?: number | null;
}

export const SSH_APP_INAPP = "app";
export const SFTP_APP_INAPP = "app";
export const SFTP_APP_BROWSER = "browser";
export const SFTP_APP_SYSTEM = "system";
export const BROWSE_OPEN_IN_APP = "in_app" as const;
export const BROWSE_OPEN_WINDOW = "window" as const;
export const BROWSE_OPEN_EXTERNAL = "external" as const;

const SSH_KEY_PATH_KEY = "connecat.sshKeyPath";
const USERNAME_KEY = "connecat.username";

export function getSshKeyPath(): string | null {
  const value = localStorage.getItem(SSH_KEY_PATH_KEY)?.trim();
  return value || null;
}

export function setSshKeyPath(path: string | null): void {
  const value = path?.trim();
  if (value) localStorage.setItem(SSH_KEY_PATH_KEY, value);
  else localStorage.removeItem(SSH_KEY_PATH_KEY);
}

export function getUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY)?.trim() || null;
}

export async function detectTerminals(): Promise<TerminalApp[]> {
  return invoke<TerminalApp[]>("detect_terminals");
}

export async function detectSftpGuis(): Promise<SftpGuiApp[]> {
  return invoke<SftpGuiApp[]>("detect_sftp_guis");
}

export function urlHost(host: string): string {
  const value = host.trim();
  return value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
}

export function browseUrl(host: string, port: number): string {
  const scheme = port === 80 || port === 8000 || port === 8080 ? "http" : "https";
  return `${scheme}://${urlHost(host)}:${port}`;
}

export function probeHost(host: string, port: number): Promise<void> {
  return invoke("probe_host", { host, port });
}

export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export interface BrowserProxy { host: string; port: number; url: string }
export async function openUntrustedBrowserProxy(upstreamBase: string): Promise<BrowserProxy> {
  const value = await invoke<BrowserProxy | number>("open_untrusted_browser_proxy", { upstreamBase });
  return typeof value === "number"
    ? { host: "127.0.0.1", port: value, url: `http://127.0.0.1:${value}/` }
    : value;
}

export function sftpList(sessionId: number, path: string): Promise<SftpEntry[]> {
  return invoke("sftp_list", { id: sessionId, path });
}
export function sftpRealpath(sessionId: number, path: string): Promise<string> {
  return invoke("sftp_realpath", { id: sessionId, path });
}
export function sftpDownload(sessionId: number, remote: string, local: string, transferId: string): Promise<number> {
  return invoke("sftp_download", { id: sessionId, remote, local, transferId });
}
export function sftpUpload(sessionId: number, local: string, remote: string, transferId: string): Promise<number> {
  return invoke("sftp_upload", { id: sessionId, local, remote, transferId });
}
export function sftpCancelTransfer(transferId: string): Promise<boolean> {
  return invoke("sftp_cancel_transfer", { transferId });
}
export function sftpMkdir(sessionId: number, path: string): Promise<void> {
  return invoke("sftp_mkdir", { id: sessionId, path });
}
export function sftpRemove(sessionId: number, path: string, isDir: boolean): Promise<void> {
  return invoke("sftp_remove", { id: sessionId, path, isDir });
}
export function sftpRename(sessionId: number, from: string, to: string): Promise<void> {
  return invoke("sftp_rename", { id: sessionId, from, to });
}
export function sftpDisconnect(sessionId: number): Promise<void> {
  return invoke("sftp_disconnect", { id: sessionId });
}

export function getClientPlatformTag(): string {
  const platform = navigator.platform || "unknown";
  return platform.toLowerCase().replace(/ /g, "-");
}
