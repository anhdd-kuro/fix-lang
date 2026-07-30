/**
 * @file settingsCatalogWave.test.ts
 * @description Parity guard for the Chunk 9 renderer-migration-wave-C keys:
 * `models.json`, `profiles.json` (owned entirely by this wave), and every
 * `settings.*` key added under this wave EXCEPT `settings.general.*` (the
 * reference conversion, already covered by
 * `src/renderer/i18n/settingsCatalog.test.ts` — this file must not need to
 * change if that namespace changes).
 *
 * Plural note: EN may define both `_one` and `_other` for a plural key; JA
 * (whose `Intl.PluralRules` category set is just "other") only needs
 * `_other` — see `src/features/i18n/shared/translate.ts`. Every non-plural key must
 * exist verbatim in both catalogs.
 */

import { describe, expect, it } from "vitest";
import enModels from "./locales/en/models.json";
import enProfiles from "./locales/en/profiles.json";
import enSettings from "./locales/en/settings.json";
import jaModels from "./locales/ja/models.json";
import jaProfiles from "./locales/ja/profiles.json";
import jaSettings from "./locales/ja/settings.json";

type Catalog = Record<string, string>;

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();

const isEnOnlyPluralOne = (key: string): boolean => key.endsWith("_one");

/** Keys this wave owns within `settings.json` — everything except the
 * frozen `settings.general.*` reference conversion. */
const isWaveOwnedSettingsKey = (key: string): boolean =>
  !key.startsWith("settings.general.");

const waveEnSettings = Object.fromEntries(
  Object.entries(enSettings as Catalog).filter(([key]) => isWaveOwnedSettingsKey(key)),
);
const waveJaSettings = Object.fromEntries(
  Object.entries(jaSettings as Catalog).filter(([key]) => isWaveOwnedSettingsKey(key)),
);

/** One {en, ja, label} entry per namespace file this wave owns. */
const NAMESPACES: { label: string; en: Catalog; ja: Catalog }[] = [
  { label: "models.json", en: enModels as Catalog, ja: jaModels as Catalog },
  { label: "profiles.json", en: enProfiles as Catalog, ja: jaProfiles as Catalog },
  { label: "settings.json (wave-owned keys)", en: waveEnSettings, ja: waveJaSettings },
];

describe.each(NAMESPACES)("$label: en/ja parity", ({ en, ja }) => {
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
    // why: plain ASCII ordering, not `localeCompare` — the latter is
    // locale-aware and can disagree with a simple byte-order sort for the
    // camelCase/dotted keys used here.
    const sorted = [...enKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(enKeys).toEqual(sorted);
  });

  it("has no duplicate keys", () => {
    const seen = new Set<string>();
    const duplicates = enKeys.filter((key) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    expect(duplicates).toEqual([]);
  });
});

describe("no key collisions across the wave's namespace files", () => {
  it("models.json, profiles.json, and the wave's settings.json keys are globally unique", () => {
    const allKeys = [
      ...Object.keys(enModels as Catalog),
      ...Object.keys(enProfiles as Catalog),
      ...Object.keys(waveEnSettings),
    ];
    const seen = new Set<string>();
    const duplicates = allKeys.filter((key) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    expect(duplicates).toEqual([]);
  });

  it("does not duplicate any settings.general.* key already owned by the reference conversion", () => {
    const generalKeys = new Set(
      Object.keys(enSettings as Catalog).filter((key) => key.startsWith("settings.general.")),
    );
    const overlap = [
      ...Object.keys(enModels as Catalog),
      ...Object.keys(enProfiles as Catalog),
    ].filter((key) => generalKeys.has(key));
    expect(overlap).toEqual([]);
  });
});
