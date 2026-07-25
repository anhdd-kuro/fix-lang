/**
 * @file windowTitles.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import {
  buildCorrectionResultWindowTitle,
  buildErrorPopupTitle,
  buildPromptGenWindowTitle,
} from "./windowTitles";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
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
  });

  it("builds Japanese titles and keeps the product name untranslated", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const promptGen = buildPromptGenWindowTitle();
    const correctionResult = buildCorrectionResultWindowTitle();
    const errorPopup = buildErrorPopupTitle();

    expect(promptGen).toBe(tJa("notifications.window.promptGen.title"));
    expect(correctionResult).toBe(tJa("notifications.window.correctionResult.title"));
    expect(errorPopup).toBe(tJa("notifications.errorPopup.title"));

    // Prove the locale actually changed the wording.
    expect(promptGen).not.toBe(tEn("notifications.window.promptGen.title"));
    expect(correctionResult).not.toBe(
      tEn("notifications.window.correctionResult.title"),
    );
    expect(errorPopup).not.toBe(tEn("notifications.errorPopup.title"));
  });
});
