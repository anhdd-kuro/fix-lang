/**
 * @file typography.test.ts
 * @description Unit tests for appearance typography normalization.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_TYPOGRAPHY,
  DEFAULT_CUSTOM_FONT_SIZE,
  FONT_FAMILY_IDS,
  FONT_SIZE_IDS,
  isFontFamilyId,
  isFontSizeId,
  isValidCustomFontFamily,
  isValidCustomFontSize,
  normalizeAppearanceTypography,
  resolveFontFamilyCss,
  resolveFontSizeCss,
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

describe("custom typography validation", () => {
  it("accepts css font-size units", () => {
    expect(isValidCustomFontSize("14px")).toBe(true);
    expect(isValidCustomFontSize("1.25rem")).toBe(true);
    expect(isValidCustomFontSize("100%")).toBe(true);
  });

  it("rejects invalid custom font sizes", () => {
    expect(isValidCustomFontSize("large")).toBe(false);
    expect(isValidCustomFontSize("")).toBe(false);
  });

  it("accepts non-empty custom font-family strings", () => {
    expect(isValidCustomFontFamily('Georgia, "Times New Roman", serif')).toBe(
      true,
    );
  });

  it("rejects empty custom font-family strings", () => {
    expect(isValidCustomFontFamily("   ")).toBe(false);
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
      customFontSize: DEFAULT_CUSTOM_FONT_SIZE,
      customFontFamily: DEFAULT_APPEARANCE_TYPOGRAPHY.customFontFamily,
    });
  });

  it("preserves custom values", () => {
    expect(
      normalizeAppearanceTypography({
        fontSize: "custom",
        fontFamily: "custom",
        customFontSize: "15px",
        customFontFamily: "Courier New, monospace",
      }),
    ).toEqual({
      fontSize: "custom",
      fontFamily: "custom",
      customFontSize: "15px",
      customFontFamily: "Courier New, monospace",
    });
  });
});

describe("resolveFontSizeCss", () => {
  it("uses preset px values", () => {
    expect(resolveFontSizeCss(DEFAULT_APPEARANCE_TYPOGRAPHY)).toBe("14px");
  });

  it("uses the stored custom value", () => {
    expect(
      resolveFontSizeCss({
        ...DEFAULT_APPEARANCE_TYPOGRAPHY,
        fontSize: "custom",
        customFontSize: "1rem",
      }),
    ).toBe("1rem");
  });
});

describe("resolveFontFamilyCss", () => {
  it("uses preset stacks", () => {
    expect(
      resolveFontFamilyCss({
        ...DEFAULT_APPEARANCE_TYPOGRAPHY,
        fontFamily: "mono",
      }),
    ).toContain("monospace");
  });

  it("uses the stored custom value", () => {
    expect(
      resolveFontFamilyCss({
        ...DEFAULT_APPEARANCE_TYPOGRAPHY,
        fontFamily: "custom",
        customFontFamily: "Courier New, monospace",
      }),
    ).toBe("Courier New, monospace");
  });
});
