import { describe, expect, it } from "vitest";
import { terminalControlSequenceForKeyEvent } from "./controlKeys";

describe("terminalControlSequenceForKeyEvent", () => {
  it("maps readline movement shortcuts to terminal navigation sequences", () => {
    expect(terminalControlSequenceForKeyEvent({ key: "a", ctrlKey: true })).toBe("\x1b[H");
    expect(terminalControlSequenceForKeyEvent({ key: "E", ctrlKey: true })).toBe("\x1b[F");
  });

  it("uses xterm terminfo Home/End sequences for local shell movement shortcuts", () => {
    expect(terminalControlSequenceForKeyEvent({ key: "a", ctrlKey: true }, { mode: "local-shell" })).toBe("\x1bOH");
    expect(terminalControlSequenceForKeyEvent({ key: "E", ctrlKey: true }, { mode: "local-shell" })).toBe("\x1bOF");
  });

  it("uses xterm terminfo Home/End sequences for Lab session movement shortcuts", () => {
    expect(terminalControlSequenceForKeyEvent({ key: "a", ctrlKey: true }, { mode: "lab-session" })).toBe("\x1bOH");
    expect(terminalControlSequenceForKeyEvent({ key: "E", ctrlKey: true }, { mode: "lab-session" })).toBe("\x1bOF");
  });

  it("keeps readline movement shortcuts as control bytes for hardware sessions", () => {
    expect(terminalControlSequenceForKeyEvent({ key: "a", ctrlKey: true }, { mode: "hardware-session" })).toBe("\x01");
    expect(terminalControlSequenceForKeyEvent({ key: "E", ctrlKey: true }, { mode: "hardware-session" })).toBe("\x05");
  });

  it("maps common readline edit shortcuts that should remain control bytes", () => {
    expect(terminalControlSequenceForKeyEvent({ key: "u", ctrlKey: true })).toBe("\x15");
    expect(terminalControlSequenceForKeyEvent({ key: "k", ctrlKey: true })).toBe("\x0b");
    expect(terminalControlSequenceForKeyEvent({ key: "w", ctrlKey: true })).toBe("\x17");
    expect(terminalControlSequenceForKeyEvent({ key: "r", ctrlKey: true })).toBe("\x12");
  });

  it("maps non-letter control characters used by terminal apps", () => {
    expect(terminalControlSequenceForKeyEvent({ key: " ", ctrlKey: true })).toBe("\x00");
    expect(terminalControlSequenceForKeyEvent({ key: "[", ctrlKey: true })).toBe("\x1b");
    expect(terminalControlSequenceForKeyEvent({ key: "\\", ctrlKey: true })).toBe("\x1c");
    expect(terminalControlSequenceForKeyEvent({ key: "]", ctrlKey: true })).toBe("\x1d");
    expect(terminalControlSequenceForKeyEvent({ key: "^", ctrlKey: true })).toBe("\x1e");
    expect(terminalControlSequenceForKeyEvent({ key: "_", ctrlKey: true })).toBe("\x1f");
    expect(terminalControlSequenceForKeyEvent({ key: "?", ctrlKey: true })).toBe("\x7f");
  });

  it("does not steal app or desktop copy/paste shortcuts", () => {
    expect(terminalControlSequenceForKeyEvent({ key: "a", metaKey: true })).toBeNull();
    expect(terminalControlSequenceForKeyEvent({ key: "a", ctrlKey: true, altKey: true })).toBeNull();
    expect(terminalControlSequenceForKeyEvent({ key: "C", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(terminalControlSequenceForKeyEvent({ key: "V", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(terminalControlSequenceForKeyEvent({ key: "Insert", code: "Insert", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(terminalControlSequenceForKeyEvent({ key: "Tab", ctrlKey: true })).toBeNull();
    expect(terminalControlSequenceForKeyEvent({ key: "Tab", ctrlKey: true, shiftKey: true })).toBeNull();
  });
});
