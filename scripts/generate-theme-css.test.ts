/**
 * @file generate-theme-css.test.ts
 * @description Ensures generated theme CSS selectors do not leak default tokens globally.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const generatedDir = path.join(
  import.meta.dirname,
  "../src/renderer/themes/generated",
);

describe("generated theme CSS selectors", () => {
  it("does not emit :root blocks that override non-default themes", () => {
    const defaultCss = readFileSync(
      path.join(generatedDir, "preset-brand-codex-dark.css"),
      "utf8",
    );

    expect(defaultCss).not.toMatch(/:root/);
    expect(defaultCss).toContain("html:not([data-theme])");
    expect(defaultCss).toContain('html[data-theme="brand-codex-dark"]');
  });

  it("scopes non-default themes to html[data-theme]", () => {
    const ayuDarkCss = readFileSync(
      path.join(generatedDir, "preset-ayu-dark.css"),
      "utf8",
    );
    const lightPlusCss = readFileSync(
      path.join(generatedDir, "preset-light-plus.css"),
      "utf8",
    );

    expect(ayuDarkCss).toContain('html[data-theme="ayu-dark"]');
    expect(lightPlusCss).toContain('html[data-theme="light-plus"]');
  });
});
