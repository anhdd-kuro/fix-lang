/**
 * @file OverviewPanel.tsx
 * @description Overview dashboard tab. Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and the
 * active range (lifted to the shared dashboard header), then renders a grid of
 * summary stat cards, a day × hour-block activity heatmap, and a benchmark
 * sentence — all from the PURE aggregators in overviewAggregations.ts. No
 * fetch/IPC on mount or tab switch (data is read from props).
 */
import { useMemo } from "react";
import { twJoin } from "tailwind-merge";
import { StatCard } from "./StatCard";
import { filterByRange, type AnalyticsRange } from "../analytics/shared";
import {
  activeDays,
  benchmarkSentence,
  favoriteModel,
  HOUR_BLOCKS,
  HOURS_PER_BLOCK,
  hourBlockHeatmap,
  intensityLevel,
  messageCount,
  peakHour,
  sessionCount,
  splitModelId,
  streaks,
  totalTokens,
} from "../MainWindow/overviewAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

type OverviewPanelProps = {
  /** Corrections-bucket history (App passes the corrections subset). */
  history: HistoryEntry[];
  /** Active time range (All / 30d / 7d), owned by the shared header. */
  range: AnalyticsRange;
};

/** Tailwind classes for the 5 heatmap intensity levels (muted → blue accent). */
const LEVEL_CLASS = [
  "bg-gray-700/40",
  "bg-blue-900",
  "bg-blue-700",
  "bg-blue-500",
  "bg-blue-400",
] as const;

/** Boundary labels for the hour-block axis: 0, 4, 8, …, 24 (HOUR_BLOCKS + 1). */
const BOUNDARY_LABELS = Array.from(
  { length: HOUR_BLOCKS + 1 },
  (_, i) => `${i * HOURS_PER_BLOCK}`
);

export const OverviewPanel = ({ history, range }: OverviewPanelProps) => {
  const view = useMemo(() => {
    // `now` is captured per render; the aggregators take it explicitly so the
    // logic stays pure (and unit-testable with an injected value).
    const now = new Date();
    const filtered = filterByRange(history, range, now);
    return {
      count: filtered.length,
      sessions: sessionCount(filtered),
      messages: messageCount(filtered),
      tokens: totalTokens(filtered),
      days: activeDays(filtered),
      streak: streaks(filtered, now),
      peak: peakHour(filtered),
      favorite: splitModelId(favoriteModel(filtered)),
      heatmap: hourBlockHeatmap(filtered, range, now),
    };
  }, [history, range]);

  const peakValue =
    view.peak === null ? "—" : `${`${view.peak}`.padStart(2, "0")}:00`;

  if (view.count === 0) {
    return (
      <p className="p-4 text-sm text-gray-400">
        No usage in this range yet.
      </p>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Sessions" value={view.sessions.toLocaleString()} />
        <StatCard label="Messages" value={view.messages.toLocaleString()} />
        <StatCard label="Total tokens" value={view.tokens.toLocaleString()} />
        <StatCard label="Active days" value={`${view.days}`} />
        <StatCard label="Current streak" value={`${view.streak.current}d`} />
        <StatCard label="Longest streak" value={`${view.streak.longest}d`} />
        <StatCard label="Peak hour" value={peakValue} />
        <StatCard label="Favorite model" value={view.favorite.model ?? "—"} />
        <StatCard label="Provider" value={view.favorite.provider ?? "—"} />
      </div>

      {/* Activity heatmap — columns = days, rows = 4-hour blocks of the day. */}
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">
          Activity heatmap
        </div>
        <div className="overflow-x-auto">
          <div className="flex gap-2">
            {/* Boundary labels (0,4,…,24) aligned to the block gridlines. */}
            <div className="flex shrink-0 flex-col justify-between text-[10px] leading-none tabular-nums text-gray-500">
              {BOUNDARY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            {/* Day columns. */}
            <div className="flex gap-[3px]">
              {view.heatmap.days.map((day, di) => (
                <div key={day} className="flex flex-col gap-[3px]">
                  {Array.from({ length: HOUR_BLOCKS }, (_, bi) => {
                    const count = view.heatmap.cells[di][bi];
                    return (
                      <div
                        key={bi}
                        title={`${day} ${`${bi * HOURS_PER_BLOCK}`.padStart(2, "0")}:00–${`${(bi + 1) * HOURS_PER_BLOCK}`.padStart(2, "0")}:00 — ${count} message${count === 1 ? "" : "s"}`}
                        className={twJoin(
                          "h-3 w-3 rounded-[2px]",
                          LEVEL_CLASS[intensityLevel(count, view.heatmap.max)]
                        )}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Benchmark comparison sentence. */}
      <p className="text-sm text-gray-400">{benchmarkSentence(view.tokens)}</p>
    </div>
  );
};
