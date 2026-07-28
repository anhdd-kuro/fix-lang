/**
 * @file dashboardKeys.test.ts
 * @description Guardrail tests for the dashboard i18n catalog (Chunk 8,
 * `docs/spec.i18n-dashboard.md` §3-§4.4). Structural checks only — no catalog
 * snapshots (spec §4.5) — so a future key addition/edit does not need to
 * touch this file unless it violates one of these invariants:
 *
 *  1. every key `docs/spec.i18n-dashboard.md` §3 introduces exists in the
 *     English catalog;
 *  2. every `*_one` key has a matching `*_other` sibling (en);
 *  3. every plural family that exists in en (has an `_other` member) also
 *     resolves in ja to at least `_other` — ja may omit `_one` entirely,
 *     because `Intl.PluralRules("ja").select(n)` always returns `"other"`;
 *  4. no non-plural key accidentally ends in a plural CLDR suffix;
 *  5. every key ja defines has the same `{placeholder}` set as its en value.
 */
import { describe, expect, it } from "vitest";
import { EN_CATALOG } from "./locales";
import enDashboard from "./locales/en/dashboard.json";
import jaDashboard from "./locales/ja/dashboard.json";

type Catalog = Record<string, string>;
const en = enDashboard as Catalog;
const ja = jaDashboard as Catalog;

/**
 * The 60 keys `docs/spec.i18n-dashboard.md` §3.2-§3.4 introduces, transcribed
 * verbatim from its tables (28 `overview.*` + 21 `charts.*` + 10 `models.*`).
 * Does NOT include the 6 `dashboard.tab.*` keys — those come from
 * `docs/plan.i18n.md`'s Chunk 8 checklist, not this spec, and are covered by
 * `dashboardTabs.test.ts` instead.
 */
const SPEC_KEYS = [
  // overview.* (28)
  "overview.stat.sessions",
  "overview.stat.messages",
  "overview.stat.totalTokens",
  "overview.stat.activeDays",
  "overview.stat.currentStreak",
  "overview.stat.longestStreak",
  "overview.stat.peakHour",
  "overview.stat.favoriteModel",
  "overview.value.days",
  "overview.value.hour",
  "overview.value.empty",
  "overview.tokenActivity.title",
  "overview.tokenActivity.mode.ariaLabel",
  "overview.tokenActivity.mode.daily",
  "overview.tokenActivity.mode.weekly",
  "overview.tokenActivity.mode.cumulative",
  "overview.tokenActivity.tooltip.daily",
  "overview.tokenActivity.tooltip.daily.withCorrections_one",
  "overview.tokenActivity.tooltip.daily.withCorrections_other",
  "overview.tokenActivity.tooltip.weekly",
  "overview.tokenActivity.tooltip.weekly.withCorrections_one",
  "overview.tokenActivity.tooltip.weekly.withCorrections_other",
  "overview.tokenActivity.tooltip.cumulative",
  "overview.tokenActivity.tooltip.cumulative.withCorrections_one",
  "overview.tokenActivity.tooltip.cumulative.withCorrections_other",
  "overview.benchmark.empty",
  "overview.benchmark.overBudget",
  "overview.benchmark.withHeadroom",
  "overview.preset.untitled",
  // charts.* (21)
  "charts.month.jan",
  "charts.month.feb",
  "charts.month.mar",
  "charts.month.apr",
  "charts.month.may",
  "charts.month.jun",
  "charts.month.jul",
  "charts.month.aug",
  "charts.month.sep",
  "charts.month.oct",
  "charts.month.nov",
  "charts.month.dec",
  "charts.presetShare.title",
  "charts.presetShare.datasetLabel",
  "charts.presetShare.tooltip_one",
  "charts.presetShare.tooltip_other",
  "charts.presetShare.empty",
  "charts.correctionsOverTime.title",
  "charts.correctionsOverTime.tooltipTotal",
  "charts.correctionsOverTime.yAxis",
  "charts.correctionsOverTime.empty",
  // models.* (10)
  "models.unknown",
  "models.usage.empty",
  "models.usage.chartTitle",
  "models.usage.barTooltip",
  "models.table.model",
  "models.table.input",
  "models.table.output",
  "models.table.usage",
  "models.table.showLess",
  "models.table.showMore",
] as const;

describe("dashboard.json — spec key inventory (docs/spec.i18n-dashboard.md §3)", () => {
  it("introduces exactly 60 keys", () => {
    expect(SPEC_KEYS.length).toBe(60);
  });

  it("has no duplicate keys in the spec inventory itself", () => {
    expect(new Set(SPEC_KEYS).size).toBe(SPEC_KEYS.length);
  });

  it("defines every spec key in the merged English catalog", () => {
    for (const key of SPEC_KEYS) {
      expect(EN_CATALOG, `EN_CATALOG is missing "${key}"`).toHaveProperty(key);
    }
  });

  it("defines every spec key directly in en/dashboard.json (not borrowed from another namespace)", () => {
    for (const key of SPEC_KEYS) {
      expect(en, `en/dashboard.json is missing "${key}"`).toHaveProperty(key);
    }
  });
});

describe("dashboard.json — plural completeness", () => {
  const enKeys = Object.keys(en);
  const enOneKeys = enKeys.filter((k) => k.endsWith("_one"));
  const enOtherKeys = enKeys.filter((k) => k.endsWith("_other"));

  it("has at least one plural family (sanity check the guardrail isn't vacuous)", () => {
    expect(enOtherKeys.length).toBeGreaterThan(0);
  });

  it("every en `_one` key has a matching `_other` sibling", () => {
    for (const oneKey of enOneKeys) {
      const base = oneKey.slice(0, -"_one".length);
      expect(
        en,
        `en/dashboard.json has "${oneKey}" but no "${base}_other"`,
      ).toHaveProperty(`${base}_other`);
    }
  });

  it("every en plural family (has an `_other` member) resolves in ja to at least `_other`", () => {
    for (const otherKey of enOtherKeys) {
      expect(ja, `ja/dashboard.json is missing "${otherKey}"`).toHaveProperty(
        otherKey,
      );
    }
  });

  it("ja never defines a bare `_one` member — Intl.PluralRules('ja').select(n) always returns 'other'", () => {
    const jaOneKeys = Object.keys(ja).filter((k) => k.endsWith("_one"));
    expect(jaOneKeys).toEqual([]);
  });

  it("no non-plural key accidentally ends in a plural CLDR suffix", () => {
    const pluralSuffixes = [
      "_zero",
      "_one",
      "_two",
      "_few",
      "_many",
      "_other",
    ] as const;
    const pluralFamilyBases = new Set(
      enOtherKeys.map((k) => k.slice(0, -"_other".length)),
    );

    for (const key of enKeys) {
      const suffix = pluralSuffixes.find((s) => key.endsWith(s));
      if (!suffix) {
        continue;
      }
      const base = key.slice(0, -suffix.length);
      expect(
        pluralFamilyBases.has(base),
        `"${key}" ends in a plural suffix but has no real plural family (no "${base}_other")`,
      ).toBe(true);
    }
  });
});

describe("dashboard.json — placeholder parity (en vs ja)", () => {
  const placeholdersOf = (template: string): string[] =>
    [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("every key ja defines has the same {placeholder} set as its en value", () => {
    for (const [key, jaValue] of Object.entries(ja)) {
      const enValue = en[key];
      expect(
        enValue,
        `en/dashboard.json is missing "${key}" that ja defines`,
      ).toBeDefined();
      expect(
        placeholdersOf(jaValue),
        `placeholder mismatch for "${key}"`,
      ).toEqual(placeholdersOf(enValue));
    }
  });
});
