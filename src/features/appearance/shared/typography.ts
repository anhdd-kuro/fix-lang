/**
 * @file typography.ts
 * @description Shared appearance typography ids, defaults, and CSS values.
 */

export const FONT_SIZE_IDS = Object.freeze(["sm", "md", "lg"] as const);
export type FontSizeId = (typeof FONT_SIZE_IDS)[number];

export const FONT_FAMILY_IDS = Object.freeze(["system", "mono", "serif"] as const);
export type FontFamilyId = (typeof FONT_FAMILY_IDS)[number];

export type AppearanceTypography = {
  fontSize: FontSizeId;
  fontFamily: FontFamilyId;
};

export const DEFAULT_FONT_SIZE: FontSizeId = "md";
export const DEFAULT_FONT_FAMILY: FontFamilyId = "system";

export const DEFAULT_APPEARANCE_TYPOGRAPHY: AppearanceTypography = Object.freeze({
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
});

export const FONT_SIZE_PX: Readonly<Record<FontSizeId, number>> = Object.freeze({
  sm: 13,
  md: 14,
  lg: 16,
});

export const FONT_FAMILY_STACKS: Readonly<Record<FontFamilyId, string>> =
  Object.freeze({
    system:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono:
      'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    serif:
      'ui-serif, "New York", "Iowan Old Style", "Times New Roman", serif',
  });

export const isFontSizeId = (value: unknown): value is FontSizeId =>
  typeof value === "string" &&
  (FONT_SIZE_IDS as readonly string[]).includes(value);

export const isFontFamilyId = (value: unknown): value is FontFamilyId =>
  typeof value === "string" &&
  (FONT_FAMILY_IDS as readonly string[]).includes(value);

export const normalizeFontSizeId = (value: unknown): FontSizeId =>
  isFontSizeId(value) ? value : DEFAULT_FONT_SIZE;

export const normalizeFontFamilyId = (value: unknown): FontFamilyId =>
  isFontFamilyId(value) ? value : DEFAULT_FONT_FAMILY;

export const normalizeAppearanceTypography = (
  raw: unknown,
): AppearanceTypography => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_APPEARANCE_TYPOGRAPHY;
  }

  const record = raw as Record<string, unknown>;
  return {
    fontSize: normalizeFontSizeId(record.fontSize),
    fontFamily: normalizeFontFamilyId(record.fontFamily),
  };
};
