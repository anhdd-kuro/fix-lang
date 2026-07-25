/**
 * @file catalogIntegrity.ts
 * @description Reusable, pure invariant checks over the raw i18n catalog
 * files (`src/shared/i18n/locales/{locale}/<namespace>.json`). Every check
 * returns a list of violations instead of throwing, so callers decide what to
 * do with the result — `catalogIntegrity.test.ts` asserts the list is empty,
 * `scripts/i18n-check.ts` prints it and exits non-zero.
 *
 * Deliberately dependency-free beyond `./registry` (no fs, no Electron, no
 * React) so it is importable from the main process, the renderer, a vitest
 * test, and a bun script alike — mirroring `translate.ts` and `detect.ts`.
 *
 * The plural exception ("ja omits `_one`") is never hardcoded to "ja". It is
 * derived from `Intl.PluralRules(LOCALE_META[locale].intlTag)
 * .resolvedOptions().pluralCategories` for whichever locale is being checked,
 * so a third language with a different CLDR category set (e.g. Polish, which
 * needs `one`/`few`/`many`/`other`) is handled correctly without touching this
 * file — see `docs/plan.i18n.md` "Adding a third language later".
 */

import { DEFAULT_LOCALE, LOCALE_CODES, LOCALE_META, type Locale } from "./registry";

/** A parsed namespace catalog: dotted key → translated string. */
export type Catalog = Record<string, string>;

/** Every CLDR plural category `Intl.PluralRules` can ever select. */
export const CLDR_PLURAL_CATEGORIES = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
] as const;

export type CldrPluralCategory = (typeof CLDR_PLURAL_CATEGORIES)[number];

/** One reported defect. Rendering is left to the caller (test vs. CLI). */
export type IntegrityViolation = {
  rule:
    | "key-parity"
    | "orphan-key"
    | "placeholder-parity"
    | "plural-sibling"
    | "plural-family-unresolved"
    | "plural-suffix-hygiene"
    | "duplicate-key-global"
    | "duplicate-key-in-file"
    | "unsorted-keys"
    | "empty-value"
    | "value-equals-key"
    | "verbatim-source-value"
    | "plural-source-incomplete";
  namespace?: string;
  locale?: Locale;
  key?: string;
  message: string;
};

/** Raw (unparsed) JSON text for one namespace file, per locale that ships it. */
export type NamespaceRaw = {
  /** File stem, e.g. `"tray"` for `locales/{locale}/tray.json`. */
  namespace: string;
  rawByLocale: Partial<Record<Locale, string>>;
};

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

const placeholdersOf = (value: string): string[] =>
  [...value.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]).sort();

// why: plain ASCII ordering, not `localeCompare` — the latter is locale-aware
// and can disagree with a simple byte-order sort for the dotted/camelCase
// keys used here (matches the convention in the per-namespace parity tests).
const asciiCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The CLDR plural categories a locale's `Intl.PluralRules` can select,
 * driven entirely by its registered `intlTag` — never a hardcoded list.
 */
export const pluralCategoriesForLocale = (locale: Locale): ReadonlySet<CldrPluralCategory> =>
  new Set(
    new Intl.PluralRules(LOCALE_META[locale].intlTag).resolvedOptions()
      .pluralCategories as CldrPluralCategory[],
  );

const pluralSuffixOf = (key: string): CldrPluralCategory | undefined =>
  CLDR_PLURAL_CATEGORIES.find((category) => key.endsWith(`_${category}`));

/**
 * Parses a namespace file's raw text into a `Catalog`.
 *
 * why: the catalog files are flat dotted-key → string maps by construction
 * (enforced by the per-namespace parity tests and `checkNoEmptyOr...` below);
 * asserting that known shape here keeps every pure check in this module
 * working with `Catalog` instead of threading `unknown` through all of them.
 */
export const parseCatalog = (rawText: string): Catalog => JSON.parse(rawText) as Catalog;

/**
 * Key parity: every key in `source` must exist in `target`, **except** a
 * plural member whose CLDR category `targetLocale`'s `Intl.PluralRules` never
 * selects (e.g. `_one` for a locale whose category set is only `["other"]`).
 */
