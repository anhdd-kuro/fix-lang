/**
 * @file compositeColor.test.ts
 * @description Covers the contrast floor/ceiling pair used to derive borders.
 */
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";
import { describe, expect, it } from "vitest";
import { capContrastAgainst, ensureContrastAgainst } from "./compositeColor";

extend([a11yPlugin]);

describe("capContrastAgainst", () => {
  it("leaves a border untouched when it already sits under the ceiling", () => {
    expect(capContrastAgainst("#454544", ["#2e2e2c"], 2.2, 1.55)).toBe(
      "#454544",
    );
  });

  it("pulls a page border back toward a near-black card in a light theme", () => {
    const capped = capContrastAgainst("#d1d1d2", ["#000000"], 2.2, 1.55);

    expect(colord("#d1d1d2").contrast("#000000")).toBeGreaterThan(10);
    expect(colord(capped).contrast("#000000")).toBeLessThanOrEqual(2.2);
    expect(colord(capped).contrast("#000000")).toBeGreaterThanOrEqual(1.55);
  });

  it("pulls a page border back toward a near-white card in a dark theme", () => {
    const capped = capContrastAgainst("#3a3a3a", ["#f5f5f5"], 2.2, 1.55);

    expect(colord(capped).contrast("#f5f5f5")).toBeLessThanOrEqual(2.2);
    expect(colord(capped).contrast("#f5f5f5")).toBeGreaterThanOrEqual(1.55);
  });

  it("keeps the floor when no mix can satisfy both surfaces", () => {
    const surfaces = ["#000000", "#ffffff"];
    const start = ensureContrastAgainst(
      "#767676",
      surfaces,
      "#767676",
      1.55,
    );

    expect(capContrastAgainst(start, surfaces, 2.2, 1.55)).toBe(start);
  });
});
