import { describe, expect, it } from "vitest";
import { AnsiBackgroundFilter, buildAnsiTint } from "./ansiTint";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("terminal ANSI tint", () => {
  it("keeps the strong monochrome palette", () => {
    const palette = buildAnsiTint("#ff665c", "#202f49");

    expect(palette.red).toBe("#ff665c");
    expect(palette.blue).toBe("#ff665c");
    expect(palette.brightWhite).not.toBe(palette.red);
  });

  it("removes standard backgrounds while retaining foreground and formatting", () => {
    const filter = new AnsiBackgroundFilter();
    const result = filter.write(encoder.encode("\x1b[1;34;42mthinclient_drives\x1b[0m"));

    expect(decoder.decode(result)).toBe("\x1b[1;34mthinclient_drives\x1b[0m");
  });

  it("removes extended backgrounds split across PTY chunks", () => {
    const filter = new AnsiBackgroundFilter();
    const first = filter.write(encoder.encode("before\x1b[38;5;12;48;2;255"));
    const second = filter.write(encoder.encode(";0;0mtext\x1b[49m"));

    expect(decoder.decode(first)).toBe("before");
    expect(decoder.decode(second)).toBe("\x1b[38;5;12mtext\x1b[49m");
  });

  it("leaves reverse video and non-SGR control sequences unchanged", () => {
    const filter = new AnsiBackgroundFilter();
    const input = "\x1b[7mGNU nano\x1b[27m\x1b[2K";

    expect(decoder.decode(filter.write(encoder.encode(input)))).toBe(input);
  });
});