export const checkKeyParity = (
  source: Catalog,
  target: Catalog,
  targetLocale: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const neededCategories = pluralCategoriesForLocale(targetLocale);
  const violations: IntegrityViolation[] = [];

  for (const key of Object.keys(source)) {
    if (key in target) {
      continue;
    }
    const suffix = pluralSuffixOf(key);
    if (suffix !== undefined && !neededCategories.has(suffix)) {
      continue; // expected omission — this locale never selects that category
    }
    violations.push({
      rule: "key-parity",
      namespace,
      locale: targetLocale,
      key,
      message: `"${key}" exists in the source catalog but is missing for locale "${targetLocale}".`,
    });
  }

  return violations;
};

/** No orphans: every key `target` defines must exist in `source`. */
export const checkOrphanKeys = (
  source: Catalog,
  target: Catalog,
  targetLocale: Locale,
  namespace?: string,
): IntegrityViolation[] =>
  Object.keys(target)
    .filter((key) => !(key in source))
    .map((key) => ({
      rule: "orphan-key" as const,
      namespace,
      locale: targetLocale,
      key,
      message: `"${key}" is defined for locale "${targetLocale}" but does not exist in the source catalog — likely a typo or a stale key.`,
    }));

/** The `{token}` placeholder set for a key must match across locales. */
export const checkPlaceholderParity = (
  source: Catalog,
  target: Catalog,
  targetLocale: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const violations: IntegrityViolation[] = [];

  for (const [key, targetValue] of Object.entries(target)) {
    const sourceValue = source[key];
    if (sourceValue === undefined) {
      continue; // reported by checkOrphanKeys instead
    }
    const sourcePlaceholders = placeholdersOf(sourceValue);
    const targetPlaceholders = placeholdersOf(targetValue);
    if (JSON.stringify(sourcePlaceholders) !== JSON.stringify(targetPlaceholders)) {
      violations.push({
        rule: "placeholder-parity",
        namespace,
        locale: targetLocale,
        key,
        message: `"${key}" placeholder set differs: source has [${sourcePlaceholders.join(", ")}], "${targetLocale}" has [${targetPlaceholders.join(", ")}].`,
      });
    }
  }

  return violations;
};

/**
 * Every plural member for a category `locale` actually needs must have an
 * `_other` sibling in the same catalog. For `ja` (categories = `["other"]`)
 * this is a no-op, exactly as intended.
 */
export const checkPluralSiblings = (
  catalog: Catalog,
  locale: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const categoriesNeedingOther = [...pluralCategoriesForLocale(locale)].filter(
    (category) => category !== "other",
  );
  const keys = Object.keys(catalog);
  const violations: IntegrityViolation[] = [];

  for (const category of categoriesNeedingOther) {
    const suffix = `_${category}`;
    for (const key of keys) {
      if (!key.endsWith(suffix)) {
        continue;
      }
      const base = key.slice(0, -suffix.length);
      if (!(`${base}_other` in catalog)) {
        violations.push({
          rule: "plural-sibling",
          namespace,
          locale,
          key,
          message: `"${key}" has no sibling "${base}_other" in the same catalog.`,
        });
      }
    }
  }

  return violations;
};

/**
 * Base names of every plural family a catalog defines, identified by its
 * `_other` members (the CLDR category every locale is guaranteed to need).
 */
export const derivePluralFamilyBases = (catalog: Catalog): string[] =>
  Object.keys(catalog)
    .filter((key) => key.endsWith("_other"))
    .map((key) => key.slice(0, -"_other".length));

/**
 * Whether `${base}_${category}` resolves to *some* translation, mirroring
 * the exact fallback chain `translate.ts` runs at call time:
 * `{locale}[key_category]` → `{locale}[key_other]` → `{fallback}[key_category]`
 * → `{fallback}[key_other]`. Exported standalone (not just as part of
 * {@link checkPluralFamilyResolution}) so a genuine gap — a category with no
 * candidate anywhere — can be unit-tested directly with hand-built catalogs,
 * independent of the real locale registry.
 */
export const resolvesPluralCategory = (
  base: string,
  category: string,
  localeCatalog: Catalog,
  fallbackCatalog: Catalog,
): boolean => {
  const candidates = [`${base}_${category}`, `${base}_other`, base];
  return (
    candidates.some((candidate) => localeCatalog[candidate] !== undefined) ||
    candidates.some((candidate) => fallbackCatalog[candidate] !== undefined)
  );
};

