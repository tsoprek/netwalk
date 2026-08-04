import { invoke } from "@tauri-apps/api/core";

export type DiagnosticChannelKey =
  | "core_ui" | "api" | "enrollment_updates" | "ssh_tunnel"
  | "browse_proxy" | "rdp" | "sftp";

export interface DiagnosticChannel {
  key: DiagnosticChannelKey;
  label: string;
  description: string;
  local_enabled: boolean;
  remote_enabled: boolean;
  effective_enabled: boolean;
}

export interface DiagnosticStatus {
  channels: DiagnosticChannel[];
  log_bytes: number;
  max_log_bytes: number;
  active_remote_request_id?: string | null;
}

export async function getDiagnosticStatus(): Promise<DiagnosticStatus> {
  return invoke<DiagnosticStatus>("diagnostics_status");
}

export async function setLocalDiagnosticChannels(channels: string[]): Promise<DiagnosticStatus> {
  return invoke<DiagnosticStatus>("diagnostics_set_local", { channels });
}

export async function exportDiagnosticBundle(destination: string, platform: string): Promise<number> {
  return invoke<number>("diagnostics_export", { destination, platform });
}

export async function clearDiagnosticLogs(): Promise<DiagnosticStatus> {
  return invoke<DiagnosticStatus>("diagnostics_clear_logs");
}

export function diagnosticEvent(
  channel: DiagnosticChannelKey,
  level: "debug" | "info" | "warn" | "error",
  target: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  void invoke("diagnostics_event", { channel, level, target, message, fields }).catch(() => {});
}

export function installFrontendDiagnostics(): () => void {
  const onError = (event: ErrorEvent) => diagnosticEvent("core_ui", "error", "webview.error", event.message, {
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : { reason: String(event.reason) };
    diagnosticEvent("core_ui", "error", "webview.unhandled-rejection", "Unhandled promise rejection", reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  diagnosticEvent("core_ui", "info", "webview.lifecycle", "ConneCat webview started", {
    user_agent: navigator.userAgent,
  });
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
