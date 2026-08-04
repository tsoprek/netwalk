export interface TerminalControlKeyEvent {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export type TerminalControlKeyMode = "session" | "local-shell" | "lab-session" | "hardware-session";

export function terminalControlSequenceForKeyEvent(
  ev: TerminalControlKeyEvent,
  opts: { mode?: TerminalControlKeyMode } = {},
): string | null {
  if (!ev.ctrlKey || ev.altKey || ev.metaKey) return null;

  const key = ev.key;
  const letter = key.length === 1 ? key.toUpperCase() : "";

  // ConnCat reserves Control+Tab for main-view navigation. Plain Tab never
  // reaches this helper and remains normal xterm input.
  if (key === "Tab") return null;

  // Leave common GUI copy/paste chords alone. Plain Ctrl+C/Ctrl+V remain
  // terminal input; Ctrl+Shift+C/V are the desktop-terminal copy/paste habit.
  if (ev.shiftKey && (letter === "C" || letter === "V" || ev.code === "Insert")) {
    return null;
  }

  // Raw Ctrl+A/Ctrl+E can be echoed as visible ^A/^E in some terminals, so most
  // modes synthesize Home/End. Hardware network CLIs expect the original bytes.
  if (opts.mode === "hardware-session") {
    if (letter === "A") return "\x01";
    if (letter === "E") return "\x05";
  }

  // Saved SSH Connections already work with CSI H/F. Local shells and VM/CML
  // Lab SSH sessions follow the xterm-256color terminfo khome/kend sequences.
  const useTerminfoHomeEnd = opts.mode === "local-shell" || opts.mode === "lab-session";
  if (letter === "A") return useTerminfoHomeEnd ? "\x1bOH" : "\x1b[H";
  if (letter === "E") return useTerminfoHomeEnd ? "\x1bOF" : "\x1b[F";

  if (letter >= "A" && letter <= "Z") {
    return String.fromCharCode(letter.charCodeAt(0) - 64);
  }

  switch (key) {
    case " ":
    case "@":
    case "`":
      return "\x00";
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
      return "\x1f";
    case "?":
      return "\x7f";
    case "Backspace":
      return "\x08";
    case "Enter":
      return "\x0d";
    default:
      return null;
  }
}
