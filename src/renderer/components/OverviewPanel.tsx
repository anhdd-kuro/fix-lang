/**
 * @file OverviewPanel.tsx
 * @description Overview dashboard tab. Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and the
 * active range (lifted to the shared dashboard header), then renders a grid of
 * summary stat cards, a day × hour-block activity heatmap, and a benchmark
 * sentence — all from the PURE aggregators in overviewAggregations.ts. No
 * fetch/IPC on mount or tab switch (data is read from props).
 */
import { useEffect, useMemo, useRef, useState } from "react";
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
  stripModelDate,
  streaks,
  totalTokens,
} from "../MainWindow/overviewAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

/** Heatmap column geometry: 7px square + 3px gap = 10px per day column. */
const CELL_PX = 7;
const GAP_PX = 3;
const PX_PER_DAY = CELL_PX + GAP_PX;
/** Reserve for the boundary-label column + its gap before the squares. */
const LABEL_GUTTER_PX = 28;

/** Track an element's content width via ResizeObserver (0 until first measure). */
const useElementWidth = (): [
  React.RefObject<HTMLDivElement | null>,
  number,
] => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
};

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
  const [heatmapRef, heatmapWidth] = useElementWidth();

  // Number of day columns to render: fill the measured width (≥30), so wider
  // screens show more days. ~10px per column; reserve the label gutter.
  const cols = useMemo(() => {
    if (heatmapWidth <= 0) {
      return 30;
    }
    const fit = Math.floor((heatmapWidth - LABEL_GUTTER_PX) / PX_PER_DAY);
    return Math.max(30, fit);
  }, [heatmapWidth]);

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
      favorite: stripModelDate(favoriteModel(filtered)),
      heatmap: hourBlockHeatmap(filtered, range, now, cols),
    };
  }, [history, range, cols]);

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
        <StatCard label="Favorite model" value={view.favorite ?? "—"} />
      </div>

      {/* Activity heatmap — columns = days, rows = 4-hour blocks of the day. */}
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
        <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">
          Activity heatmap
        </div>
        {/* ref measures available width → column count fills the screen. */}
        <div ref={heatmapRef} className="overflow-x-auto">
          <div className="flex" style={{ gap: GAP_PX }}>
            {/* Boundary labels (0,4,…,24) aligned to the block gridlines. */}
            <div className="flex shrink-0 flex-col justify-between text-[10px] leading-none tabular-nums text-gray-500">
              {BOUNDARY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            {/* Day columns. */}
            <div className="flex" style={{ gap: GAP_PX }}>
              {view.heatmap.days.map((day, di) => (
                <div
                  key={day}
                  className="flex flex-col"
                  style={{ gap: GAP_PX }}
                >
                  {Array.from({ length: HOUR_BLOCKS }, (_, bi) => {
                    const count = view.heatmap.cells[di][bi];
                    return (
                      <div
                        key={bi}
                        title={`${day} ${`${bi * HOURS_PER_BLOCK}`.padStart(2, "0")}:00–${`${(bi + 1) * HOURS_PER_BLOCK}`.padStart(2, "0")}:00 — ${count} message${count === 1 ? "" : "s"}`}
                        style={{ width: CELL_PX, height: CELL_PX }}
                        className={twJoin(
                          "rounded-[2px]",
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
