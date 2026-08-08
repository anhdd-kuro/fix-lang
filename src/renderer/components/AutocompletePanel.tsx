/**
 * @file AutocompletePanel.tsx
 * @description Autocomplete dashboard tab: today, month-to-date, the up-to-62-day
 * rollup series, and how much of the daily request cap today has spent.
 * Fetches its own snapshot over IPC on mount (`getAutocompleteUsage`) — unlike
 * Overview/Models it has no shared `history` prop to derive from, so it
 * follows `LogsPanel.tsx`'s self-fetching load/error/empty-state shape
 * instead.
 *
 * All derivation (totals, cap ratio, the N/A-vs-value call, partial-coverage
 * detection) lives in `autocompleteUsageView.ts`; this component only resolves
 * the descriptors it returns through
 * `t()`/`formatNumber`/`formatCurrency`/`formatPercent`.
 */
import { useEffect, useMemo, useState } from "react";
import {
  formatAutocompleteCost,
  formatAutocompleteCount,
  formatAutocompleteCoverage,
  isAutocompleteUsageEmpty,
  resolveAutocompleteUsageView,
  type AutocompleteRollupView,
  type AutocompleteUsageView,
} from "./autocompleteUsageView";
import { StatCard } from "./StatCard";
import { useI18n } from "../i18n/useI18n";
import type { AutocompleteUsageSnapshot } from "~/features/autocomplete/shared/autocompleteWire";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; snapshot: AutocompleteUsageSnapshot };

const dayRowKey = (row: AutocompleteRollupView, index: number): string =>
  row.date.length > 0 ? row.date : `row-${String(index)}`;

export const AutocompletePanel = () => {
  const { t, formatNumber, formatCurrency, formatPercent, formatDate } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setState({ status: "loading" });
      try {
        const snapshot = await window.electronAPI.getAutocompleteUsage();
        if (!cancelled) {
          setState({ status: "ready", snapshot });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error" });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const view: AutocompleteUsageView | null = useMemo(
    () => (state.status === "ready" ? resolveAutocompleteUsageView(state.snapshot) : null),
    [state]
  );

  if (state.status === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  if (state.status === "error" || view === null) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t("autocomplete.error.loadFailed")}
      </p>
    );
  }

  const renderRollupStats = (rollup: AutocompleteRollupView) => (
    <>
      <StatCard
        label={t("autocomplete.stat.requests")}
        value={formatNumber(rollup.requests)}
        hint={t("autocomplete.stat.requestsHint")}
      />
      <StatCard
        label={t("autocomplete.stat.tokens")}
        value={formatAutocompleteCount(rollup.totalTokens, t, formatNumber)}
        hint={formatAutocompleteCoverage(rollup.totalTokens, t)}
      />
      <StatCard
        label={t("autocomplete.stat.cost")}
        value={formatAutocompleteCost(rollup.estimatedCostUsd, t, formatCurrency)}
        hint={formatAutocompleteCoverage(rollup.estimatedCostUsd, t)}
      />
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("autocomplete.section.today")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {renderRollupStats(view.today)}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("autocomplete.section.monthToDate")}
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {renderRollupStats(view.month)}
        </div>
      </section>

      <section className="rounded-lg border border-card-control-border bg-card p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
          {t("autocomplete.cap.title")}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-card-control-border/40">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${String(view.cap.ratio * 100)}%` }}
          />
        </div>
        <div className="mt-2 text-sm text-card-foreground">
          {t("autocomplete.cap.usage", {
            requests: view.cap.requests,
            cap: view.cap.dailyCap,
            percent: formatPercent(view.cap.ratio),
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("autocomplete.section.dailyHistory")}
        </h2>
        {isAutocompleteUsageEmpty(view) ? (
          <p className="p-4 text-sm text-muted-foreground">{t("autocomplete.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-card-control-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("autocomplete.day.date")}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("autocomplete.day.requests")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("autocomplete.day.tokens")}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    {t("autocomplete.day.cost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.days.map((row, index) => (
                  <tr
                    key={dayRowKey(row, index)}
                    className="border-t border-card-control-border/60"
                  >
                    <td className="px-3 py-2 text-foreground">
                      {row.date.length > 0 ? formatDate(row.date) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.requests)}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-card-foreground"
                      title={formatAutocompleteCoverage(row.totalTokens, t)}
                    >
                      {formatAutocompleteCount(row.totalTokens, t, formatNumber)}
                    </td>
                    <td
                      className="px-3 py-2 text-right tabular-nums text-card-foreground"
                      title={formatAutocompleteCoverage(row.estimatedCostUsd, t)}
                    >
                      {formatAutocompleteCost(row.estimatedCostUsd, t, formatCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
