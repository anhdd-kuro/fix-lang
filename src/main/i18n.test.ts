/**
 * @file i18n.test.ts
 * @description `mainT`/`mainFormatters`/`refreshMainLocale` are pure wrappers
 * around the shared translator/formatter factories, driven entirely by
 * `localeStore.getLocale()`. That store is mocked so each test controls the
 * locale directly instead of touching `electron-store`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainFormatters, mainT, refreshMainLocale } from "./i18n";

const localeStoreMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
}));

vi.mock("~/stores/localeStore", () => ({
  getLocale: localeStoreMocks.getLocale,
}));

describe("mainT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshMainLocale();
  });

  it("returns English text under locale \"en\"", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(mainT("common.save")).toBe("Save");
  });

  it("returns Japanese text under locale \"ja\"", () => {
    localeStoreMocks.getLocale.mockReturnValue("ja");

    expect(mainT("common.save")).toBe("保存");
  });

  it("reflects a locale change between two calls with no explicit refresh", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");
    expect(mainT("common.save")).toBe("Save");

    localeStoreMocks.getLocale.mockReturnValue("ja");
    expect(mainT("common.save")).toBe("保存");

    localeStoreMocks.getLocale.mockReturnValue("en");
    expect(mainT("common.save")).toBe("Save");
  });

  it("interpolates params without touching user-authored values", () => {
    localeStoreMocks.getLocale.mockReturnValue("en");

    expect(
      mainT("notifications.correction.resultTitle", {
        presetName: "日本語プロファイル",
      }),
    ).toBe("日本語プロファイル result");
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
    expect(mainT("common.save")).toBe("Save");

    refreshMainLocale();

    expect(mainT("common.save")).toBe("Save");
  });
});
