/** Contract coverage for the shared themed Input / Textarea. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Input,
  Textarea,
  controlFocusBoxShadow,
  controlFocusClassName,
  inputControlClassName,
} from ".";

const focusTokens = [
  "outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-2",
  "focus-visible:ring-offset-background",
] as const;

const apiKeyChrome = [
  "rounded",
  "border",
  "border-control-border",
  "bg-secondary",
  "p-2",
  "text-sm",
  "text-foreground",
  "placeholder:text-muted-foreground",
] as const;

describe("Input", () => {
  it("pins the Button-matching focus ring and kills the UA outline", () => {
    for (const token of focusTokens) {
      expect(controlFocusClassName).toContain(token);
      expect(inputControlClassName).toContain(token);
    }
    expect(controlFocusClassName).not.toContain("focus-visible:outline-none");
    expect(inputControlClassName).not.toContain("ring-primary");
  });

  it("pins the General API key chrome as the default surface", () => {
    for (const token of apiKeyChrome) {
      expect(inputControlClassName).toContain(token);
    }
    expect(inputControlClassName).not.toContain("rounded-md");
    expect(inputControlClassName).not.toContain("bg-input");
    expect(inputControlClassName).not.toContain("px-3");
  });

  it("uses the CSS box-shadow equivalent of ring-2 + ring-offset-2 for non-Tailwind controls", () => {
    expect(controlFocusBoxShadow).toBe(
      "0 0 0 2px var(--background), 0 0 0 4px var(--ring)",
    );
  });

  it("renders a native input with themed chrome instead of the current text color", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, { "aria-label": "Name", placeholder: "Name" }),
    );

    expect(markup).toContain("border-control-border");
    expect(markup).toContain("bg-secondary");
    expect(markup).toContain("focus-visible:ring-ring");
    expect(markup).toContain("outline-none");
    expect(markup).not.toContain("ring-primary");
    expect(markup).not.toContain("bg-input");
  });

  it("lets caller geometry and surface classes take precedence", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, {
        className: "h-10 bg-card px-8",
        "aria-label": "Search",
      }),
    );

    expect(markup).toContain("h-10");
    expect(markup).toContain("bg-card");
    expect(markup).toContain("px-8");
    expect(markup).not.toContain("bg-secondary");
    expect(markup).toContain("focus-visible:ring-ring");
  });

  it("defaults to type=text and forwards an explicit type", () => {
    const textMarkup = renderToStaticMarkup(
      createElement(Input, { "aria-label": "Name" }),
    );
    const searchMarkup = renderToStaticMarkup(
      createElement(Input, { type: "search", "aria-label": "Search" }),
    );

    expect(textMarkup).toContain('type="text"');
    expect(searchMarkup).toContain('type="search"');
  });
});

describe("Textarea", () => {
  it("shares the input chrome and focus ring", () => {
    const markup = renderToStaticMarkup(
      createElement(Textarea, {
        "aria-label": "Prompt",
        rows: 4,
      }),
    );

    expect(markup).toContain("<textarea");
    expect(markup).toContain("border-control-border");
    expect(markup).toContain("bg-secondary");
    expect(markup).toContain("focus-visible:ring-ring");
    expect(markup).toContain("outline-none");
    expect(markup).not.toContain("ring-primary");
  });
});
