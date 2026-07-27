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

const baselinePath = path.join(
  import.meta.dirname,
  "fixtures/shared-button-plan-baseline.json",
);

type PlanBaseline = {
  themeCount: number;
  uniqueThemeIdCount: number;
  entries: {
    id: string;
    sourcePath: string;
    primary: string;
    destructive: string;
  }[];
};

const hueDistance = (left: string, right: string): number => {
  const leftHue = colord(left).toHsl().h ?? 0;
  const rightHue = colord(right).toHsl().h ?? 0;
  return Math.min(
    Math.abs(leftHue - rightHue),
    360 - Math.abs(leftHue - rightHue),
  );
};

const rgbDistance = (left: string, right: string): number => {
  const leftRgb = colord(left).toRgb();
  const rightRgb = colord(right).toRgb();
  return Math.hypot(
    leftRgb.r - rightRgb.r,
    leftRgb.g - rightRgb.g,
    leftRgb.b - rightRgb.b,
  );
};

extend([a11yPlugin]);

const jsonDir = path.join(import.meta.dirname, "json");
const themeDirs = [
  jsonDir,
  path.join(jsonDir, "terminal"),
  path.join(jsonDir, "brands"),
] as const;
const themeFiles = themeDirs.flatMap((directory) =>
  readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      displayName: path.relative(jsonDir, path.join(directory, file)),
      filePath: path.join(directory, file),
    })),
);

const loadTheme = (filePath: string): TmTheme => {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw) as TmTheme;
};

describe("adjustSemanticTokenContrast via tmThemeToSemanticTokens", () => {
  it("uses only the tracked plan-start baseline fixture", () => {
    const testSource = readFileSync(import.meta.filename, "utf8");
    const ignoredScratchPrefix = ["..", "..", ".scratch"].join("/");

    expect(testSource).not.toContain(ignoredScratchPrefix);
  });

  it("keeps the plan-start primary and destructive normal values for exactly 149 themes", () => {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as PlanBaseline;
    const ids = baseline.entries.map((entry) => entry.id);
    const sourcePaths = themeFiles.map((theme) =>
      path.relative(process.cwd(), theme.filePath),
    );

    expect(themeFiles).toHaveLength(149);
    expect(baseline.themeCount).toBe(149);
    expect(baseline.uniqueThemeIdCount).toBe(149);
    expect(baseline.entries).toHaveLength(149);
    expect(new Set(ids).size).toBe(149);
    expect(
      new Set(baseline.entries.map((entry) => entry.sourcePath)).size,
    ).toBe(149);
    expect(
      baseline.entries.map((entry) => entry.sourcePath).sort(),
    ).toEqual(sourcePaths.sort());

    for (const entry of baseline.entries) {
      const tokens = tmThemeToSemanticTokens(loadTheme(entry.sourcePath));
      expect(tokens["--primary"]).toBe(entry.primary);
      expect(tokens["--destructive"]).toBe(entry.destructive);
    }
  });

  it("keeps all 1,341 filled-button pairs opaque, distinct, hue-preserving, and readable", () => {
    const contrastPairs = [
      ["--primary-foreground", "--primary", "--primary-hover", "--primary-active"],
      ["--secondary-foreground", "--secondary", "--secondary-hover", "--secondary-active"],
      ["--destructive-foreground", "--destructive", "--destructive-hover", "--destructive-active"],
    ] as const;

    let totalPairs = 0;
    const ratios: number[] = [];

    for (const { filePath } of themeFiles) {
      const tokens = tmThemeToSemanticTokens(loadTheme(filePath));
      for (const [foregroundKey, normalKey, hoverKey, activeKey] of contrastPairs) {
        const foreground = colord(tokens[foregroundKey]);
        const normal = tokens[normalKey];
        const hover = tokens[hoverKey];
        const active = tokens[activeKey];

        expect(colord(normal).alpha()).toBe(1);
        expect(colord(hover).alpha()).toBe(1);
        expect(colord(active).alpha()).toBe(1);
        expect(hover).not.toBe(normal);
        expect(active).not.toBe(normal);
        expect(active).not.toBe(hover);
        expect(rgbDistance(normal, hover)).toBeGreaterThanOrEqual(12);
        expect(rgbDistance(hover, active)).toBeGreaterThanOrEqual(12);
        const normalHsl = colord(normal).toHsl();
        if (normalHsl.s >= 10) {
          expect(hueDistance(normal, hover)).toBeLessThanOrEqual(8);
          expect(hueDistance(normal, active)).toBeLessThanOrEqual(8);
        } else {
          expect(colord(hover).toHsl().s).toBeLessThanOrEqual(10);
          expect(colord(active).toHsl().s).toBeLessThanOrEqual(10);
        }

        for (const surface of [normal, hover, active]) {
          ratios.push(foreground.contrast(colord(surface)));
          totalPairs += 1;
        }
      }
    }

    expect(totalPairs).toBe(1341);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themeFiles)(
    "theme $displayName has readable text, controls, and boundaries",
    ({ filePath }) => {
      const tokens = tmThemeToSemanticTokens(loadTheme(filePath));
      const card = colord(tokens["--card"]);
      const background = colord(tokens["--background"]);
      const border = colord(tokens["--border"]);
      const controlBorder = colord(tokens["--control-border"]);
      const cardControlBorder = colord(tokens["--card-control-border"]);
      const borderedSurfaces = [
        background,
        card,
        colord(tokens["--input"]),
        colord(tokens["--secondary"]),
        colord(tokens["--muted"]),
        colord(tokens["--popover"]),
        colord(tokens["--accent"]),
      ];
      const primaryForeground = colord(tokens["--primary-foreground"]);

      expect(
        colord(tokens["--foreground"]).contrast(background),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colord(tokens["--muted-foreground"]).contrast(card),
      ).toBeGreaterThanOrEqual(3.5);
      expect(
        colord(tokens["--card-foreground"]).contrast(card),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        primaryForeground.contrast(colord(tokens["--primary"])),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        primaryForeground.contrast(colord(tokens["--primary-hover"])),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        primaryForeground.contrast(colord(tokens["--primary-active"])),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        colord(tokens["--ring"]).contrast(background),
      ).toBeGreaterThanOrEqual(3);
      const borderContrastFloor = background.isDark() ? 2.05 : 3;
      expect(border.contrast(background)).toBeGreaterThanOrEqual(
        borderContrastFloor,
      );
      expect(
        controlBorder.contrast(colord(tokens["--input"])),
      ).toBeGreaterThanOrEqual(3);
      expect(
        controlBorder.contrast(colord(tokens["--secondary"])),
      ).toBeGreaterThanOrEqual(3);
      expect(cardControlBorder.contrast(card)).toBeGreaterThanOrEqual(3);
      for (const surface of borderedSurfaces) {
        expect(
          Math.max(
            border.contrast(surface),
            surface.contrast(background),
          ),
        ).toBeGreaterThanOrEqual(borderContrastFloor);
      }
      expect(tokens["--overlay-backdrop"]).toMatch(/^rgba?\(/);
      expect(
        Math.abs(card.brightness() - background.brightness()),
      ).toBeGreaterThan(0.075);
    },
  );

  it("andromeeda labels are readable on stat cards", () => {
    const tokens = tmThemeToSemanticTokens(
      loadTheme(path.join(jsonDir, "andromeeda.json")),
    );
    const card = colord(tokens["--card"]);
    expect(
      colord(tokens["--muted-foreground"]).contrast(card),
    ).toBeGreaterThanOrEqual(4);
  });
});
