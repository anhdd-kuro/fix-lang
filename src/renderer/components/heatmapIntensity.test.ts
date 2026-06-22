/**
 * @file heatmapIntensity.test.ts
 */
import { describe, expect, it } from "vitest";
import { heatmapLevelClass, heatmapRatioClass } from "./heatmapIntensity";

describe("heatmapIntensity", () => {
  it("uses primary shades for non-zero levels", () => {
    expect(heatmapLevelClass(0)).toContain("bg-secondary");
    expect(heatmapLevelClass(1)).toContain("bg-primary/20");
    expect(heatmapLevelClass(4)).toContain("bg-primary");
  });

  it("maps ratio buckets to primary shades", () => {
    expect(heatmapRatioClass(0, 10)).toContain("bg-secondary");
    expect(heatmapRatioClass(2, 10)).toContain("bg-primary/20");
    expect(heatmapRatioClass(8, 10)).toContain("bg-primary");
  });
});
