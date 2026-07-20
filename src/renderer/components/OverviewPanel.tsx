/**
 * @file OverviewPanel.tsx
 * @description Overview dashboard tab. Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and the
 * active range (lifted to the shared dashboard header), then renders a grid of
 * summary stat cards, Chart.js preset donut + time-series combo charts, a Codex-style token
 * activity calendar, and a benchmark sentence — all from the PURE aggregators
 * in overviewAggregations.ts.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { twJoin } from "tailwind-merge";
import { heatmapCellClass, heatmapLevelClass } from "./heatmapIntensity";
import { PresetWeightChart } from "./PresetWeightChart";
import { StatCard } from "./StatCard";
import { filterByRange, type AnalyticsRange } from "../analytics/shared";
import {
  activeDays,
  benchmarkSentence,
  favoriteModel,
  messageCount,
  peakHour,
  perPresetWeights,
  presetCountsOverTime,
  sessionCount,
  stripModelDate,
  streaks,
  tokenActivityCalendar,
  totalTokens,
  type TokenActivityCalendar,
  type TokenActivityCalendarCell,
  type TokenActivityMode,
} from "../MainWindow/overviewAggregations";
import type { HistoryEntry } from "~/stores/historyStore";

type OverviewPanelProps = {
  /** Corrections-bucket history (App passes the corrections subset). */
  history: HistoryEntry[];
  /** Active time range (All / 30d / 7d), owned by the shared header. */
  range: AnalyticsRange;
};

const TOKEN_ACTIVITY_TABS: readonly {
  label: string;
  mode: TokenActivityMode;
}[] = [
  { label: "Daily", mode: "daily" },
  { label: "Weekly", mode: "weekly" },
  { label: "Cumulative", mode: "cumulative" },
] as const;

const MIN_CELL_SIZE_PX = 12;
const CELL_GAP_PX = 4;
const CALENDAR_ROWS = 7;

const placeholderCell = (
  column: number,
  row: number
): TokenActivityCalendarCell => ({
  kind: "placeholder",
  date: null,
  tokenTotal: 0,
  correctionCount: 0,
  level: 0,
  column,
  row,
});

const calendarColumns = (
  calendar: TokenActivityCalendar
): TokenActivityCalendarCell[][] => {
  const columns = Array.from({ length: calendar.columns }, (_, columnIndex) =>
    Array.from({ length: CALENDAR_ROWS }, (_, rowIndex) =>
      placeholderCell(columnIndex, rowIndex)
    )
  );

  for (const cell of calendar.cells) {
    columns[cell.column][cell.row] = cell;
  }

  return columns;
};

const dateFromDayKey = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const dayKeyOfDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const weeklyRangeLabel = (dayKey: string): string => {
  const day = dateFromDayKey(dayKey);
  const start = addDays(day, -day.getDay());
  const end = addDays(start, 6);
  return `${dayKeyOfDate(start)} to ${dayKeyOfDate(end)}`;
};

const tooltipForCell = (
  mode: TokenActivityMode,
  cell: TokenActivityCalendarCell
): string | undefined => {
  if (cell.kind === "placeholder") {
    return undefined;
  }

  const correctionSuffix =
    cell.correctionCount > 0
      ? `, ${cell.correctionCount} correction${cell.correctionCount === 1 ? "" : "s"}`
      : "";

  if (mode === "daily") {
    return `${cell.tokenTotal.toLocaleString()} tokens on ${cell.date}${correctionSuffix}`;
  }
  if (mode === "weekly") {
    return `${cell.tokenTotal.toLocaleString()} tokens during ${weeklyRangeLabel(cell.date)}${correctionSuffix}`;
  }
  return `${cell.tokenTotal.toLocaleString()} tokens through ${cell.date}${correctionSuffix}`;
};

const calendarGapTotal = (columnCount: number): number =>
  Math.max(0, (columnCount - 1) * CELL_GAP_PX);

const calendarWidth = (columnCount: number, cellSize: number): number =>
  columnCount * cellSize + calendarGapTotal(columnCount);

const fittedCellSize = (availableWidth: number, columnCount: number): number => {
  if (availableWidth <= 0 || columnCount <= 0) {
    return MIN_CELL_SIZE_PX;
  }

  const widthAfterGaps = availableWidth - calendarGapTotal(columnCount);
  return Math.max(MIN_CELL_SIZE_PX, widthAfterGaps / columnCount);
};

