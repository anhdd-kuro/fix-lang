/**
 * @file settingsCatalog.test.ts
 * @description Parity guard for the `settings.*` keys added by the renderer
 * i18n wave (SettingGeneral migration + LanguageTabs). Reads the raw JSON
 * catalogs directly rather than the merged `CATALOGS` export from
 * `~/features/i18n/shared/locales` — this test owns only `settings.json`, so it
 * should not need to change if other namespace files gain/lose keys.
 *
 * Plural note: EN may define both `_one` and `_other` for a plural key; JA
 * (whose `Intl.PluralRules` category set is just "other") only needs
 * `_other` — see `src/features/i18n/shared/translate.ts`. Every non-plural key must
 * exist verbatim in both catalogs.
 */

import { describe, expect, it } from "vitest";
import enSettings from "~/features/i18n/shared/locales/en/settings.json";
import jaSettings from "~/features/i18n/shared/locales/ja/settings.json";

type Catalog = Record<string, string>;

const en = enSettings as Catalog;
const ja = jaSettings as Catalog;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();

const isEnOnlyPluralOne = (key: string): boolean => key.endsWith("_one");

describe("settings.json: en/ja parity", () => {
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

  it("keeps settings.general.* keys sorted alphabetically (diff-reviewable catalog)", () => {
    const generalKeys = enKeys.filter((key) => key.startsWith("settings.general."));
    // why: plain ASCII ordering, not `localeCompare` — the latter is
    // locale-aware and can disagree with a simple byte-order sort for the
    // camelCase/dotted keys used here.
    const sorted = [...generalKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(generalKeys).toEqual(sorted);
  });
});
