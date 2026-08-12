/**
 * @file syncStandaloneTypography.ts
 * @description Pushes typography CSS variables into standalone HTML windows.
 */
import {
  FONT_FAMILY_STACKS,
  FONT_SIZE_PX,
  type AppearanceTypography,
} from "~/features/appearance/shared/typography";

export const buildStandaloneTypographyScript = (
  typography: AppearanceTypography,
): string =>
  `(() => {
    const root = document.documentElement;
    root.style.setProperty("--font-size-base", ${JSON.stringify(`${FONT_SIZE_PX[typography.fontSize]}px`)});
    root.style.setProperty("--font-family-ui", ${JSON.stringify(FONT_FAMILY_STACKS[typography.fontFamily])});
    root.dataset.fontSize = ${JSON.stringify(typography.fontSize)};
    root.dataset.fontFamily = ${JSON.stringify(typography.fontFamily)};
  })()`;

export const applyStandaloneTypography = (
  webContents: Electron.WebContents,
  typography: AppearanceTypography,
): void => {
  if (webContents.isDestroyed?.() === true) {
    return;
  }

  void webContents.executeJavaScript(
    buildStandaloneTypographyScript(typography),
  );
};
