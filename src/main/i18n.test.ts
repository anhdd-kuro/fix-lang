/**
 * @file i18n.test.ts
 * @description `mainT`/`mainFormatters`/`refreshMainLocale` are pure wrappers
 * around the shared translator/formatter factories, driven entirely by
 * `localeStore.getLocale()`. That store is mocked so each test controls the
 * locale directly instead of touching `electron-store`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { mainFormatters, mainT, refreshMainLocale } from "./i18n";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

// Expected text is derived through the real translator kernel — the same one
// `mainT` wraps — so a catalog reword can't silently break this file.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

describe("mainT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMainLocale();
  });

  it("returns English text under locale \"en\"", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(mainT("common.save")).toBe(tEn("common.save"));
  });

  it("returns Japanese text under locale \"ja\"", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(mainT("common.save")).toBe(tJa("common.save"));
    // Prove the locale actually changed the wording.
    expect(tJa("common.save")).not.toBe(tEn("common.save"));
  });

  it("reflects a locale change between two calls with no explicit refresh", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    expect(mainT("common.save")).toBe(tEn("common.save"));

    localeStoreMocks.getLocale.mockReturnValue("ja");
    expect(mainT("common.save")).toBe(tJa("common.save"));

    localeStoreMocks.getLocale.mockReturnValue("en");
    expect(mainT("common.save")).toBe(tEn("common.save"));
  });

  it("interpolates params without touching user-authored values", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(
      mainT("notifications.correction.resultTitle", {
        presetName: "日本語プロファイル",
      }),
    ).toBe(tEn("notifications.correction.resultTitle", { presetName: "日本語プロファイル" }));
  });
});

describe("mainFormatters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMainLocale();
  });

  it("returns a formatter bundle matching the current locale", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    expect(mainFormatters().formatNumber(1234)).toBe("1,234");

    localeStoreMocks.getLocale.mockReturnValue("ja");
    expect(mainFormatters().formatNumber(1234)).toBe("1,234");
  });
});

describe("refreshMainLocale", () => {
  it("does not break subsequent lookups for the same locale", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    expect(mainT("common.save")).toBe(tEn("common.save"));

    refreshMainLocale();

    expect(mainT("common.save")).toBe(tEn("common.save"));
  });
});
