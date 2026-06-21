/**
 * @file OverviewPanel.tsx
 * @description Overview dashboard tab (#57). Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and the
 * active range, then renders a GitHub-style daily heatmap + stat cards from the
 * PURE aggregators in overviewAggregations.ts. No fetch/IPC on mount or tab
 * switch — data is read from props (honors the #54 "no network on tab switch"
 * rule). The "sessions" concept is intentionally dropped.
 */
import { useMemo, useState } from "react";
import { twJoin } from "tailwind-merge";
import { StatCard } from "./StatCard";
import {
  activeDays,
  costTotal,
  favoriteModel,
  filterByRange,
  heatmapBuckets,
  intensityLevel,
  peakHour,
  perPresetBreakdown,
  streaks,
  totalCorrections,
  totalTokens,
  type OverviewRange,
} from "../MainWindow/overviewAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

type OverviewPanelProps = {
  /** Corrections-bucket history (App passes the corrections subset). */
  history: HistoryEntry[];
};

const RANGES: { id: OverviewRange; label: string }[] = [
  { id: "all", label: "All" },
  { id: "30d", label: "30d" },
  { id: "7d", label: "7d" },
];

/** Tailwind classes for the 5 heatmap intensity levels (gray → blue accent). */
const LEVEL_CLASS = [
  "bg-gray-700/40",
  "bg-blue-900",
  "bg-blue-700",
  "bg-blue-500",
  "bg-blue-400",
] as const;

/** Format a USD total: "$0.00" exact zero, sub-cent precision, else 2 decimals. */
const formatUsdTotal = (amount: number): string => {
  if (amount === 0) {
    return "$0.00";
  }
  if (amount > 0 && amount < 0.01) {
    return `$${amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${amount.toFixed(2)}`;
};

export const OverviewPanel = ({ history }: OverviewPanelProps) => {
  const [range, setRange] = useState<OverviewRange>("all");

  // `now` is captured per render; the aggregators take it explicitly so the
  // logic stays pure (and unit-testable with an injected value).
  const view = useMemo(() => {
    const now = new Date();
    const filtered = filterByRange(history, range, now);
    const buckets = heatmapBuckets(filtered, range, now);
    const maxCount = buckets.reduce((m, b) => Math.max(m, b.count), 0);
    return {
      corrections: totalCorrections(filtered),
      tokens: totalTokens(filtered),
      cost: costTotal(filtered),
      days: activeDays(filtered),
      streak: streaks(filtered, now),
      peak: peakHour(filtered),
      favorite: favoriteModel(filtered),
      presets: perPresetBreakdown(filtered),
      buckets,
      maxCount,
    };
  }, [history, range]);

  const costValue = view.cost.hasNa && view.cost.pricedCount === 0
    ? "N/A"
    : formatUsdTotal(view.cost.totalUsd);
  const costHint = view.cost.hasNa
    ? `${view.cost.pricedCount} of ${view.cost.total} priced`
    : undefined;

  const peakValue =
    view.peak === null ? "—" : `${`${view.peak}`.padStart(2, "0")}:00`;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-1">
      {/* Range toggle — reuses the dashboard filter-button styling. */}
      <div className="flex gap-1" role="group" aria-label="Overview range">
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

      {view.corrections === 0 ? (
        <p className="text-sm text-gray-400">
          No corrections in this range yet.
        </p>
      ) : (
        <>
          {/* GitHub-style daily heatmap */}
          <div>
            <div className="mb-1 text-xs text-gray-400">
              Daily corrections
            </div>
            <div className="flex flex-wrap gap-0.5">
              {view.buckets.map((b) => (
                <div
                  key={b.date}
                  title={`${b.date}: ${b.count} correction${b.count === 1 ? "" : "s"}`}
                  className={twJoin(
                    "h-3 w-3 rounded-[2px]",
                    LEVEL_CLASS[intensityLevel(b.count, view.maxCount)]
                  )}
                />
              ))}
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label="Corrections"
              value={`${view.corrections}`}
            />
            <StatCard
              label="Tokens"
              value={view.tokens.toLocaleString()}
            />
            <StatCard label="Est. cost" value={costValue} hint={costHint} />
            <StatCard label="Active days" value={`${view.days}`} />
            <StatCard
              label="Current streak"
              value={`${view.streak.current}d`}
            />
            <StatCard
              label="Longest streak"
              value={`${view.streak.longest}d`}
            />
            <StatCard label="Peak hour" value={peakValue} />
            <StatCard
              label="Favorite model"
              value={view.favorite ?? "—"}
            />
          </div>

          {/* Per-preset breakdown */}
          <div>
            <div className="mb-1 text-xs text-gray-400">By preset</div>
            <ul className="flex flex-col gap-1">
              {view.presets.map((p) => (
                <li
                  key={p.presetName}
                  className="flex items-center justify-between rounded-sm bg-gray-800 px-2 py-1 text-sm"
                >
                  <span className="text-gray-200">{p.presetName}</span>
                  <span className="tabular-nums text-gray-400">{p.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};
