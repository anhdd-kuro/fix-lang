/**
 * @file catalogIntegrity.test.ts
 * @description Two layers, both required (Chunk 11 of `docs/plan.i18n.md`):
 *
 *  1. Unit tests of every invariant in `catalogIntegrity.ts` against small
 *     synthetic fixtures. Each test proves the rule actually *fires* on a
 *     violating fixture, not just that it stays quiet on a clean one.
 *  2. The real repo catalogs (`src/shared/i18n/locales/{en,ja}/*.json`) run
 *     through the same functions and asserted clean.
 *
 * Per the Chunk 11 brief: if a real violation turns up in layer 2, this file
 * must NOT "fix" the catalog data to make the test pass — it reports the
 * violation as a task finding instead.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Catalog,
  checkCatalogIntegrity,
  checkGlobalUniqueness,
  checkKeyParity,
  checkKeysSorted,
  checkNoDuplicateKeysInFile,
  checkNoEmptyOrSelfReferentialValues,
  checkOrphanKeys,
  checkPlaceholderParity,
  checkPluralFamilyResolution,
  checkPluralSiblings,
  checkPluralSuffixHygiene,
  derivePluralFamilyBases,
  extractRawKeysInOrder,
  type NamespaceRaw,
  parseCatalog,
  pluralCategoriesForLocale,
  resolvesPluralCategory,
} from "./catalogIntegrity";
import { CATALOG_NAMESPACES } from "./locales";

const localesDir = path.join(import.meta.dirname, "locales");

describe("pluralCategoriesForLocale", () => {
  it("returns one+other for en, only other for ja (drives every exception below)", () => {
    expect([...pluralCategoriesForLocale("en")].sort()).toEqual(["one", "other"]);
    expect([...pluralCategoriesForLocale("ja")]).toEqual(["other"]);
  });
});

describe("checkKeyParity", () => {
  it("flags a plain missing key", () => {
    const source: Catalog = { "common.save": "Save" };
    const target: Catalog = {};
    const violations = checkKeyParity(source, target, "ja");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "key-parity", key: "common.save" });
  });

  it("does NOT exempt a missing plural member for a locale whose Intl.PluralRules needs that category (proves the exemption is category-driven, not a hardcoded 'ja' special case)", () => {
    const source: Catalog = { "msg_one": "one thing", "msg_other": "many things" };
    const target: Catalog = { "msg_other": "many things" }; // msg_one missing
    // "en" itself needs the "one" category, so this must NOT be exempted.
    const violations = checkKeyParity(source, target, "en");
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("msg_one");
  });

  it("exempts the same missing plural member for a locale whose category set never selects it", () => {
    const source: Catalog = { "msg_one": "one thing", "msg_other": "many things" };
    const target: Catalog = { "msg_other": "many things" };
    const violations = checkKeyParity(source, target, "ja");
    expect(violations).toEqual([]);
  });

  it("passes when every non-exempt key exists", () => {
    const source: Catalog = { "common.save": "Save", "common.cancel": "Cancel" };
    const target: Catalog = { "common.save": "保存", "common.cancel": "キャンセル" };
    expect(checkKeyParity(source, target, "ja")).toEqual([]);
  });
});

describe("checkOrphanKeys", () => {
  it("flags a ja-only key with no en counterpart (typo or stale key)", () => {
    const source: Catalog = { "common.save": "Save" };
    const target: Catalog = { "common.save": "保存", "common.saev": "保存" };
    const violations = checkOrphanKeys(source, target, "ja");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "orphan-key", key: "common.saev" });
  });

  it("passes when every target key exists in source", () => {
    const source: Catalog = { "common.save": "Save" };
    const target: Catalog = { "common.save": "保存" };
    expect(checkOrphanKeys(source, target, "ja")).toEqual([]);
  });
});

describe("checkPlaceholderParity", () => {
  it("flags a mismatched placeholder set", () => {
    const source: Catalog = { "greet": "Hello {name}" };
    const target: Catalog = { "greet": "こんにちは" }; // dropped {name}
    const violations = checkPlaceholderParity(source, target, "ja");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "placeholder-parity", key: "greet" });
  });

  it("flags an extra placeholder introduced only in the target", () => {
    const source: Catalog = { "greet": "Hello" };
    const target: Catalog = { "greet": "こんにちは{name}" };
    const violations = checkPlaceholderParity(source, target, "ja");
    expect(violations).toHaveLength(1);
  });

  it("passes when placeholder sets match, even if token order differs", () => {
    const source: Catalog = { "range": "{start}-{end}" };
    const target: Catalog = { "range": "{end}〜{start}" };
    expect(checkPlaceholderParity(source, target, "ja")).toEqual([]);
  });

  it("skips orphan keys (reported separately by checkOrphanKeys)", () => {
    const source: Catalog = {};
    const target: Catalog = { "orphan.key": "{oops}" };
    expect(checkPlaceholderParity(source, target, "ja")).toEqual([]);
  });
});

describe("checkPluralSiblings", () => {
  it("flags an _one key with no _other sibling, for a locale that needs the one category", () => {
    const catalog: Catalog = { "msg_one": "one thing" };
    const violations = checkPluralSiblings(catalog, "en");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "plural-sibling", key: "msg_one" });
  });

  it("passes when the sibling exists", () => {
    const catalog: Catalog = { "msg_one": "one thing", "msg_other": "many things" };
    expect(checkPluralSiblings(catalog, "en")).toEqual([]);
  });

  it("is a no-op for a locale whose category set excludes 'one' (ja never needs the check)", () => {
    const catalog: Catalog = { "msg_one": "orphaned singular with no _other" };
    expect(checkPluralSiblings(catalog, "ja")).toEqual([]);
  });
});

describe("checkPluralSuffixHygiene", () => {
  it("flags a non-plural key that accidentally ends in a CLDR plural suffix", () => {
    // "settings.general.done" does NOT end in a plural suffix; construct one that does
    // but has no real plural family, e.g. a key literally named "...many" with no
    // "...many"-stripped "_other" sibling.
    const catalog: Catalog = { "stats.how_many": "How many?" };
    const violations = checkPluralSuffixHygiene(catalog);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "plural-suffix-hygiene", key: "stats.how_many" });
  });

  it("does not flag a genuine plural family member", () => {
    const catalog: Catalog = { "msg_one": "one thing", "msg_other": "many things" };
    expect(checkPluralSuffixHygiene(catalog)).toEqual([]);
  });

  it("does not flag a lone _other-suffixed key (a valid single-category family)", () => {
    const catalog: Catalog = { "tray.heatmap.tooltip_other": "{count} corrections" };
    expect(checkPluralSuffixHygiene(catalog)).toEqual([]);
  });
});

describe("resolvesPluralCategory", () => {
  it("fails when neither the locale catalog nor the fallback catalog has any candidate", () => {
    expect(resolvesPluralCategory("msg", "few", {}, {})).toBe(false);
  });

  it("succeeds via the locale's own exact category match", () => {
    expect(resolvesPluralCategory("msg", "one", { "msg_one": "x" }, {})).toBe(true);
  });

  it("succeeds via the locale's own _other member when the exact category is absent", () => {
    expect(resolvesPluralCategory("msg", "few", { "msg_other": "x" }, {})).toBe(true);
  });

  it("succeeds via the fallback catalog when the locale catalog has nothing", () => {
    expect(resolvesPluralCategory("msg", "few", {}, { "msg_other": "x" })).toBe(true);
  });
});

describe("checkPluralFamilyResolution", () => {
  it("flags a family with no candidate anywhere for a category a locale needs (proves the wiring reports resolvesPluralCategory failures)", () => {
    // "phantom" is asserted as a family (as if some catalog had claimed
    // "phantom_other" once) but neither catalog below actually defines any
    // member of it — a genuine, non-tautological gap.
    const violations = checkPluralFamilyResolution(
      ["phantom"],
      { en: {}, ja: {} },
      ["en", "ja"],
      "en",
    );
    // en needs {one, other}, ja needs {other} => 3 unresolved candidates total
    expect(violations).toHaveLength(3);
    expect(violations.every((v) => v.rule === "plural-family-unresolved")).toBe(true);
  });

  it("passes when every family member resolves via its own catalog or the fallback", () => {
    const catalogsByLocale = {
      en: { "msg_one": "one thing", "msg_other": "many things" },
      ja: { "msg_other": "たくさんのモノ" },
    };
    const families = derivePluralFamilyBases(catalogsByLocale.en);
    expect(families).toEqual(["msg"]);
    const violations = checkPluralFamilyResolution(
      families,
      catalogsByLocale,
      ["en", "ja"],
      "en",
    );
    expect(violations).toEqual([]);
  });
});

describe("derivePluralFamilyBases", () => {
  it("extracts the base name from every _other-suffixed key", () => {
    expect(
      derivePluralFamilyBases({ "a_other": "x", "b_one": "y", "b_other": "z" }),
    ).toEqual(["a", "b"]);
  });

  it("returns an empty list for a catalog with no plural families", () => {
    expect(derivePluralFamilyBases({ "common.save": "Save" })).toEqual([]);
  });
});

describe("checkGlobalUniqueness", () => {
  it("flags a key defined in two different namespace files", () => {
    const violations = checkGlobalUniqueness([
      { namespace: "common", catalog: { "shared.key": "a" } },
      { namespace: "tray", catalog: { "shared.key": "b" } },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "duplicate-key-global", key: "shared.key" });
  });

  it("passes when every key is namespace-unique", () => {
    const violations = checkGlobalUniqueness([
      { namespace: "common", catalog: { "common.save": "a" } },
      { namespace: "tray", catalog: { "tray.title": "b" } },
    ]);
    expect(violations).toEqual([]);
  });
});

describe("extractRawKeysInOrder", () => {
  it("reads keys in file order without deduplicating, even across duplicates", () => {
    const raw = `{\n  "a.one": "1",\n  "a.two": "2",\n  "a.one": "3"\n}\n`;
    expect(extractRawKeysInOrder(raw)).toEqual(["a.one", "a.two", "a.one"]);
  });

  it("does not mistake a colon inside a string value for a key delimiter", () => {
    const raw = `{\n  "note": "ratio: {a}:{b}"\n}\n`;
    expect(extractRawKeysInOrder(raw)).toEqual(["note"]);
  });

  it("handles escaped quotes inside values without losing sync", () => {
    const raw = `{\n  "quote": "she said \\"hi\\""\n,\n  "after": "ok"\n}\n`;
    expect(extractRawKeysInOrder(raw)).toEqual(["quote", "after"]);
  });
});

describe("checkNoDuplicateKeysInFile", () => {
  it("flags a key that JSON.parse would silently collapse", () => {
    const raw = `{\n  "a": "1",\n  "b": "2",\n  "a": "3"\n}\n`;
    const violations = checkNoDuplicateKeysInFile(raw);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "duplicate-key-in-file", key: "a" });
  });

  it("passes for a file with unique keys", () => {
    const raw = `{\n  "a": "1",\n  "b": "2"\n}\n`;
    expect(checkNoDuplicateKeysInFile(raw)).toEqual([]);
  });
});

describe("checkKeysSorted", () => {
  it("flags an out-of-order file", () => {
    const raw = `{\n  "b.key": "2",\n  "a.key": "1"\n}\n`;
    const violations = checkKeysSorted(raw);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "unsorted-keys" });
  });

  it("passes for an alphabetically sorted file", () => {
    const raw = `{\n  "a.key": "1",\n  "b.key": "2"\n}\n`;
    expect(checkKeysSorted(raw)).toEqual([]);
  });
});

describe("checkNoEmptyOrSelfReferentialValues", () => {
  it("flags an empty value", () => {
    const violations = checkNoEmptyOrSelfReferentialValues({ "common.save": "" });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "empty-value", key: "common.save" });
  });

  it("flags a value byte-identical to its key", () => {
    const violations = checkNoEmptyOrSelfReferentialValues({ "common.save": "common.save" });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "value-equals-key", key: "common.save" });
  });

  it("passes for a normal translated value", () => {
    expect(checkNoEmptyOrSelfReferentialValues({ "common.save": "Save" })).toEqual([]);
  });
});

describe("checkCatalogIntegrity (orchestrator, synthetic fixtures)", () => {
  it("reports violations from a deliberately broken two-namespace, two-locale fixture", () => {
    const namespaces: NamespaceRaw[] = [
      {
        namespace: "alpha",
        rawByLocale: {
          en: JSON.stringify({ "alpha.save": "Save", "alpha.dup": "shared" }),
          ja: JSON.stringify({ "alpha.save": "保存", "alpha.orphan": "孤立" }),
        },
      },
      {
        namespace: "beta",
        rawByLocale: {
          // "alpha.dup" collides globally with the alpha namespace
          en: JSON.stringify({ "alpha.dup": "shared", "beta.b": "B", "beta.a": "A" }),
          ja: JSON.stringify({ "alpha.dup": "共有", "beta.b": "B", "beta.a": "A" }),
        },
      },
    ];

    const violations = checkCatalogIntegrity(namespaces, ["en", "ja"], "en");
    const rules = new Set(violations.map((v) => v.rule));

    expect(rules.has("orphan-key")).toBe(true); // alpha.orphan
    expect(rules.has("duplicate-key-global")).toBe(true); // alpha.dup
    expect(rules.has("unsorted-keys")).toBe(true); // beta.json: b before a
  });

  it("reports nothing for a clean fixture", () => {
    const namespaces: NamespaceRaw[] = [
      {
        namespace: "alpha",
        rawByLocale: {
          en: JSON.stringify({ "alpha.count_one": "{n} item", "alpha.count_other": "{n} items" }),
          ja: JSON.stringify({ "alpha.count_other": "{n} 件" }),
        },
      },
    ];

    expect(checkCatalogIntegrity(namespaces, ["en", "ja"], "en")).toEqual([]);
  });
});

describe("real repo catalogs", () => {
  const namespaces: NamespaceRaw[] = CATALOG_NAMESPACES.map((namespace) => ({
    namespace,
    rawByLocale: {
      en: readFileSync(path.join(localesDir, "en", `${namespace}.json`), "utf8"),
      ja: readFileSync(path.join(localesDir, "ja", `${namespace}.json`), "utf8"),
    },
  }));

  it("covers every namespace listed in locales/index.ts (sanity check the fixture isn't vacuous)", () => {
    expect(namespaces.length).toBe(CATALOG_NAMESPACES.length);
    expect(namespaces.length).toBeGreaterThan(0);
  });

  it("passes every catalog integrity invariant with zero violations", () => {
    const violations = checkCatalogIntegrity(namespaces, ["en", "ja"], "en");
    if (violations.length > 0) {
      // Diagnostic dump for a failing guardrail — report the real defect
      // instead of silently patching the catalog to make the assertion pass.
      console.error(JSON.stringify(violations, null, 2));
    }
    expect(violations).toEqual([]);
  });

  it("computes a non-zero JA translation-coverage percentage over the merged catalog", () => {
    const enTotal = namespaces.reduce(
      (sum, ns) => sum + Object.keys(parseCatalog(ns.rawByLocale.en ?? "{}")).length,
      0,
    );
    const jaTotal = namespaces.reduce(
      (sum, ns) => sum + Object.keys(parseCatalog(ns.rawByLocale.ja ?? "{}")).length,
      0,
    );
    expect(enTotal).toBeGreaterThan(0);
    expect(jaTotal / enTotal).toBeGreaterThan(0.5);
  });
});
