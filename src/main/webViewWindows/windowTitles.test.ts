/**
 * @file windowTitles.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  buildAskInputWindowTitle,
  buildAskResultWindowTitle,
  buildCorrectionResultWindowTitle,
  buildErrorPopupCloseLabel,
  buildErrorPopupTitle,
  buildPromptGenWindowTitle,
} from "./windowTitles";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/features/i18n/store/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

describe("window titles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds English titles", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildPromptGenWindowTitle()).toBe(
      tEn("notifications.window.promptGen.title"),
    );
    expect(buildCorrectionResultWindowTitle()).toBe(
      tEn("notifications.window.correctionResult.title"),
    );
    expect(buildErrorPopupTitle()).toBe(tEn("notifications.errorPopup.title"));
    expect(buildErrorPopupCloseLabel()).toBe(tEn("common.close"));
    expect(buildAskInputWindowTitle()).toBe(
      tEn("notifications.window.askInput.title"),
    );
    expect(buildAskResultWindowTitle()).toBe(
      tEn("notifications.window.askResult.title"),
    );
  });

  it("builds Japanese titles and keeps the product name untranslated", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const promptGen = buildPromptGenWindowTitle();
    const correctionResult = buildCorrectionResultWindowTitle();
    const errorPopup = buildErrorPopupTitle();
    const errorClose = buildErrorPopupCloseLabel();
    const askInput = buildAskInputWindowTitle();
    const askResult = buildAskResultWindowTitle();

    expect(promptGen).toBe(tJa("notifications.window.promptGen.title"));
    expect(correctionResult).toBe(tJa("notifications.window.correctionResult.title"));
    expect(errorPopup).toBe(tJa("notifications.errorPopup.title"));
    expect(errorClose).toBe(tJa("common.close"));
    expect(askInput).toBe(tJa("notifications.window.askInput.title"));
    expect(askResult).toBe(tJa("notifications.window.askResult.title"));

    // Prove the locale actually changed the wording.
    expect(promptGen).not.toBe(tEn("notifications.window.promptGen.title"));
    expect(correctionResult).not.toBe(
      tEn("notifications.window.correctionResult.title"),
    );
    expect(errorPopup).not.toBe(tEn("notifications.errorPopup.title"));
    expect(errorClose).not.toBe(tEn("common.close"));
    expect(askInput).not.toBe(tEn("notifications.window.askInput.title"));
    expect(askResult).not.toBe(tEn("notifications.window.askResult.title"));
  });
});
