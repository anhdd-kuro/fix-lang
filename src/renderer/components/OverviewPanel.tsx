/**
 * @file OverviewPanel.tsx
 * @description Overview dashboard tab. Presentational: receives the
 * already-fetched corrections `history` (owned + live-updated by App) and the
 * active range (lifted to the shared dashboard header), then renders a grid of
 * summary stat cards, Chart.js preset donut + stacked-bar time-series charts, and a Codex-style
 * token activity calendar — all from the PURE aggregators in overviewAggregations.ts.
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
import { SegmentedControl } from "./SegmentedControl";
import { StatCard } from "./StatCard";
import {
  dayKeyDateFormatter,
  peakHourMessage,
  STAT_CARD_KEYS,
  TOKEN_ACTIVITY_TABS,
  tooltipMessageForCell,
} from "./tokenActivityView";
import { filterByRange, type AnalyticsRange } from "../analytics/shared";
import { useI18n } from "../i18n/useI18n";
import {
  activeDays,
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
  const { t, tm, formatNumber, formatDate } = useI18n();
  const [activityMode, setActivityMode] =
    useState<TokenActivityMode>("daily");
  const [activityWidthRef, activityWidth] = useElementWidth();

  // Aggregation memo stays STRING-FREE (descriptors + raw data only) — see
  // spec.i18n-dashboard.md §5.3 trap 2. Descriptors are resolved during
  // render below, never inside this `useMemo`, so a locale switch is visible
  // immediately without needing `t`/`locale` in this dependency array.
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

  const peakValue = tm(peakHourMessage(view.peak));

  // Rebuilt every render (cheap — a single closure over `formatDate`), never
  // memoized: it is only ever read directly inside the JSX map below, never
  // stashed in a `useMemo`/`useCallback` dependency array, so there is no
  // stale-locale risk to guard against here (contrast `PresetWeightChart`'s
  // chart-options memo, which DOES need `formatDate` in its deps because it
  // caches the built value across renders).
  const dayFmt = dayKeyDateFormatter(formatDate);

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t(STAT_CARD_KEYS.sessions)} value={formatNumber(view.sessions)} />
        <StatCard label={t(STAT_CARD_KEYS.messages)} value={formatNumber(view.messages)} />
        <StatCard label={t(STAT_CARD_KEYS.totalTokens)} value={formatNumber(view.tokens)} />
        <StatCard label={t(STAT_CARD_KEYS.activeDays)} value={formatNumber(view.days)} />
        <StatCard
          label={t(STAT_CARD_KEYS.currentStreak)}
          value={t("overview.value.days", { count: view.streak.current })}
        />
        <StatCard
          label={t(STAT_CARD_KEYS.longestStreak)}
          value={t("overview.value.days", { count: view.streak.longest })}
        />
        <StatCard label={t(STAT_CARD_KEYS.peakHour)} value={peakValue} />
        <StatCard
          label={t(STAT_CARD_KEYS.favoriteModel)}
          value={view.favorite ?? t("overview.value.empty")}
        />
      </div>

      {/* Correction preset weight distribution (Chart.js). */}
      {view.presetWeights.length === 0 ? (
        <PresetWeightChart weights={view.presetWeights} overTime={view.presetOverTime} />
      ) : (
        <section className="rounded-lg border border-card-control-border bg-card p-4">
          <PresetWeightChart weights={view.presetWeights} overTime={view.presetOverTime} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            {t("overview.tokenActivity.title")}
          </h2>
          <SegmentedControl
            value={activityMode}
            onChange={setActivityMode}
            ariaLabel={t("overview.tokenActivity.mode.ariaLabel")}
            options={TOKEN_ACTIVITY_TABS.map((tab) => ({
              value: tab.mode,
              label: t(tab.labelKey),
            }))}
          />
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
                    // Resolve once per cell — never call `tm()` twice for the
                    // same value (spec.i18n-dashboard.md §5.3 trap 10).
                    const tooltipMessage = tooltipMessageForCell(
                      activityMode,
                      cell,
                      dayFmt
                    );
                    const tooltipText = tooltipMessage
                      ? tm(tooltipMessage)
                      : undefined;
                    return (
                      <div
                        key={`${columnIndex}-${rowIndex}-${cell.date ?? "empty"}`}
                        title={tooltipText}
                        aria-label={tooltipText}
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
                  key={`${label.key}-${label.column}`}
                  className="absolute top-0 whitespace-nowrap"
                  style={monthLabelStyle(
                    label.column,
                    tokenActivityCellSize
                  )}
                >
                  {t(label.key)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
