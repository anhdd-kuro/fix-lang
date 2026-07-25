/**
 * @file windowTitles.ts
 * @description Pure builders for standalone-window title strings, split out
 * so they're testable without constructing a `BrowserWindow`.
 */
import { mainT } from "~/main/i18n";

/** Title for the PromptGen popup window. */
export const buildPromptGenWindowTitle = (): string =>
  mainT("notifications.window.promptGen.title");

/** Title for the correction result popup window. */
export const buildCorrectionResultWindowTitle = (): string =>
  mainT("notifications.window.correctionResult.title");

/**
 * Heading text rendered inside the error popup overlay (`overlay.html`'s
 * `.error-title`), injected via `executeJavaScript` the same way the theme is
 * synced to that window. "FixLang" is the product name and stays untranslated
 * in both catalogs.
 */
export const buildErrorPopupTitle = (): string =>
  mainT("notifications.errorPopup.title");
