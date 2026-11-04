/**
 * @file typography.ts
 * @description Shared appearance typography ids, defaults, and CSS values.
 */
import { z } from "zod";
import { schemaGuard, schemaParser } from "~/features/core/shared/schemaGuard";

export const FONT_SIZE_IDS = Object.freeze([
  "sm",
  "md",
  "lg",
  "custom",
] as const);
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

export const DEFAULT_APPEARANCE_TYPOGRAPHY: AppearanceTypography =
  Object.freeze({
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: DEFAULT_FONT_FAMILY,
    customFontSize: DEFAULT_CUSTOM_FONT_SIZE,
    customFontFamily: DEFAULT_CUSTOM_FONT_FAMILY,
  });

export const FONT_SIZE_PX: Readonly<
  Record<Exclude<FontSizeId, "custom">, number>
> = Object.freeze({
  sm: 12,
  md: 13,
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

export const FontSizeIdSchema = z.enum(FONT_SIZE_IDS);

export const FontFamilyIdSchema = z.enum(FONT_FAMILY_IDS);

/** Validated on its trimmed form; the guard still hands back the original. */
export const CustomFontSizeSchema = z
  .string()
  .refine((value) => CUSTOM_FONT_SIZE_PATTERN.test(value.trim()));

export const CustomFontFamilySchema = z.string().refine((value) => {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= CUSTOM_FONT_FAMILY_MAX_LENGTH;
});

const trimmed = (value: string): string => value.trim();

const NormalizedFontSizeIdSchema = FontSizeIdSchema.catch(DEFAULT_FONT_SIZE);

const NormalizedFontFamilyIdSchema =
  FontFamilyIdSchema.catch(DEFAULT_FONT_FAMILY);

const NormalizedCustomFontSizeSchema = CustomFontSizeSchema.transform(
  trimmed,
).catch(DEFAULT_CUSTOM_FONT_SIZE);

const NormalizedCustomFontFamilySchema = CustomFontFamilySchema.transform(
  trimmed,
).catch(DEFAULT_CUSTOM_FONT_FAMILY);

export const isFontSizeId = schemaGuard(FontSizeIdSchema);

export const isFontFamilyId = schemaGuard(FontFamilyIdSchema);

export const isValidCustomFontSize = schemaGuard(CustomFontSizeSchema);

export const isValidCustomFontFamily = schemaGuard(CustomFontFamilySchema);

export const normalizeCustomFontSize = schemaParser(
  NormalizedCustomFontSizeSchema,
);

export const normalizeCustomFontFamily = schemaParser(
  NormalizedCustomFontFamilySchema,
);

export const normalizeFontSizeId = schemaParser(NormalizedFontSizeIdSchema);

export const normalizeFontFamilyId = schemaParser(NormalizedFontFamilyIdSchema);

/**
 * A falsy, non-object, function or array value yields the shared frozen
 * default itself; any other object is read field by field, each bad field
 * falling back on its own.
 */
export const normalizeAppearanceTypography = schemaParser<AppearanceTypography>(
  z
    .object({
      fontSize: NormalizedFontSizeIdSchema,
      fontFamily: NormalizedFontFamilyIdSchema,
      customFontSize: NormalizedCustomFontSizeSchema,
      customFontFamily: NormalizedCustomFontFamilySchema,
    })
    .catch(DEFAULT_APPEARANCE_TYPOGRAPHY),
);

export const resolveFontSizeCss = (typography: AppearanceTypography): string =>
  typography.fontSize === "custom"
    ? typography.customFontSize
    : `${FONT_SIZE_PX[typography.fontSize]}px`;

export const resolveFontFamilyCss = (
  typography: AppearanceTypography,
): string =>
  typography.fontFamily === "custom"
    ? typography.customFontFamily
    : FONT_FAMILY_STACKS[typography.fontFamily];
