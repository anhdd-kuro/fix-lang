/**
 * @file adjustSemanticTokenContrast.test.ts
 * @description Ensures generated theme tokens meet minimum UI contrast targets.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import { describe, expect, it } from "vitest";
import { tmThemeToSemanticTokens } from "./tmThemeToSemanticTokens";
import type { TmTheme } from "./tmThemeTypes";

extend([a11yPlugin]);

const jsonDir = path.join(import.meta.dirname, "json");
const themeFiles = readdirSync(jsonDir).filter((file) => file.endsWith(".json"));

const loadTheme = (fileName: string): TmTheme => {
  const raw = readFileSync(path.join(jsonDir, fileName), "utf8");
  return JSON.parse(raw) as TmTheme;
};

describe("adjustSemanticTokenContrast via tmThemeToSemanticTokens", () => {
  it.each(themeFiles)("theme %s has readable label and body contrast", (fileName) => {
    const tokens = tmThemeToSemanticTokens(loadTheme(fileName));
    const card = colord(tokens["--card"]);
    const background = colord(tokens["--background"]);

    expect(colord(tokens["--foreground"]).contrast(background)).toBeGreaterThanOrEqual(4.5);
    expect(colord(tokens["--muted-foreground"]).contrast(card)).toBeGreaterThanOrEqual(3.5);
    expect(colord(tokens["--card-foreground"]).contrast(card)).toBeGreaterThanOrEqual(4.5);
    expect(tokens["--overlay-backdrop"]).toMatch(/^rgba?\(/);
    expect(Math.abs(card.brightness() - background.brightness())).toBeGreaterThan(
      0.075,
    );
  });

  it("andromeeda labels are readable on stat cards", () => {
    const tokens = tmThemeToSemanticTokens(loadTheme("andromeeda.json"));
    const card = colord(tokens["--card"]);
    expect(colord(tokens["--muted-foreground"]).contrast(card)).toBeGreaterThanOrEqual(4);
  });
});
