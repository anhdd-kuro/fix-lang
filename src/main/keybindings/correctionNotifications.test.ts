/**
 * @file correctionNotifications.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCorrectionGoodJobNotification,
  buildCorrectionResultTitle,
} from "./correctionNotifications";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

describe("buildCorrectionGoodJobNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildCorrectionGoodJobNotification()).toEqual({
      title: "Good job!",
      body: "Your text is already correct. No changes have been made.",
    });
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(buildCorrectionGoodJobNotification()).toEqual({
      title: "お見事です！",
      body: "文章はすでに正しいため、変更はありません。",
    });
  });
});

describe("buildCorrectionResultTitle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("interpolates the preset name in English", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildCorrectionResultTitle("Correction")).toBe("Correction result");
  });

  it("interpolates the preset name in Japanese", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(buildCorrectionResultTitle("Correction")).toBe("Correctionの結果");
  });

  it("passes an untrusted/non-ASCII preset name through untouched", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildCorrectionResultTitle("Работа")).toBe("Работа result");
  });
});