/**
 * Every plural family in `families` must resolve to *some* translation, for
 * every CLDR category every configured locale can select. A family that
 * would fall all the way through to echoing the bare key is a violation.
 *
 * Note on the real repo catalogs: `families` is normally derived from the
 * fallback (English) catalog via {@link derivePluralFamilyBases}, and English
 * always defines `_other` for every family it names — so for the current
 * two-locale (`en`/`ja`), two-category (`one`/`other`) catalog, this check is
 * satisfied by construction. It becomes load-bearing the moment a locale with
 * a richer CLDR category set (Polish's `one`/`few`/`many`/`other`, Arabic's
 * six categories, …) is registered and English itself has no translation for
 * a category it never needs — see "Adding a third language later" in
 * `docs/plan.i18n.md`. {@link resolvesPluralCategory} carries the actual
 * proof-of-failure unit tests; this function is exercised end-to-end against
 * the real catalogs instead.
 */
export const checkPluralFamilyResolution = (
  families: readonly string[],
  catalogsByLocale: Partial<Record<Locale, Catalog>>,
  locales: readonly Locale[],
  fallbackLocale: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const fallbackCatalog = catalogsByLocale[fallbackLocale] ?? {};
  const violations: IntegrityViolation[] = [];

  for (const base of families) {
    for (const locale of locales) {
      const localeCatalog = catalogsByLocale[locale] ?? {};
      for (const category of pluralCategoriesForLocale(locale)) {
        if (!resolvesPluralCategory(base, category, localeCatalog, fallbackCatalog)) {
          violations.push({
            rule: "plural-family-unresolved",
            namespace,
            locale,
            key: `${base}_${category}`,
            message: `Plural family "${base}" has no translation for category "${category}" in locale "${locale}" (checked its own catalog, "${base}_other", the fallback locale, and the fallback's "${base}_other").`,
          });
        }
      }
    }
  }

  return violations;
};

/**
 * No non-plural key may end in a CLDR plural suffix (`_zero`/`_one`/`_two`/
 * `_few`/`_many`/`_other`) without a genuine `_other` family member —
 * `PluralBaseKey` (in `translate.ts`) strips exactly that suffix, so an
 * accidental match would silently collide with an unrelated plural base
 * (spec trap 8).
 */
export const checkPluralSuffixHygiene = (
  catalog: Catalog,
  namespace?: string,
): IntegrityViolation[] => {
  const keys = Object.keys(catalog);
  const familyBases = new Set(
    keys.filter((key) => key.endsWith("_other")).map((key) => key.slice(0, -"_other".length)),
  );
  const violations: IntegrityViolation[] = [];

  for (const key of keys) {
    const suffix = pluralSuffixOf(key);
    if (suffix === undefined) {
      continue;
    }
    const base = key.slice(0, -(`_${suffix}`.length));
    if (!familyBases.has(base)) {
      violations.push({
        rule: "plural-suffix-hygiene",
        namespace,
        key,
        message: `"${key}" ends in the CLDR plural suffix "_${suffix}" but has no "${base}_other" sibling in the same catalog, so it would silently collide with the PluralBaseKey type. Rename it or add the missing "_other" family member.`,
      });
    }
  }

  return violations;
};

/**
 * Global uniqueness across namespace files: the merge in `locales/index.ts`
 * is a flat spread, so a key defined in two files silently lets the
 * last-imported one win.
 */
export const checkGlobalUniqueness = (
  namespaceCatalogs: readonly { namespace: string; catalog: Catalog }[],
  locale?: Locale,
): IntegrityViolation[] => {
  const owner = new Map<string, string>();
  const violations: IntegrityViolation[] = [];

  for (const { namespace, catalog } of namespaceCatalogs) {
    for (const key of Object.keys(catalog)) {
      const existingNamespace = owner.get(key);
      if (existingNamespace !== undefined && existingNamespace !== namespace) {
        violations.push({
          rule: "duplicate-key-global",
          namespace,
          locale,
          key,
          message: `"${key}" is defined in both "${existingNamespace}" and "${namespace}" — the flat spread merge in locales/index.ts means one silently wins by import order.`,
        });
        continue;
      }
      owner.set(key, namespace);
    }
  }

  return violations;
};

/**
 * Extracts every top-level object key from raw JSON text, in file order,
 * *without* deduplicating — unlike `JSON.parse`, which silently keeps only
 * the last occurrence of a duplicate key. Only depth-1 quoted strings that
 * are immediately followed by `:` count as keys; this is safe for these
 * catalogs because every value is itself a flat string (verified by
 * `checkNoEmptyOrSelfReferentialValues` and the namespace parity tests), so a
 * value can never be mistaken for a nested object's key.
 */
