import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator, resetTranslatorDiagnostics } from "./translate";
import type { TranslationKey } from "./locales";
import type { Locale } from "./registry";
import type { TKey } from "./translate";
import type { MockInstance } from "vitest";

// why: fixture catalogs inject keys beyond the seeded `common.*` contract
// (plural pairs, missing-locale cases, interpolation templates) without
// editing the frozen locale JSON files. `TranslationKey` is a literal union
// derived from that JSON, so a fixture with extra keys needs a structural
// cast rather than a direct annotation.
type FixtureCatalogs = Record<Locale, Partial<Record<TranslationKey, string>>>;

const fixtureCatalogs = {
  en: {
    "common.cancel": "Cancel",
    "fixture.enOnly": "English only text",
    "fixture.hello": "Hello, {name}!",
    "fixture.repeatName": "{name} and {name} again",
    "fixture.multi": "{greeting}, {name}! You are {age}.",
    "fixture.missingParam": "Value: {missing}",
    "fixture.count_one": "{count} item",
    "fixture.count_other": "{count} items",
    "fixture.onlyOther_other": "always other",
  },
  ja: {
    "common.cancel": "キャンセル",
    "fixture.count_other": "{count} 件",
  },
} as unknown as FixtureCatalogs;

let warnSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  resetTranslatorDiagnostics();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("createTranslator direct hits", () => {
  it("resolves a key directly from the English catalog", () => {
    const t = createTranslator("en");
    expect(t("common.cancel")).toBe("Cancel");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("resolves a key directly from the Japanese catalog", () => {
    const t = createTranslator("ja");
    expect(t("common.cancel")).toBe("キャンセル");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("createTranslator fallback chain", () => {
  it("falls back to the English string when a key is missing in ja", () => {
    const t = createTranslator("ja", fixtureCatalogs);
    expect(t("fixture.enOnly" as TKey)).toBe("English only text");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the key string verbatim when missing from every catalog", () => {
    const t = createTranslator("en");
    expect(t("definitely.not.a.key" as TKey)).toBe("definitely.not.a.key");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createTranslator interpolation", () => {
  it("interpolates a single param", () => {
    const t = createTranslator("en", fixtureCatalogs);
    expect(t("fixture.hello" as TKey, { name: "Ada" })).toBe("Hello, Ada!");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("interpolates several params", () => {
    const t = createTranslator("en", fixtureCatalogs);
    expect(
      t("fixture.multi" as TKey, { greeting: "Hi", name: "Bo", age: 30 }),
    ).toBe("Hi, Bo! You are 30.");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("substitutes a param used twice", () => {
    const t = createTranslator("en", fixtureCatalogs);
    expect(t("fixture.repeatName" as TKey, { name: "Cy" })).toBe(
      "Cy and Cy again",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("leaves a missing param's literal token and warns once", () => {
    const t = createTranslator("en", fixtureCatalogs);
    expect(t("fixture.missingParam" as TKey, {})).toBe("Value: {missing}");
    expect(t("fixture.missingParam" as TKey, {})).toBe("Value: {missing}");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createTranslator plural selection", () => {
  it("picks _one for EN count 1 and _other for 0 and 2", () => {
    const t = createTranslator("en", fixtureCatalogs);
    expect(t("fixture.count" as TKey, { count: 1 })).toBe("1 item");
    expect(t("fixture.count" as TKey, { count: 0 })).toBe("0 items");
    expect(t("fixture.count" as TKey, { count: 2 })).toBe("2 items");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("always resolves to _other for ja regardless of count", () => {
    const t = createTranslator("ja", fixtureCatalogs);
    expect(t("fixture.count" as TKey, { count: 1 })).toBe("1 件");
    expect(t("fixture.count" as TKey, { count: 5 })).toBe("5 件");
    expect(t("fixture.count" as TKey, { count: 100 })).toBe("100 件");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to _other when the selected category has no key", () => {
    const t = createTranslator("en", fixtureCatalogs);
    // English count === 1 selects "one", but only "_other" is defined.
    expect(t("fixture.onlyOther" as TKey, { count: 1 })).toBe("always other");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not trigger plural selection for a non-numeric or NaN count", () => {
    const t = createTranslator("en", fixtureCatalogs);
    expect(t("fixture.count" as TKey, { count: Number.NaN })).toBe(
      "fixture.count",
    );
    expect(t("fixture.count" as TKey, { count: "many" })).toBe(
      "fixture.count",
    );
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("createTranslator warning de-duplication", () => {
  it("warns once per missing key and resets via resetTranslatorDiagnostics", () => {
    const t = createTranslator("en");
    t("definitely.not.a.key" as TKey);
    t("definitely.not.a.key" as TKey);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    resetTranslatorDiagnostics();
    t("definitely.not.a.key" as TKey);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
