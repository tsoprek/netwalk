interface RGB { r: number; g: number; b: number }

/** Build the strong single-hue palette users expect from terminal tinting. */
export function buildAnsiTint(accentHex: string, bgHex: string): Record<string, string> {
  const accent = parseHex(accentHex);
  const background = parseHex(bgHex);
  if (!accent || !background) return {};
  const white = { r: 255, g: 255, b: 255 };
  const dim = (amount: number) => toHex(mix(background, accent, amount));
  const lit = (amount: number) => toHex(mix(accent, white, amount));
  return {
    black: dim(0.25),
    brightBlack: dim(0.55),
    red: lit(0.0),
    brightRed: lit(0.2),
    green: lit(0.15),
    brightGreen: lit(0.35),
    yellow: lit(0.3),
    brightYellow: lit(0.5),
    blue: lit(0.0),
    brightBlue: lit(0.2),
    magenta: lit(0.1),
    brightMagenta: lit(0.3),
    cyan: lit(0.25),
    brightCyan: lit(0.45),
    white: lit(0.5),
    brightWhite: lit(0.7),
  };
}

/**
 * Remove explicit ANSI background colors from tinted output. A monochrome
 * palette cannot preserve contrast when tools combine two originally
 * different hues as foreground/background (for example `ls` 34;42), so
 * tinted tabs keep the foreground styling and use the terminal background.
 */
export class AnsiBackgroundFilter {
  private pending: number[] | null = null;

  write(input: Uint8Array): Uint8Array {
    const output: number[] = [];
    for (const byte of input) {
      if (this.pending) {
        this.pending.push(byte);
        if (this.pending.length === 2 && byte !== 0x5b) {
          output.push(...this.pending);
          this.pending = null;
        } else if (this.pending.length > 2 && byte >= 0x40 && byte <= 0x7e) {
          output.push(...filterSequence(this.pending));
          this.pending = null;
        } else if (this.pending.length > 128) {
          output.push(...this.pending);
          this.pending = null;
        }
      } else if (byte === 0x1b) {
        this.pending = [byte];
      } else {
        output.push(byte);
      }
    }
    return Uint8Array.from(output);
  }
}

function filterSequence(sequence: number[]): number[] {
  if (sequence[sequence.length - 1] !== 0x6d) return sequence;
  const body = String.fromCharCode(...sequence.slice(2, -1));
  const parameters = body.split(";");
  const retained: string[] = [];
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const code = Number(parameter);
    if (parameter.startsWith("48:")) continue;
    if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) continue;
    if (code === 48) {
      const mode = Number(parameters[index + 1]);
      if (mode === 5) index += 2;
      else if (mode === 2) index += 4;
      continue;
    }
    retained.push(parameter);
  }
  if (!retained.length) return [];
  return Array.from(new TextEncoder().encode(`\x1b[${retained.join(";")}m`));
}

export function parseHex(value: string): RGB | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return { r: (number >> 16) & 0xff, g: (number >> 8) & 0xff, b: number & 0xff };
}

function mix(from: RGB, to: RGB, amount: number): RGB {
  const ratio = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(from.r + (to.r - from.r) * ratio),
    g: Math.round(from.g + (to.g - from.g) * ratio),
    b: Math.round(from.b + (to.b - from.b) * ratio),
  };
}

function toHex(color: RGB): string {
  const component = (value: number) => value.toString(16).padStart(2, "0");
  return `#${component(color.r)}${component(color.g)}${component(color.b)}`;
}
