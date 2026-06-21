/**
 * @file ModelsPanel.tsx
 * @description Models dashboard tab (#58). Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and
 * renders a per-model table (usage share %, tokens, N/A-aware cost) from the
 * PURE `perModelBreakdown`, grouped by the served model (`resolvedModel ??
 * model`). No fetch/IPC on mount or tab switch — reads from props (#54 rule).
 */
import { useMemo, useState } from "react";
import { twJoin } from "tailwind-merge";
import { filterByRange, formatUsd, type AnalyticsRange } from "../analytics/shared";
import { perModelBreakdown } from "../MainWindow/modelsAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

type ModelsPanelProps = {
  /** Corrections-bucket history (App passes the corrections subset). */
  history: HistoryEntry[];
};

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "all", label: "All" },
  { id: "30d", label: "30d" },
  { id: "7d", label: "7d" },
];

/** Cost cell text: N/A when the whole group is unpriced, else USD (+ partial note). */
const costCell = (
  estimatedCostUsd: number | null,
  costHasNa: boolean
): string => {
  if (estimatedCostUsd === null) {
    return "N/A";
  }
  return costHasNa ? `${formatUsd(estimatedCostUsd)} (partial)` : formatUsd(estimatedCostUsd);
};

export const ModelsPanel = ({ history }: ModelsPanelProps) => {
  const [range, setRange] = useState<AnalyticsRange>("all");

  const rows = useMemo(() => {
    const now = new Date();
    return perModelBreakdown(filterByRange(history, range, now));
  }, [history, range]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-1">
      {/* Range toggle — mirrors the Overview/dashboard filter-button styling. */}
      <div className="flex gap-1" role="group" aria-label="Models range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            aria-pressed={range === r.id}
            className={twJoin(
              "px-2 py-0.5 text-xs rounded-sm",
              range === r.id
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No model usage in this range yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-1 pr-2 font-medium">Model</th>
              <th className="py-1 px-2 text-right font-medium">Usage</th>
              <th className="py-1 px-2 text-right font-medium">Tokens</th>
              <th className="py-1 pl-2 text-right font-medium">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model} className="border-t border-gray-700">
                <td
                  className="py-1.5 pr-2 text-gray-100 max-w-[10rem] truncate"
                  title={row.model}
                >
                  {row.model}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-gray-300">
                  {row.usageCount}{" "}
                  <span className="text-gray-500">
                    ({row.usageSharePct.toFixed(1)}%)
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-gray-300">
                  {row.totalTokens.toLocaleString()}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-gray-300">
                  {costCell(row.estimatedCostUsd, row.costHasNa)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
