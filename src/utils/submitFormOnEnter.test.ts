import { describe, expect, it, vi } from "vitest";
import { submitFormOnEnter } from "./submitFormOnEnter";

describe("submitFormOnEnter", () => {
  it("submits the containing form from username and password inputs", () => {
    const form = document.createElement("form");
    const username = document.createElement("input");
    const password = document.createElement("input");
    password.type = "password";
    form.append(username, password);
    document.body.appendChild(form);

    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    form.addEventListener("submit", submit);
    const requestSubmit = vi.spyOn(form, "requestSubmit");

    for (const input of [username, password]) {
      const event = {
        key: "Enter",
        target: input,
        preventDefault: vi.fn(),
      };
      expect(submitFormOnEnter(event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    expect(submit).toHaveBeenCalledTimes(2);
    expect(requestSubmit).not.toHaveBeenCalled();
    form.remove();
  });

  it("does not submit modified Enter, composition, or non-input controls", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    form.append(input, textarea);
    document.body.appendChild(form);
    const requestSubmit = vi.spyOn(form, "requestSubmit");

    expect(submitFormOnEnter({
      key: "Enter",
      target: input,
      shiftKey: true,
      preventDefault: vi.fn(),
    })).toBe(false);
    expect(submitFormOnEnter({
      key: "Enter",
      target: input,
      isComposing: true,
      preventDefault: vi.fn(),
    })).toBe(false);
    expect(submitFormOnEnter({
      key: "Enter",
      target: textarea,
      preventDefault: vi.fn(),
    })).toBe(false);

    expect(requestSubmit).not.toHaveBeenCalled();
    form.remove();
  });
});
