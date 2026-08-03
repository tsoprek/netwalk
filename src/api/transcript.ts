// Helpers for building per-spawn transcript file paths.
//
// Filename convention: `<sanitized-name>_YYYY-MM-DD_HH-MM-SS.log`
// where `name` is the connection / session label. The pty reader thread
// in Rust appends to this file with ANSI escapes stripped.

export function sanitizeTranscriptName(name: string): string {
  const trimmed = (name || "session").trim();
  // Restrict to a portable subset to keep names safe across filesystems.
  const cleaned = trimmed.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned.replace(/^_+|_+$/g, "") || "session";
}

export function transcriptTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`;
}

export interface TranscriptOpts {
  /// Effective on/off after applying overrides.
  enabled: boolean;
  /// Effective directory after applying overrides. Empty disables.
  dir: string;
  /// Display name to embed in the filename.
  name: string;
}

/// Resolve a transcript path. Returns undefined when transcript saving is
/// disabled or no directory is configured.
export function buildTranscriptPath(opts: TranscriptOpts): string | undefined {
  if (!opts.enabled) return undefined;
  const dir = (opts.dir || "").trim();
  if (!dir) return undefined;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const base = dir.endsWith("/") || dir.endsWith("\\") ? dir.slice(0, -1) : dir;
  return `${base}${sep}${sanitizeTranscriptName(opts.name)}_${transcriptTimestamp()}.log`;
}
