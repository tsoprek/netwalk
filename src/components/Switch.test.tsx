import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Switch from "./Switch";

describe("Switch", () => {
  it("supports an explicit appearance sample while normal switches inherit the global style", () => {
    expect(renderToStaticMarkup(<Switch checked onChange={() => {}} style="slider" />)).toContain(
      'data-switch-button-style="slider"',
    );
    expect(renderToStaticMarkup(<Switch checked={false} onChange={() => {}} />)).not.toContain(
      "data-switch-button-style",
    );
  });
});
