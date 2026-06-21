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
import { filterByRange, type AnalyticsRange } from "../analytics/shared";
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

/** Stable marker palette — assigned by rank so the top model is always blue. */
const MARKER_COLORS = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#22d3ee",
  "#f472b6",
  "#a3e635",
] as const;

/** How many model rows to show before "Show more". */
const COLLAPSED_ROWS = 5;

const markerColor = (rank: number): string =>
  MARKER_COLORS[rank % MARKER_COLORS.length];

export const ModelsPanel = ({ history, range }: ModelsPanelProps) => {
  const [expanded, setExpanded] = useState<boolean>(false);

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

  if (rows.length === 0) {
    return (
      <p className="p-4 text-sm text-gray-400">
        No model usage in this range yet.
      </p>
    );
  }

  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Token volume over time — thin blue bars. */}
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">
          Token usage over time
        </div>
        <div className="overflow-x-auto">
          <div className="flex h-28 items-end gap-[2px]">
            {bars.map((b) => {
              const pct = maxTokens > 0 ? (b.tokens / maxTokens) * 100 : 0;
              return (
                <div
                  key={b.date}
                  title={`${b.date} — ${b.tokens.toLocaleString()} tokens`}
                  className="w-[5px] shrink-0 rounded-t-[1px] bg-blue-500/80 hover:bg-blue-400"
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
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-2 py-2 font-medium">Model</th>
              <th className="px-2 py-2 text-right font-medium">Input</th>
              <th className="px-2 py-2 text-right font-medium">Output</th>
              <th className="px-2 py-2 text-right font-medium">Usage</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rank) => (
              <tr key={row.model} className="border-t border-gray-700/60">
                <td className="px-2 py-2 text-gray-100">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: markerColor(rank) }}
                    />
                    <span
                      className="max-w-[16rem] truncate"
                      title={row.model}
                    >
                      {row.model}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-300">
                  {row.inputTokens.toLocaleString()}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-300">
                  {row.outputTokens.toLocaleString()}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-300">
                  {row.usageSharePct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length > COLLAPSED_ROWS && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 w-full rounded-md px-2 py-1.5 text-xs text-blue-400 hover:bg-gray-700/60"
          >
            {expanded ? "Show less" : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  );
};
