/**
 * @file autocompleteUsageView.ts
 * @description PURE view-layer helpers for the Autocomplete dashboard tab.
 * Mirrors `overviewCostView.ts` / `modelsView.ts`: all derivation — totals,
 * cap ratio, and the N/A-vs-value call — happens here, locale-free, so
 * `AutocompletePanel.tsx` only resolves descriptors through `t()`.
 *
 * `AutocompleteDayRollup` (`~/features/autocomplete/shared/autocompleteWire`)
 * carries `responses`/`unpricedResponses`/`tokenlessResponses` specifically so
 * this module never has to GUESS whether a zero is real. There used to be a
 * heuristic here — "`requests > 0` but every metric is exactly zero" — that
 * inferred "unmeasured" from a single flag. It was wrong the moment a rollup
 * mixed a local provider (unknown tokens, honestly-known `$0`) with direct
 * OpenAI (known tokens, no knowable price): one boolean cannot carry two
 * independent unknowns, so a direct-OpenAI day with a null price read as
 * "measured" and rendered real billed activity as `$0.00`. The rollup type
 * now states the coverage directly, so no inference is needed:
 *
 * - `responses === 0` (which includes `requests === 0`) — nothing came back to
 *   sum. A genuine zero, not N/A.
 * - `unpricedResponses === 0` (cost) / `tokenlessResponses === 0` (tokens),
 *   with `responses > 0` — every response reported the metric. The total is
 *   the whole truth.
 * - `unpricedResponses === responses` / `tokenlessResponses === responses` —
 *   no response reported it. N/A, never a number.
 * - `0 < unpricedResponses < responses` (respectively `tokenlessResponses`) —
 *   part known, part not. The known total AND its coverage, so a part-known
 *   day never collapses into its knowable half.
 *
 * Cost reuses `resolveOverviewCostHint` from `overviewCostView.ts` for this
 * classification rather than re-deriving it: the rollup's cost triple maps
 * 1:1 onto `CostSum` (see `costSumOf` below), and `resolveOverviewCostHint`'s
 * none/na/amount/partial cases are already the house treatment for "some
 * entries have no knowable price". Tokens follow the identical shape via
 * `tokenlessResponses`, but there is no `TokenSum`/`resolveOverviewCostHint`
 * equivalent to reuse (that function's sub-cent currency precision logic is
 * cost-specific), so `resolveTokenMetric` below re-implements the same
 * three-way read for the token axis.
 */
import { resolveOverviewCostHint } from "./overviewCostView";
import type { CostSum } from "../analytics/shared";
import type {
  AutocompleteDayRollup,
  AutocompleteUsageSnapshot,
} from "~/features/autocomplete/shared/autocompleteWire";
import type { Formatters } from "~/features/i18n/shared/format";
import type { Translator } from "~/features/i18n/shared/translate";

/**
 * A metric that is either a real, renderable number (possibly only partially
 * covered) or honestly unmeasured.
 */
export type AutocompleteMetric =
  | { kind: "value"; value: number; partial?: { known: number; total: number } }
  | { kind: "na" };

export type AutocompleteRollupView = {
  date: string;
  requests: number;
  responses: number;
  /** `promptTokens + completionTokens`, read against `tokenlessResponses`. */
  totalTokens: AutocompleteMetric;
  estimatedCostUsd: AutocompleteMetric;
};

export type AutocompleteCapUsage = {
  requests: number;
  dailyCap: number;
  /** 0..1 ratio, clamped — `0` when `dailyCap <= 0` rather than `NaN`/`Infinity`. */
  ratio: number;
};

export type AutocompleteUsageView = {
  today: AutocompleteRollupView;
  month: AutocompleteRollupView;
  /** Newest first, as the wire snapshot provides it — never re-sorted here. */
  days: AutocompleteRollupView[];
  cap: AutocompleteCapUsage;
};

/**
 * Maps a rollup's cost triple onto the shared `CostSum` shape so the honest
 * none/na/amount/partial classification is INHERITED from
 * `resolveOverviewCostHint`, not re-derived. `total: 0` (no responses at all)
 * lands on `CostSum`'s "no entries" case, which is exactly "nothing came back
 * to sum" — the same genuine zero as `requests === 0`.
 */
const costSumOf = (rollup: AutocompleteDayRollup): CostSum => ({
  totalUsd: rollup.estimatedCostUsd,
  pricedCount: rollup.responses - rollup.unpricedResponses,
  total: rollup.responses,
  hasNa: rollup.unpricedResponses > 0,
});

