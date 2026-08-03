// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installCaseSensitiveInputDefaults } from "./inputTextBehavior";

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.replaceChildren();
});

function expectCorrectionsDisabled(field: HTMLInputElement | HTMLTextAreaElement) {
  expect(field.getAttribute("autocorrect")).toBe("off");
  expect(field.getAttribute("autocapitalize")).toBe("none");
  expect(field.getAttribute("spellcheck")).toBe("false");
}

describe("case-sensitive input defaults", () => {
  it("disables text corrections on existing fields", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);

    uninstall = installCaseSensitiveInputDefaults();

    expectCorrectionsDisabled(input);
    expectCorrectionsDisabled(textarea);
  });

  it("disables text corrections on fields mounted later", async () => {
    uninstall = installCaseSensitiveInputDefaults();
    const wrapper = document.createElement("div");
    const input = document.createElement("input");
    input.type = "search";
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expectCorrectionsDisabled(input);
  });
});
