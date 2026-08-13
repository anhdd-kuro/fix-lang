/**
 * @file typographyTextScale.test.ts
 * @description Ensures typography tokens scale text without shifting the rem baseline.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTypographyToDocument } from "./applyTypographyToDocument";

const mainCss = readFileSync(join(__dirname, "../main.css"), "utf8");

describe("typography text scale", () => {
  let style: HTMLStyleElement;

  beforeEach(() => {
    style = document.createElement("style");
    style.textContent = `
      :root {
        font-size: 16px;
      }
      body,
      #root {
        font-size: var(--font-size-base, 14px);
      }
    `;
    document.head.appendChild(style);
  });

  afterEach(() => {
    style.remove();
    document.documentElement.removeAttribute("data-font-size");
    document.documentElement.removeAttribute("data-font-family");
    document.documentElement.style.removeProperty("--font-size-base");
    document.documentElement.style.removeProperty("--font-family-ui");
  });

  it("keeps font-size off html in main.css and on body only", () => {
    expect(mainCss).toMatch(
      /body,\s*\n\s*#root \{\s*\n\s*font-size: var\(--font-size-base, 14px\);/,
    );
    expect(mainCss).not.toMatch(
      /html,\s*\n\s*body,\s*\n\s*#root \{[^}]*font-size/s,
    );
    expect(mainCss).toContain(
      "--text-xxs: calc(0.6875rem * var(--font-size-text-scale, 1));",
    );
    expect(mainCss).toContain(
      "--text-2xs: calc(0.625rem * var(--font-size-text-scale, 1));",
    );
    expect(mainCss).toContain("--font-size-text-scale: calc(12 / 14);");
    expect(mainCss).toContain("--font-size-text-scale: calc(13 / 14);");
  });

  it("keeps the html rem baseline while typography sets the body base variable", () => {
    applyTypographyToDocument({ fontSize: "md", fontFamily: "system" });

    expect(getComputedStyle(document.documentElement).fontSize).toBe("16px");
    expect(
      document.documentElement.style.getPropertyValue("--font-size-base"),
    ).toBe("13px");
    expect(style.textContent).toContain(
      "font-size: var(--font-size-base, 14px);",
    );
  });
});
