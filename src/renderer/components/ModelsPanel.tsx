/**
 * @file ModelsPanel.tsx
 * @description Models dashboard tab. Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and the
 * active range (lifted to the shared header). Renders a token-volume-over-time
 * bar chart plus a ranked per-model list (marker, name, input/output tokens,
 * usage %) from the PURE aggregators in modelsAggregations.ts. No fetch/IPC on
 * mount or tab switch (reads from props).
 */
import { useMemo, useState } from "react";
import { ModelSelect } from "./ModelSelect";
import { barTooltipMessage, MODEL_TABLE_HEADER_KEYS, showMoreMessage } from "./modelsView";
import { filterByRange, type AnalyticsRange } from "../analytics/shared";
import { useI18n } from "../i18n/useI18n";
import {
  perModelBreakdown,
  tokensPerDay,
} from "../MainWindow/modelsAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

type ModelsPanelProps = {
  /** Corrections-bucket history (App passes the corrections subset). */
  history: HistoryEntry[];
  /** Active time range (All / 30d / 7d), owned by the shared header. */
  range: AnalyticsRange;
};

/** Theme-aware marker palette — cycles chart / status tokens by rank. */
const MARKER_VARS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--success)",
  "var(--warning)",
  "var(--primary)",
  "var(--destructive)",
] as const;

/** How many model rows to show before "Show more". */
const COLLAPSED_ROWS = 5;

const markerColor = (rank: number): string =>
  MARKER_VARS[rank % MARKER_VARS.length];

export const ModelsPanel = ({ history, range }: ModelsPanelProps) => {
  const { t, tl, tm, formatNumber } = useI18n();
  const [expanded, setExpanded] = useState<boolean>(false);

  // Descriptor-free data only — no locale-sensitive string is built inside
  // this memo, so it needs no `t`/`locale` dependency (unlike
  // `PresetWeightChart`'s chart-options memo — see spec.i18n-dashboard.md §5.3
  // trap 2, which calls out reviewing this memo for the same risk).
  const { rows, bars, maxTokens } = useMemo(() => {
    const now = new Date();
    const filtered = filterByRange(history, range, now);
    const bars = tokensPerDay(filtered, range, now);
    return {
      rows: perModelBreakdown(filtered),
      bars,
      maxTokens: bars.reduce((m, b) => Math.max(m, b.tokens), 0),
    };
  }, [history, range]);

  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Global model switch — same persist path as Tray. */}
      <div className="rounded-lg border border-border bg-card p-4">
        <ModelSelect saveOnChange showAdditionalInfo />
      </div>

      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {t("models.usage.empty")}
        </p>
      ) : (
        <>
          {/* Token volume over time — thin blue bars. */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              {t("models.usage.chartTitle")}
            </div>
            <div className="overflow-x-auto">
              <div className="flex h-28 items-end gap-[2px]">
                {bars.map((b) => {
                  const pct = maxTokens > 0 ? (b.tokens / maxTokens) * 100 : 0;
                  return (
                    <div
                      key={b.date}
                      title={tm(barTooltipMessage(b, b.date))}
                      className="w-[5px] shrink-0 rounded-t-[1px] bg-primary/80 hover:bg-primary/90"
                      // Inline height: a data-driven per-bar value, not a static
                      // style — keep at least a 1px sliver for non-zero days.
                      style={{
                        height: `${b.tokens > 0 ? Math.max(pct, 2) : 0}%`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* Ranked model list. */}
          <div className="rounded-lg border border-border bg-card p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">{t(MODEL_TABLE_HEADER_KEYS.model)}</th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t(MODEL_TABLE_HEADER_KEYS.input)}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t(MODEL_TABLE_HEADER_KEYS.output)}
                  </th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t(MODEL_TABLE_HEADER_KEYS.usage)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rank) => (
                  <tr key={row.model} className="border-t border-border/60">
                    <td className="px-2 py-2 text-foreground">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: markerColor(rank) }}
                        />
                        <span
                          className="max-w-[16rem] truncate"
                          // Raw model id — identity, never translated (see
                          // spec.i18n-dashboard.md §1.3). Display text below
                          // uses `modelLabel` instead.
                          title={row.model}
                        >
                          {tl(row.modelLabel)}
                        </span>
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.inputTokens)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.outputTokens)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-card-foreground">
                      {formatNumber(row.usageSharePct, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {rows.length > COLLAPSED_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 w-full rounded-md px-2 py-1.5 text-xs text-primary hover:bg-secondary/60"
              >
                {tm(showMoreMessage(expanded, hiddenCount))}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
