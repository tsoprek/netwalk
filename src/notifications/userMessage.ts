const MESSAGE_KEYS = [
  "msg",
  "message",
  "default_message",
  "detail",
  "error_description",
] as const;

function messageFromValue(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of MESSAGE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    const nested = messageFromValue(candidate);
    if (nested) return nested;
  }
  return messageFromValue(record.error);
}

function parseJsonMessage(raw: string): string | null {
  const starts = [raw.indexOf("{"), raw.indexOf("[")]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  for (const start of starts) {
    const closing = raw[start] === "{" ? "}" : "]";
    const end = raw.lastIndexOf(closing);
    if (end <= start) continue;
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      const message = messageFromValue(parsed);
      if (message) return message;
    } catch {
      // Some native/API errors truncate their JSON. The regex fallbacks below
      // still recover the common message fields without exposing the payload.
    }
  }
  return null;
}

/**
 * Convert native/API failures into text suitable for end users.
 *
 * Diagnostics retain the original error. UI notifications deliberately show
 * only the server's human message, without HTTP status boilerplate, error
 * codes, deployment-limit metadata, or raw JSON.
 */
export function userFacingMessage(error: unknown, fallback = "Something went wrong."): string {
  const raw = (
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : messageFromValue(error) ?? String(error ?? "")
  ).trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();
  if (
    normalized.includes("powered off")
    && (
      normalized.includes("not_allowed_in_current_state")
      || normalized.includes("invalidpowerstate")
      || normalized.includes("console ticket")
    )
  ) {
    return "VM is not powered on.";
  }

  const jsonMessage = parseJsonMessage(raw);
  if (jsonMessage) return jsonMessage;

  for (const key of MESSAGE_KEYS) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    if (!match) continue;
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1];
    }
  }

  const withoutErrorPrefix = raw.replace(/^Error:\s*/i, "");
  const withoutHttpStatus = withoutErrorPrefix.replace(
    /^(?:portal\s+)?\d{3}\s*(?:-\s*)?[^:]*:\s*/i,
    "",
  ).trim();
  return withoutHttpStatus || fallback;
}