const useElementWidth = (): [RefObject<HTMLDivElement | null>, number] => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateWidth = (): void => {
      setWidth(element.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [ref, width];
};

const tokenActivityStyle = (
  columnCount: number,
  cellSize: number
): CSSProperties => ({
  width: calendarWidth(columnCount, cellSize),
  minWidth: calendarWidth(columnCount, MIN_CELL_SIZE_PX),
});

const monthLabelStyle = (column: number, cellSize: number): CSSProperties => ({
  left: column * (cellSize + CELL_GAP_PX),
});

export const OverviewPanel = ({ history, range }: OverviewPanelProps) => {
  const [activityMode, setActivityMode] =
    useState<TokenActivityMode>("daily");
  const [activityWidthRef, activityWidth] = useElementWidth();

  const view = useMemo(() => {
    const now = new Date();
    const filtered = filterByRange(history, range, now);
    return {
      sessions: sessionCount(filtered),
      messages: messageCount(filtered),
      tokens: totalTokens(filtered),
      days: activeDays(filtered),
      streak: streaks(filtered, now),
      peak: peakHour(filtered),
      favorite: stripModelDate(favoriteModel(filtered)),
      presetWeights: perPresetWeights(filtered),
      presetOverTime: presetCountsOverTime(filtered, range, now),
    };
  }, [history, range]);

  const tokenCalendar = useMemo(
    () => tokenActivityCalendar(history, activityMode, new Date()),
    [activityMode, history]
  );

  const tokenCalendarColumns = useMemo(
    () => calendarColumns(tokenCalendar),
    [tokenCalendar]
  );

  const tokenActivityCellSize = useMemo(
    () => fittedCellSize(activityWidth, tokenCalendar.columns),
    [activityWidth, tokenCalendar.columns]
  );

  const peakValue =
    view.peak === null ? "—" : `${`${view.peak}`.padStart(2, "0")}:00`;

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
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

      {/* Correction preset weight distribution (Chart.js). */}
      {view.presetWeights.length === 0 ? (
        <PresetWeightChart weights={view.presetWeights} overTime={view.presetOverTime} />
      ) : (
        <section className="rounded-lg border border-border bg-card p-4">
          <PresetWeightChart weights={view.presetWeights} overTime={view.presetOverTime} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            Token activity
          </h2>
          <div className="flex items-center gap-5 text-sm">
            {TOKEN_ACTIVITY_TABS.map((tab) => (
              <button
                key={tab.mode}
                type="button"
                aria-pressed={activityMode === tab.mode}
                onClick={() => setActivityMode(tab.mode)}
                className={twJoin(
                  "transition-colors",
                  activityMode === tab.mode
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-card-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={activityWidthRef} className="overflow-x-auto pb-1">
          <div
            key={activityMode}
            className="token-activity-switch flex w-full flex-col gap-3"
            style={tokenActivityStyle(
              tokenCalendar.columns,
              tokenActivityCellSize
            )}
          >
            <div className="flex" style={{ gap: CELL_GAP_PX }}>
              {tokenCalendarColumns.map((column, columnIndex) => (
                <div
                  key={`${activityMode}-${columnIndex}`}
                  className="flex flex-col"
                  style={{ gap: CELL_GAP_PX }}
                >
                  {column.map((cell, rowIndex) => {
                    const tooltip = tooltipForCell(activityMode, cell);
                    return (
                      <div
                        key={`${columnIndex}-${rowIndex}-${cell.date ?? "empty"}`}
                        title={tooltip}
                        aria-label={tooltip}
                        style={{
                          width: tokenActivityCellSize,
                          height: tokenActivityCellSize,
                        }}
                        className={twJoin(
                          heatmapCellClass(heatmapLevelClass(cell.level)),
                          cell.kind === "placeholder" && "opacity-45"
                        )}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            <div
              className="relative h-5 text-sm leading-none text-muted-foreground"
              style={{ width: "100%" }}
            >
              {tokenCalendar.monthLabels.map((label) => (
                <span
                  key={`${label.label}-${label.column}`}
                  className="absolute top-0 whitespace-nowrap"
                  style={monthLabelStyle(
                    label.column,
                    tokenActivityCellSize
                  )}
                >
                  {label.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Benchmark comparison sentence. */}
      <p className="text-sm text-muted-foreground">{benchmarkSentence(view.tokens)}</p>
    </div>
  );
};
