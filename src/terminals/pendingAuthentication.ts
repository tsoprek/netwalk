import { invoke } from "@tauri-apps/api/core";

type WriteAuthenticationNotice = (id: number, message: string, level?: "info" | "error") => void;

export function pendingAuthenticationCommand(): { cmd: string; args: string[] } {
  if (navigator.userAgent.includes("Windows")) {
    return {
      cmd: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "Start-Sleep -Milliseconds 200; Write-Host 'Waiting for 1Password authorization...'; Start-Sleep -Seconds 300",
      ],
    };
  }
  return {
    cmd: "/bin/sh",
    args: ["-c", "sleep 0.2; printf 'Waiting for 1Password authorization...\\n'; sleep 300"],
  };
}

export async function failPendingAuthentication(
  tabId: number,
  service: string,
  message: string,
  writeNotice: WriteAuthenticationNotice,
): Promise<void> {
  writeNotice(
    tabId,
    `${service} sign-in failed: ${message}\nDouble-click this tab or choose Reconnect to try again.`,
    "error",
  );
  try {
    await invoke("pty_kill", { id: tabId });
  } catch {
    // The PTY may already have exited while the authorization error was
    // being reported. Its tab still retains the retry callback.
  }
}
