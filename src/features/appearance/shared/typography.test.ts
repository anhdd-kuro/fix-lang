/**
 * @file typography.test.ts
 * @description Unit tests for appearance typography normalization.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_TYPOGRAPHY,
  FONT_FAMILY_IDS,
  FONT_SIZE_IDS,
  isFontFamilyId,
  isFontSizeId,
  normalizeAppearanceTypography,
} from "./typography";

describe("isFontSizeId", () => {
  it("accepts bundled font size ids", () => {
    for (const id of FONT_SIZE_IDS) {
      expect(isFontSizeId(id)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isFontSizeId("xl")).toBe(false);
    expect(isFontSizeId(null)).toBe(false);
  });
});

describe("isFontFamilyId", () => {
  it("accepts bundled font family ids", () => {
    for (const id of FONT_FAMILY_IDS) {
      expect(isFontFamilyId(id)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isFontFamilyId("sans")).toBe(false);
    expect(isFontFamilyId(undefined)).toBe(false);
  });
});

describe("normalizeAppearanceTypography", () => {
  it("returns defaults for invalid input", () => {
    expect(normalizeAppearanceTypography(null)).toEqual(
      DEFAULT_APPEARANCE_TYPOGRAPHY,
    );
  });

  it("normalizes partial records", () => {
    expect(
      normalizeAppearanceTypography({ fontSize: "lg", fontFamily: "invalid" }),
    ).toEqual({
      fontSize: "lg",
      fontFamily: DEFAULT_APPEARANCE_TYPOGRAPHY.fontFamily,
    });
  });
});
