/**
 * Theme preset metadata for the renderer UI.
 */
import type { ThemeId } from "~/stores/themeIds";

export type { ThemeId } from "~/stores/themeIds";
export { THEME_PRESETS, type ThemePreset } from "./manifest.generated";

/**
 * Applies a theme to the document root.
 */
export const applyThemeToDocument = (themeId: ThemeId): void => {
  document.documentElement.dataset.theme = themeId;
};
