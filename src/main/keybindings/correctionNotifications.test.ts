/**
 * @file correctionNotifications.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
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

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

describe("buildCorrectionGoodJobNotification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the English payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildCorrectionGoodJobNotification()).toEqual({
      title: tEn("notifications.correction.goodJob.title"),
      body: tEn("notifications.correction.goodJob.body"),
    });
  });

  it("builds the Japanese payload", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildCorrectionGoodJobNotification();
    expect(result).toEqual({
      title: tJa("notifications.correction.goodJob.title"),
      body: tJa("notifications.correction.goodJob.body"),
    });
    // Prove the locale actually changed the wording.
    expect(result.title).not.toBe(tEn("notifications.correction.goodJob.title"));
  });
});

describe("buildCorrectionResultTitle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("interpolates the preset name in English", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildCorrectionResultTitle("Correction")).toBe(
      tEn("notifications.correction.resultTitle", { presetName: "Correction" }),
    );
  });

  it("interpolates the preset name in Japanese", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    const result = buildCorrectionResultTitle("Correction");
    expect(result).toBe(
      tJa("notifications.correction.resultTitle", { presetName: "Correction" }),
    );
    // Prove the locale actually changed the surrounding template wording.
    expect(result).not.toBe(
      tEn("notifications.correction.resultTitle", { presetName: "Correction" }),
    );
  });

  it("passes an untrusted/non-ASCII preset name through untouched", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(buildCorrectionResultTitle("Работа")).toBe(
      tEn("notifications.correction.resultTitle", { presetName: "Работа" }),
    );
  });
});
