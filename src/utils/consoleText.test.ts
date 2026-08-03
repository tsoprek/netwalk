// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { chunkConsoleText, normalizeConsoleText } from "./consoleText";

describe("normalizeConsoleText", () => {
  it("unwraps attributed clipboard markup into plain console text", () => {
    const rich = '<font face="ui-monospace"><font color="color(srgb 0.8 0.8 0.8)"><span style="caret-color: color(srgb 0.8 0.8 0.8);">npm run catwalk:build -- --windows-msi</span></font></font>';
    expect(normalizeConsoleText(rich)).toBe("npm run catwalk:build -- --windows-msi");
  });

  it("unwraps WebKit font markup with collapsed-whitespace spans", () => {
    const rich = '<font color="#d6deea" face="Inter, system-ui"><span style="font-size: 14px; white-space-collapse: collapse;"><br></span></font><font color="#d6deea"><span style="font-size: 14px; white-space-collapse: collapse;">npm run catwalk:build — —build</span></font>';
    expect(normalizeConsoleText(rich)).toBe("\nnpm run catwalk:build — —build");
  });

  it("does not alter intentionally entered HTML or punctuation", () => {
    expect(normalizeConsoleText('<span class="example">hello</span>')).toBe('<span class="example">hello</span>');
    expect(normalizeConsoleText("printf '—'")).toBe("printf '—'");
  });

  it("removes rectangle-producing controls but preserves code whitespace", () => {
    expect(normalizeConsoleText("first\u001d\n\tsecond\r\n")).toBe("first\n\tsecond\r\n");
  });

  it("chunks remote input without splitting Unicode code points", () => {
    expect(chunkConsoleText("ab😀cd", 3)).toEqual(["ab😀", "cd"]);
    expect(chunkConsoleText("abcdef", 2)).toEqual(["ab", "cd", "ef"]);
  });
});
