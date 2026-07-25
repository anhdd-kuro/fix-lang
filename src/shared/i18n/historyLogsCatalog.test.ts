/**
 * @file historyLogsCatalog.test.ts
 * @description Parity guard for the `history.*` and `logs.*` keys added by
 * the Chunk 8b renderer migration (HistoryPanel/HistoryEntryItem/
 * HistoryReviewModal/LogsPanel). Reads the raw JSON catalogs directly rather
 * than the merged `CATALOGS` export from `~/shared/i18n/locales` — this test
 * owns only `history.json`/`logs.json`, so it should not need to change if
 * other namespace files gain/lose keys. Mirrors the shape of
 * `~/renderer/i18n/settingsCatalog.test.ts`.
 *
 * Plural note: EN may define both `_one` and `_other` for a plural key; JA
 * (whose `Intl.PluralRules` category set is just "other") only needs
 * `_other` — see `src/shared/i18n/translate.ts`. Every non-plural key must
 * exist verbatim in both catalogs.
 */

import { describe, expect, it } from "vitest";
import enHistory from "./locales/en/history.json";
import enLogs from "./locales/en/logs.json";
import jaHistory from "./locales/ja/history.json";
import jaLogs from "./locales/ja/logs.json";

type Catalog = Record<string, string>;

const NAMESPACES: readonly { name: string; en: Catalog; ja: Catalog }[] = [
  { name: "history", en: enHistory as Catalog, ja: jaHistory as Catalog },
  { name: "logs", en: enLogs as Catalog, ja: jaLogs as Catalog },
];

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();

const isEnOnlyPluralOne = (key: string): boolean => key.endsWith("_one");

// why: plain ASCII ordering, not `localeCompare` — the latter is
// locale-aware and can disagree with a simple byte-order sort for the
// camelCase/dotted keys used here.
const asciiCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe.each(NAMESPACES)("$name.json: en/ja parity", ({ en, ja }) => {
  const enKeys = Object.keys(en);
  const jaKeys = new Set(Object.keys(ja));

  it("defines at least one key in each catalog", () => {
    expect(enKeys.length).toBeGreaterThan(0);
    expect(jaKeys.size).toBeGreaterThan(0);
  });

  it("every EN key (except *_one plural variants) has a JA translation", () => {
    const missing = enKeys.filter((key) => !isEnOnlyPluralOne(key) && !jaKeys.has(key));
    expect(missing).toEqual([]);
  });

  it("has no JA-only keys (orphans not defined in EN)", () => {
    const orphans = [...jaKeys].filter((key) => !(key in en));
    expect(orphans).toEqual([]);
  });

  it("every key present in both catalogs has an identical {placeholder} set", () => {
    const mismatches = enKeys
      .filter((key) => jaKeys.has(key))
      .filter((key) => {
        const enPlaceholders = placeholdersOf(en[key]);
        const jaPlaceholders = placeholdersOf(ja[key]);
        return JSON.stringify(enPlaceholders) !== JSON.stringify(jaPlaceholders);
      });
    expect(mismatches).toEqual([]);
  });

  it("every EN *_one plural key has a sibling *_other key in EN", () => {
    const missingOther = enKeys
      .filter((key) => key.endsWith("_one"))
      .map((key) => key.replace(/_one$/, "_other"))
      .filter((otherKey) => !enKeys.includes(otherKey));
    expect(missingOther).toEqual([]);
  });

  it("keeps keys sorted alphabetically (diff-reviewable catalog)", () => {
    const sorted = [...enKeys].sort(asciiCompare);
    expect(enKeys).toEqual(sorted);
  });
});

describe("history.json / logs.json: no cross-namespace duplicates", () => {
  it("does not define the same key in both files", () => {
    const historyKeys = new Set(Object.keys(enHistory));
    const overlap = Object.keys(enLogs).filter((key) => historyKeys.has(key));
    expect(overlap).toEqual([]);
  });
});
