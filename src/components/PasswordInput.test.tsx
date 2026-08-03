// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import PasswordInput from "./PasswordInput";

describe("PasswordInput", () => {
  it("reveals and hides its value without changing it", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    act(() => root.render(<PasswordInput value="secret" readOnly />));
    const input = host.querySelector("input")!;
    const button = host.querySelector("button")!;
    expect(input.type).toBe("password");
    expect(button.getAttribute("aria-label")).toBe("Show password");

    act(() => button.click());
    expect(input.type).toBe("text");
    expect(input.value).toBe("secret");
    expect(button.getAttribute("aria-label")).toBe("Hide password");

    act(() => button.click());
    expect(input.type).toBe("password");
    act(() => root.unmount());
    host.remove();
  });
});
