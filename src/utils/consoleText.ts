const RICH_CLIPBOARD_MARKUP = /<font\b[^>]*>[\s\S]*<span\b[^>]*style=["'][^"']*(?:caret-color|color\(srgb|white-space-collapse)[^"']*["']/i;

export function stripUnexpectedControlCharacters(text: string): string {
  // Preserve tab/newline/carriage return for terminals and code blocks. The
  // remaining C0 controls (notably U+001D from WebKit attributed text) render
  // as rectangles and are never useful note/console input.
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/**
 * Some WebView/OS clipboard combinations expose attributed text as literal
 * HTML in the nominal text/plain value. Only unwrap the distinctive rich-text
 * envelope so intentionally entered HTML remains untouched.
 */
export function normalizeConsoleText(text: string): string {
  if (!RICH_CLIPBOARD_MARKUP.test(text)) return stripUnexpectedControlCharacters(text);

  if (typeof DOMParser === "undefined") {
    return stripUnexpectedControlCharacters(text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&"));
  }

  const document = new DOMParser().parseFromString(text, "text/html");
  document.body.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return stripUnexpectedControlCharacters((document.body.textContent ?? "").replace(/\u00a0/g, " "));
}

/**
 * Split console input without cutting a Unicode code point in half. Remote
 * console SDKs emulate keyboard input and can drop their socket when a large
 * clipboard is submitted as one synthetic keyboard event.
 */
export function chunkConsoleText(text: string, maximumCodePoints = 64): string[] {
  const size = Math.max(1, Math.floor(maximumCodePoints));
  const codePoints = Array.from(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < codePoints.length; offset += size) {
    chunks.push(codePoints.slice(offset, offset + size).join(""));
  }
  return chunks;
}
