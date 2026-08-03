// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { installEditableControlCharacterGuard } from "./editableText";

describe("installEditableControlCharacterGuard", () => {
  it.each([
    ["Left Arrow", "\u001c"],
    ["Right Arrow", "\u001d"],
  ])("blocks the WebKit %s control character before it reaches a text input", (_key, character) => {
    const input = document.createElement("input");
    input.type = "search";
    document.body.append(input);
    const uninstall = installEditableControlCharacterGuard();
    const event = new InputEvent("beforeinput", { data: character, bubbles: true, cancelable: true, inputType: "insertText" });

    expect(input.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);

    uninstall();
    input.remove();
  });

  it("cleans controls from an input event and preserves the caret", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "ab\u001dcd";
    document.body.append(input);
    input.setSelectionRange(3, 3);
    const uninstall = installEditableControlCharacterGuard();

    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

    expect(input.value).toBe("abcd");
    expect(input.selectionStart).toBe(2);

    uninstall();
    input.remove();
  });

  it("does not alter number inputs or valid textarea whitespace", () => {
    const number = document.createElement("input");
    number.type = "number";
    const textarea = document.createElement("textarea");
    textarea.value = "one\n\ttwo";
    document.body.append(number, textarea);
    const uninstall = installEditableControlCharacterGuard();

    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(textarea.value).toBe("one\n\ttwo");
    expect(number.dispatchEvent(new InputEvent("beforeinput", { data: "\u001d", bubbles: true, cancelable: true }))).toBe(true);

    uninstall();
    number.remove();
    textarea.remove();
  });
});