export const extractRawKeysInOrder = (rawText: string): string[] => {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;

  while (i < rawText.length) {
    const char = rawText[i];

    if (char === '"') {
      const start = i;
      i += 1;
      while (i < rawText.length && rawText[i] !== '"') {
        if (rawText[i] === "\\") {
          i += 1;
        }
        i += 1;
      }
      const value = rawText.slice(start + 1, i);
      i += 1; // skip the closing quote

      if (depth === 1) {
        let lookahead = i;
        while (lookahead < rawText.length && /\s/.test(rawText[lookahead])) {
          lookahead += 1;
        }
        if (rawText[lookahead] === ":") {
          keys.push(value);
        }
      }
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
    i += 1;
  }

  return keys;
};

/**
 * No duplicate keys within one file. `JSON.parse` drops duplicates silently,
 * so this must read the raw text rather than the parsed `Catalog`.
 */
export const checkNoDuplicateKeysInFile = (
  rawText: string,
  namespace?: string,
  locale?: Locale,
): IntegrityViolation[] => {
  const seen = new Set<string>();
  const violations: IntegrityViolation[] = [];

  for (const key of extractRawKeysInOrder(rawText)) {
    if (seen.has(key)) {
      violations.push({
        rule: "duplicate-key-in-file",
        namespace,
        locale,
        key,
        message: `"${key}" appears more than once in this file; JSON.parse silently keeps only the last occurrence.`,
      });
      continue;
    }
    seen.add(key);
  }

  return violations;
};

/** Keys must be alphabetically sorted within each file (reviewable diffs). */
export const checkKeysSorted = (
  rawText: string,
  namespace?: string,
  locale?: Locale,
): IntegrityViolation[] => {
  const keys = extractRawKeysInOrder(rawText);
  const sorted = [...keys].sort(asciiCompare);

  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== sorted[index]) {
      return [
        {
          rule: "unsorted-keys",
          namespace,
          locale,
          key: keys[index],
          message: `Keys are not alphabetically sorted: "${keys[index]}" is out of order (expected "${sorted[index]}" at that position).`,
        },
      ];
    }
  }

  return [];
};

/** No empty values, and no value byte-identical to its own key. */
export const checkNoEmptyOrSelfReferentialValues = (
  catalog: Catalog,
  locale?: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const violations: IntegrityViolation[] = [];

  for (const [key, value] of Object.entries(catalog)) {
    if (value.trim().length === 0) {
      violations.push({
        rule: "empty-value",
        namespace,
        locale,
        key,
        message: `"${key}" has an empty value.`,
      });
      continue;
    }
    if (value === key) {
      violations.push({
        rule: "value-equals-key",
        namespace,
        locale,
        key,
        message: `"${key}" has a value byte-identical to its own key — looks like an untranslated placeholder.`,
      });
    }
  }

  return violations;
};

/**
 * Individual whitespace/punctuation-delimited Latin-letter word tokens that
 * are legitimately identical between the source locale and any other locale
 * — proper nouns, brand names, and short conventional abbreviations that
 * Japanese UI copy genuinely keeps in Latin script. A translated value is
 * exempt from {@link checkNoVerbatimSourceValues} only if *every* Latin-letter
 * token remaining after `{placeholder}`s are stripped is one of these — so
 * "FixLang v{version}" is exempt (both "FixLang" and "v" are listed) but
 * "Temperature Settings" would not be, because "Settings" is not.
 *
 * First unfiltered run against the untouched catalog (bare EN===JA byte
 * equality, no exemptions at all): **14 hits** — see `notes.md` for the full
 * list. Every entry below is commented with why it is here. Do not widen
 * this list to silence a future genuine miss — that is what
 * {@link KNOWN_PREEXISTING_VERBATIM_GAPS} is for, and it is intentionally a
 * separate, more visible list.
 */
export const VERBATIM_ALLOWED_WORDS: ReadonlySet<string> = new Set([
  // Provider brand names — never translated in any locale FixLang ships.
  "OpenAI",
  "OpenRouter",
  "Ollama",
  // FixLang's own product name and the feature name it coined for its
  // prompt-generation window — proper nouns, not translatable English prose.
  "FixLang",
  "PromptGen",
  // Conventional version-string abbreviation, e.g. "FixLang v1.2.3" — kept in
  // Latin script in every locale, matching upstream release-note convention.
  "v",
  // Universal dialog-button loanword: macOS's own Japanese system UI labels
  // the equivalent button "OK" verbatim too, so this is not a translation gap.
  "OK",
]);

