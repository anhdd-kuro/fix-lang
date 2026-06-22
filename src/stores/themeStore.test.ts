/**
 * @file themeStore.test.ts
 * @description Unit tests for theme ID validation (pure seam).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, isThemeId, THEME_IDS } from "./themeIds";

describe("isThemeId", () => {
  it("accepts all bundled preset ids", () => {
    for (const id of THEME_IDS) {
      expect(isThemeId(id)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isThemeId("light")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });
});

describe("DEFAULT_THEME_ID", () => {
  it("is a valid theme id", () => {
    expect(isThemeId(DEFAULT_THEME_ID)).toBe(true);
    expect(DEFAULT_THEME_ID).toBe("brand-codex-dark");
  });
});
