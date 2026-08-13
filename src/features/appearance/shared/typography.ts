/**
 * @file typography.ts
 * @description Shared appearance typography ids, defaults, and CSS values.
 */

export const FONT_SIZE_IDS = Object.freeze(["sm", "md", "lg", "custom"] as const);
export type FontSizeId = (typeof FONT_SIZE_IDS)[number];

export const FONT_FAMILY_IDS = Object.freeze([
  "system",
  "mono",
  "serif",
  "custom",
] as const);
export type FontFamilyId = (typeof FONT_FAMILY_IDS)[number];

export type AppearanceTypography = {
  fontSize: FontSizeId;
  fontFamily: FontFamilyId;
  customFontSize: string;
  customFontFamily: string;
};

export const DEFAULT_FONT_SIZE: FontSizeId = "md";
export const DEFAULT_FONT_FAMILY: FontFamilyId = "system";

export const DEFAULT_CUSTOM_FONT_SIZE = "14px";
export const DEFAULT_CUSTOM_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const DEFAULT_APPEARANCE_TYPOGRAPHY: AppearanceTypography = Object.freeze({
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  customFontSize: DEFAULT_CUSTOM_FONT_SIZE,
  customFontFamily: DEFAULT_CUSTOM_FONT_FAMILY,
});

export const FONT_SIZE_PX: Readonly<Record<Exclude<FontSizeId, "custom">, number>> =
  Object.freeze({
    sm: 13,
    md: 14,
    lg: 16,
  });

export const FONT_FAMILY_STACKS: Readonly<
  Record<Exclude<FontFamilyId, "custom">, string>
> = Object.freeze({
  system: DEFAULT_CUSTOM_FONT_FAMILY,
  mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  serif: 'ui-serif, "New York", "Iowan Old Style", "Times New Roman", serif',
});

const CUSTOM_FONT_SIZE_PATTERN = /^\d+(\.\d+)?(px|rem|em|%)$/;
const CUSTOM_FONT_FAMILY_MAX_LENGTH = 500;

export const isFontSizeId = (value: unknown): value is FontSizeId =>
  typeof value === "string" &&
  (FONT_SIZE_IDS as readonly string[]).includes(value);

export const isFontFamilyId = (value: unknown): value is FontFamilyId =>
  typeof value === "string" &&
  (FONT_FAMILY_IDS as readonly string[]).includes(value);

export const isValidCustomFontSize = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return CUSTOM_FONT_SIZE_PATTERN.test(trimmed);
};

export const isValidCustomFontFamily = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= CUSTOM_FONT_FAMILY_MAX_LENGTH;
};

export const normalizeCustomFontSize = (value: unknown): string =>
  isValidCustomFontSize(value) ? value.trim() : DEFAULT_CUSTOM_FONT_SIZE;

export const normalizeCustomFontFamily = (value: unknown): string =>
  isValidCustomFontFamily(value) ? value.trim() : DEFAULT_CUSTOM_FONT_FAMILY;

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
    customFontSize: normalizeCustomFontSize(record.customFontSize),
    customFontFamily: normalizeCustomFontFamily(record.customFontFamily),
  };
};

export const resolveFontSizeCss = (typography: AppearanceTypography): string =>
  typography.fontSize === "custom"
    ? typography.customFontSize
    : `${FONT_SIZE_PX[typography.fontSize]}px`;

export const resolveFontFamilyCss = (typography: AppearanceTypography): string =>
  typography.fontFamily === "custom"
    ? typography.customFontFamily
    : FONT_FAMILY_STACKS[typography.fontFamily];