/** Cost metric via `resolveOverviewCostHint`'s classification — see file doc. */
const resolveCostMetric = (rollup: AutocompleteDayRollup): AutocompleteMetric => {
  const display = resolveOverviewCostHint(costSumOf(rollup));
  if (display.kind === "na") {
    return { kind: "na" };
  }
  if (display.kind === "none") {
    // No responses at all — nothing was priced because nothing came back to
    // price, which is a real `0`, not a measurement gap.
    return { kind: "value", value: 0 };
  }
  return {
    kind: "value",
    value: display.valueUsd,
    partial: display.partial
      ? { known: display.partial.priced, total: display.partial.total }
      : undefined,
  };
};

/**
 * Token metric via the identical three-way read as `resolveCostMetric`, but
 * against `tokenlessResponses` — no `resolveOverviewCostHint`-equivalent
 * exists for token counts (its digit-precision logic is currency-specific),
 * so this re-implements the same ordering (no-responses, all-unreported,
 * some-unreported) rather than importing it.
 */
const resolveTokenMetric = (
  value: number,
  responses: number,
  tokenlessResponses: number
): AutocompleteMetric => {
  if (responses === 0) {
    return { kind: "value", value: 0 };
  }
  if (tokenlessResponses === responses) {
    return { kind: "na" };
  }
  const known = responses - tokenlessResponses;
  return {
    kind: "value",
    value,
    partial: tokenlessResponses > 0 ? { known, total: responses } : undefined,
  };
};

/** Derives one rollup's display metrics from its coverage counters. */
export const resolveAutocompleteRollupView = (
  rollup: AutocompleteDayRollup
): AutocompleteRollupView => ({
  date: rollup.date,
  requests: rollup.requests,
  responses: rollup.responses,
  totalTokens: resolveTokenMetric(
    rollup.promptTokens + rollup.completionTokens,
    rollup.responses,
    rollup.tokenlessResponses
  ),
  estimatedCostUsd: resolveCostMetric(rollup),
});

/** How much of the daily request cap today's rollup has spent, clamped to [0, 1]. */
export const resolveAutocompleteCapUsage = (
  today: AutocompleteDayRollup,
  dailyCap: number
): AutocompleteCapUsage => ({
  requests: today.requests,
  dailyCap,
  ratio: dailyCap > 0 ? Math.min(1, Math.max(0, today.requests / dailyCap)) : 0,
});

/** Assembles the full pure view from a raw wire snapshot. */
export const resolveAutocompleteUsageView = (
  snapshot: AutocompleteUsageSnapshot
): AutocompleteUsageView => ({
  today: resolveAutocompleteRollupView(snapshot.today),
  month: resolveAutocompleteRollupView(snapshot.month),
  days: snapshot.days.map(resolveAutocompleteRollupView),
  cap: resolveAutocompleteCapUsage(snapshot.today, snapshot.dailyCap),
});

/** Renders a count-shaped metric (requests, tokens) — N/A or a locale-formatted number. */
export const formatAutocompleteCount = (
  metric: AutocompleteMetric,
  t: Translator,
  formatNumber: Formatters["formatNumber"]
): string =>
  metric.kind === "na" ? t("autocomplete.value.na") : formatNumber(metric.value);

/** Renders a cost metric — N/A or a locale-formatted currency amount. */
export const formatAutocompleteCost = (
  metric: AutocompleteMetric,
  t: Translator,
  formatCurrency: Formatters["formatCurrency"]
): string =>
  metric.kind === "na" ? t("autocomplete.value.na") : formatCurrency(metric.value);

/**
 * A "2 of 3 known" coverage sub-line for a partially-covered metric —
 * `undefined` when the metric is fully known, unmeasured, or a genuine zero,
 * so callers can render it only when there is something to qualify.
 */
export const formatAutocompleteCoverage = (
  metric: AutocompleteMetric,
  t: Translator
): string | undefined =>
  metric.kind === "value" && metric.partial
    ? t("autocomplete.value.partial", {
        known: metric.partial.known,
        total: metric.partial.total,
      })
    : undefined;

/** True when nothing at all has been recorded — drives the panel's empty state. */
export const isAutocompleteUsageEmpty = (view: AutocompleteUsageView): boolean =>
  view.today.requests === 0 && view.month.requests === 0 && view.days.length === 0;
