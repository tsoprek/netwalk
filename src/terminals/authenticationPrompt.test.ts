import { describe, expect, it } from "vitest";
import { hasSshPasswordPrompt } from "./authenticationPrompt";

describe("hasSshPasswordPrompt", () => {
  it("detects Cisco and OpenSSH password prompts", () => {
    expect(hasSshPasswordPrompt("Password: ")).toBe(true);
    expect(hasSshPasswordPrompt("admin@router's password: ")).toBe(true);
    expect(hasSshPasswordPrompt("Password for lab-user:\r")).toBe(true);
    expect(hasSshPasswordPrompt("[sudo] password for lab-user: ")).toBe(true);
  });

  it("ignores ANSI styling and cursor controls around the prompt", () => {
    expect(hasSshPasswordPrompt("\x1b[31mPassword:\x1b[0m ")).toBe(true);
    expect(hasSshPasswordPrompt("\x1b]0;ssh\x07user@host's password:\x1b[?25h")).toBe(true);
  });

  it("does not match ordinary terminal output", () => {
    expect(hasSshPasswordPrompt("Use a strong password." )).toBe(false);
    expect(hasSshPasswordPrompt("Password authentication enabled\n")).toBe(false);
  });
});
