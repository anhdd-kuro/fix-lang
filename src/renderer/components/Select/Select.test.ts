/** Contract coverage for the shared themed Select. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from ".";

describe("Select", () => {
  it("uses themed control colors instead of the current text color", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Select,
        { "aria-label": "Profile" },
        createElement("option", { value: "default" }, "Default"),
      ),
    );

    expect(markup).toContain("border-control-border");
    expect(markup).toContain("bg-secondary");
    expect(markup).toContain("p-2");
    expect(markup).toContain("focus-visible:ring-ring");
    expect(markup).toContain("outline-none");
    expect(markup).not.toContain("border-current");
    expect(markup).not.toContain("ring-primary");
  });
});
