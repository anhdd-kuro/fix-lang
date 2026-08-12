/**
 * @file applyTypographyToDocument.ts
 * @description Applies persisted typography preferences to the document root.
 */
import {
  FONT_FAMILY_STACKS,
  FONT_SIZE_PX,
  type AppearanceTypography,
} from "~/features/appearance/shared/typography";

export const applyTypographyToDocument = (
  typography: AppearanceTypography,
): void => {
  const root = document.documentElement;
  root.style.setProperty(
    "--font-size-base",
    `${FONT_SIZE_PX[typography.fontSize]}px`,
  );
  root.style.setProperty(
    "--font-family-ui",
    FONT_FAMILY_STACKS[typography.fontFamily],
  );
  root.dataset.fontSize = typography.fontSize;
  root.dataset.fontFamily = typography.fontFamily;
};
