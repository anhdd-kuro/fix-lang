/**
 * @file applyTypographyToDocument.ts
 * @description Applies persisted typography preferences to the document root.
 */
import {
  resolveFontFamilyCss,
  resolveFontSizeCss,
  type AppearanceTypography,
} from "~/features/appearance/shared/typography";

export const applyTypographyToDocument = (
  typography: AppearanceTypography,
): void => {
  const root = document.documentElement;
  root.style.setProperty("--font-size-base", resolveFontSizeCss(typography));
  root.style.setProperty("--font-family-ui", resolveFontFamilyCss(typography));
  root.dataset.fontSize = typography.fontSize;
  root.dataset.fontFamily = typography.fontFamily;
};
