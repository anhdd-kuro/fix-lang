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

/** Title for the Ask AI input popup window. */
export const buildAskInputWindowTitle = (): string =>
  mainT("notifications.window.askInput.title");

/** Title for the Ask AI result popup window. */
export const buildAskResultWindowTitle = (): string =>
  mainT("notifications.window.askResult.title");

/**
 * Heading text rendered inside the error popup overlay (`overlay.html`'s
 * `.error-title`), injected via `executeJavaScript` the same way the theme is
 * synced to that window. "FixLang" is the product name and stays untranslated
 * in both catalogs.
 */
export const buildErrorPopupTitle = (): string =>
  mainT("notifications.errorPopup.title");

/**
 * Accessible label for the error popup's close button. Reuses the shared
 * `common.close` string so EN/JA stay in sync with other dismiss controls.
 */
export const buildErrorPopupCloseLabel = (): string => mainT("common.close");
