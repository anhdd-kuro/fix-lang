/**
 * @file windowTitles.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("window titles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds English titles", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildPromptGenWindowTitle()).toBe("Generated Prompts");
    expect(buildCorrectionResultWindowTitle()).toBe("FixLang result");
    expect(buildErrorPopupTitle()).toBe("FixLang Error");
  });

  it("builds Japanese titles and keeps the product name untranslated", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(buildPromptGenWindowTitle()).toBe("生成されたプロンプト");
    expect(buildCorrectionResultWindowTitle()).toBe("FixLangの結果");
    expect(buildErrorPopupTitle()).toBe("FixLang エラー");
  });
});