/**
 * Pre-existing translation gaps this rule's first unfiltered run surfaced on
 * the real catalog that are **not** legitimate — genuine misses reported as
 * findings here (per this card's scope, catalog JSON may not be edited from
 * this file), not silently folded into {@link VERBATIM_ALLOWED_WORDS} as if
 * they were fine. Keeping this list separate keeps "this is fine" and "this
 * is a bug we owe a fix" from being conflated. See `notes.md` (card 09/D38).
 *
 * Remove an entry the moment its target-locale value is genuinely
 * retranslated — do not add a new one without equally direct evidence (a
 * sibling key in the same family that *is* translated, as below).
 */
export const KNOWN_PREEXISTING_VERBATIM_GAPS: ReadonlySet<string> = new Set([
  // ja/settings.json defines "settings.correction.temperature" as the
  // literal English "Temperature", verbatim-identical to en, while its
  // sibling keys in the same family — temperatureDefault ("デフォルト（1）")
  // and temperatureHint (fully Japanese) — ARE translated. Not a brand, not
  // interpolation, not a unit: a genuine pre-existing miss, out of this
  // card's write-scope (catalogIntegrity.ts / .test.ts only).
  "settings.correction.temperature",
]);

const WORD_TOKEN_PATTERN = /[A-Za-z]+/g;

/** Removes `{placeholder}` tokens, leaving only the literal text around them. */
const withoutPlaceholders = (value: string): string => value.replace(PLACEHOLDER_PATTERN, "");

/**
 * A value identical across locales is legitimate if every Latin-letter word
 * it contains (once placeholders are stripped) is an explicitly allowed
 * token, or if the key is a documented pre-existing gap. A value with no
 * Latin letters at all (pure symbols, digits, or interpolation — e.g. "—" or
 * "{hour}:00") trivially satisfies "every word is allowed" since there are no
 * words to check.
 */
const isLegitimatelyVerbatim = (key: string, value: string): boolean => {
  if (KNOWN_PREEXISTING_VERBATIM_GAPS.has(key)) {
    return true;
  }
  const words = withoutPlaceholders(value).match(WORD_TOKEN_PATTERN) ?? [];
  return words.every((word) => VERBATIM_ALLOWED_WORDS.has(word));
};

/**
 * Hole 1 (card 09 / D38): a target-locale value byte-identical to its source
 * counterpart is invisible to every other check here — `checkKeyParity` only
 * confirms the key exists, `checkPlaceholderParity` only compares placeholder
 * *sets*, and `checkNoEmptyOrSelfReferentialValues` only compares a value to
 * its own **key**, never to the source locale's value for that key. Evidence:
 * setting ja `settings.general.providers.title` to the literal English
 * "Providers" produced zero violations from `bun run i18n:check` before this
 * rule existed.
 *
 * Does not catch: a value that legitimately needs *some* Latin-script token
 * this list has not anticipated (a new brand, a new abbreviation) — that
 * will false-positive once, requiring a new, commented entry in
 * {@link VERBATIM_ALLOWED_WORDS}; and, by design, does not catch a
 * multi-locale value where the source and target differ only in
 * whitespace/casing (e.g. "OpenAI " vs "OpenAI") — those are exact-match
 * only, matching every other byte-identical check in this module.
 */
export const checkNoVerbatimSourceValues = (
  source: Catalog,
  target: Catalog,
  targetLocale: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const violations: IntegrityViolation[] = [];

  for (const [key, targetValue] of Object.entries(target)) {
    const sourceValue = source[key];
    if (sourceValue === undefined || sourceValue !== targetValue) {
      continue; // no source counterpart (orphan-key territory) or already differs
    }
    if (isLegitimatelyVerbatim(key, targetValue)) {
      continue;
    }
    violations.push({
      rule: "verbatim-source-value",
      namespace,
      locale: targetLocale,
      key,
      message: `"${key}" in locale "${targetLocale}" is byte-identical to the source value ("${targetValue}") and is not on the exemption list — looks untranslated.`,
    });
  }

  return violations;
};

