import { describe, expect, it } from "vitest";
import {
  MAX_POOLED_MACOS_DOM_RENDERERS,
  resolveTerminalRenderer,
  shouldPoolTerminalRenderer,
  terminalRendererPoolLimit,
} from "./terminalRenderer";

describe("terminal renderer selection", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

  it("uses DOM for Auto on macOS", () => {
    expect(resolveTerminalRenderer("auto", mac)).toBe("dom");
  });

  it("uses WebGL for Auto off macOS", () => {
    expect(resolveTerminalRenderer("auto", windows)).toBe("webgl");
  });

  it("honors explicit renderer overrides", () => {
    expect(resolveTerminalRenderer("webgl", mac)).toBe("webgl");
    expect(resolveTerminalRenderer("dom", windows)).toBe("dom");
  });

  it("enables renderer reuse only for DOM terminals on macOS", () => {
    expect(shouldPoolTerminalRenderer("auto", mac)).toBe(true);
    expect(shouldPoolTerminalRenderer("dom", mac)).toBe(true);
    expect(shouldPoolTerminalRenderer("webgl", mac)).toBe(false);
    expect(shouldPoolTerminalRenderer("dom", windows)).toBe(false);
  });

  it("retains at most two DOM renderers while macOS terminals are live", () => {
    expect(MAX_POOLED_MACOS_DOM_RENDERERS).toBe(2);
    expect(terminalRendererPoolLimit("auto", 1, mac)).toBe(2);
    expect(terminalRendererPoolLimit("dom", 12, mac)).toBe(2);
  });

  it("retains no renderers without live terminals or outside macOS DOM mode", () => {
    expect(terminalRendererPoolLimit("dom", 0, mac)).toBe(0);
    expect(terminalRendererPoolLimit("dom", -1, mac)).toBe(0);
    expect(terminalRendererPoolLimit("webgl", 3, mac)).toBe(0);
    expect(terminalRendererPoolLimit("dom", 3, windows)).toBe(0);
  });
});
