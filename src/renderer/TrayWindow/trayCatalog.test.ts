/**
 * @file trayCatalog.test.ts
 * @description Parity guard for the `tray.*` and `common.*` keys added by the
 * Chunk 7 renderer migration (tray window + small shared components). Reads
 * the raw JSON catalogs directly rather than the merged `CATALOGS` export
 * from `~/features/i18n/shared/locales` — this migration wave owns `common.json` and
 * `tray.json` exclusively, so the test should not need to change if other
 * namespace files (owned by concurrent migration waves) gain or lose keys.
 *
 * Plural note: EN may define both `_one` and `_other` for a plural key; JA
 * (whose `Intl.PluralRules` category set is just "other") only needs
 * `_other` — see `src/features/i18n/shared/translate.ts`. Every non-plural key must
 * exist verbatim in both catalogs.
 */

import { describe, expect, it } from "vitest";
import enCommon from "~/features/i18n/shared/locales/en/common.json";
import enTray from "~/features/i18n/shared/locales/en/tray.json";
import jaCommon from "~/features/i18n/shared/locales/ja/common.json";
import jaTray from "~/features/i18n/shared/locales/ja/tray.json";

type Catalog = Record<string, string>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();

const isEnOnlyPluralOne = (key: string): boolean => key.endsWith("_one");

/**
 * ASCII byte-order sort, not `localeCompare` — the latter is locale-aware and
 * can disagree with a simple byte-order sort for the dotted/camelCase keys
 * used here (see `settingsCatalog.test.ts` for the same rationale).
 */
const asciiSorted = (keys: readonly string[]): string[] =>
  [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

describe.each([
  { namespace: "common", en: enCommon as Catalog, ja: jaCommon as Catalog },
  { namespace: "tray", en: enTray as Catalog, ja: jaTray as Catalog },
])("$namespace.json: en/ja parity", ({ en, ja }) => {
  const enKeys = Object.keys(en);
  const jaKeys = new Set(Object.keys(ja));

  it("defines at least one key in each catalog", () => {
    expect(enKeys.length).toBeGreaterThan(0);
    expect(jaKeys.size).toBeGreaterThan(0);
  });

  it("every EN key (except *_one plural variants) has a JA translation", () => {
    const missing = enKeys.filter(
      (key) => !isEnOnlyPluralOne(key) && !jaKeys.has(key),
    );
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

  it("keeps EN keys sorted alphabetically (diff-reviewable catalog)", () => {
    expect(enKeys).toEqual(asciiSorted(enKeys));
  });

  it("keeps JA keys sorted alphabetically (diff-reviewable catalog)", () => {
    const jaKeyList = Object.keys(ja);
    expect(jaKeyList).toEqual(asciiSorted(jaKeyList));
  });
});

describe("common.json / tray.json: no duplicate keys across the two namespace files", () => {
  it("has no key defined in both en/common.json and en/tray.json", () => {
    const commonKeys = new Set(Object.keys(enCommon as Catalog));
    const overlap = Object.keys(enTray as Catalog).filter((key) =>
      commonKeys.has(key),
    );
    expect(overlap).toEqual([]);
  });

  it("has no key defined in both ja/common.json and ja/tray.json", () => {
    const commonKeys = new Set(Object.keys(jaCommon as Catalog));
    const overlap = Object.keys(jaTray as Catalog).filter((key) =>
      commonKeys.has(key),
    );
    expect(overlap).toEqual([]);
  });
});