/**
 * Hole 2 (card 09 / D39): `resolvesPluralCategory`/`checkPluralFamilyResolution`
 * treat a family's own `_other` member as a valid same-locale fallback for a
 * missing sibling category — correct for ja (which by convention defines
 * only `_other`) but wrong for the source locale, which must define every
 * category its own `Intl.PluralRules` needs directly. Evidence: deleting
 * `settings.general.providers.card.modelCount_one` from `en/settings.json`
 * (while keeping `_other`) produced zero violations and shipped "1 models".
 *
 * Does not catch: a family missing `_other` entirely —
 * `derivePluralFamilyBases` only recognizes a family via its `_other` member
 * (the one category every locale is guaranteed to need), so such a family is
 * invisible to this function *by construction*. That shape (an `_one` with
 * no `_other` sibling) is already reported by `checkPluralSiblings`; this
 * function does not regress it.
 */
export const checkSourceLocalePluralCompleteness = (
  sourceCatalog: Catalog,
  sourceLocale: Locale,
  namespace?: string,
): IntegrityViolation[] => {
  const families = derivePluralFamilyBases(sourceCatalog);
  const neededCategories = pluralCategoriesForLocale(sourceLocale);
  const violations: IntegrityViolation[] = [];

  for (const base of families) {
    for (const category of neededCategories) {
      const memberKey = `${base}_${category}`;
      if (memberKey in sourceCatalog) {
        continue;
      }
      violations.push({
        rule: "plural-source-incomplete",
        namespace,
        locale: sourceLocale,
        key: memberKey,
        message: `Plural family "${base}" in the source locale "${sourceLocale}" has no "${memberKey}" — the source locale must define every CLDR plural category its own Intl.PluralRules requires directly (same-family "_other" fallback is only valid for non-source locales).`,
      });
    }
  }

  return violations;
};

/**
 * Runs every invariant above across a full set of namespace files and
 * returns the combined violation list. Shared by `catalogIntegrity.test.ts`
 * (asserted empty against the real repo catalogs) and
 * `scripts/i18n-check.ts` (printed and turned into a process exit code).
 */
export const checkCatalogIntegrity = (
  namespaces: readonly NamespaceRaw[],
  locales: readonly Locale[] = LOCALE_CODES,
  sourceLocale: Locale = DEFAULT_LOCALE,
): IntegrityViolation[] => {
  const violations: IntegrityViolation[] = [];
  const namespaceCatalogsByLocale: Partial<
    Record<Locale, { namespace: string; catalog: Catalog }[]>
  > = {};

  for (const { namespace, rawByLocale } of namespaces) {
    const catalogsByLocale: Partial<Record<Locale, Catalog>> = {};

    for (const locale of locales) {
      const raw = rawByLocale[locale];
      if (raw === undefined) {
        continue;
      }
      const catalog = parseCatalog(raw);
      catalogsByLocale[locale] = catalog;
      (namespaceCatalogsByLocale[locale] ??= []).push({ namespace, catalog });

      violations.push(...checkNoDuplicateKeysInFile(raw, namespace, locale));
      violations.push(...checkKeysSorted(raw, namespace, locale));
      violations.push(...checkNoEmptyOrSelfReferentialValues(catalog, locale, namespace));
      violations.push(...checkPluralSiblings(catalog, locale, namespace));
      violations.push(...checkPluralSuffixHygiene(catalog, namespace));
    }

    const source = catalogsByLocale[sourceLocale];
    if (source !== undefined) {
      for (const locale of locales) {
        if (locale === sourceLocale) {
          continue;
        }
        const target = catalogsByLocale[locale];
        if (target === undefined) {
          continue; // this namespace ships no file at all for this locale
        }
        violations.push(...checkKeyParity(source, target, locale, namespace));
        violations.push(...checkOrphanKeys(source, target, locale, namespace));
        violations.push(...checkPlaceholderParity(source, target, locale, namespace));
        violations.push(...checkNoVerbatimSourceValues(source, target, locale, namespace));
      }
      violations.push(
        ...checkPluralFamilyResolution(
          derivePluralFamilyBases(source),
          catalogsByLocale,
          locales,
          sourceLocale,
          namespace,
        ),
      );
      violations.push(...checkSourceLocalePluralCompleteness(source, sourceLocale, namespace));
    }
  }

  for (const locale of locales) {
    violations.push(...checkGlobalUniqueness(namespaceCatalogsByLocale[locale] ?? [], locale));
  }

  return violations;
};
