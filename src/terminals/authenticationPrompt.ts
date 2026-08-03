const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

/** Detect an interactive SSH password prompt without retaining terminal output. */
export function hasSshPasswordPrompt(value: string): boolean {
  const visible = value
    .replace(ANSI_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  const lines = visible.split("\n");
  const line = lines[lines.length - 1] ?? "";
  return /(?:^|\s|['’])password(?:\s+for\s+[^:]{1,80})?\s*:\s*$/i.test(line);
}
