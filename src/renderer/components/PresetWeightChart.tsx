/**
 * @file PresetWeightChart.tsx
 * @description Chart.js preset usage charts for the Overview dashboard:
 * a donut for total share (%) and stacked bars for counts over time.
 * Presentational — receives pre-aggregated rows + time series.
 */
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Legend,
  LinearScale,
  Title,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import { CHART_TITLE_KEYS, donutTooltipMessage, weightPercent } from "./presetChartView";
import { useI18n } from "../i18n/useI18n";
import type {
  PresetCountsOverTime,
  PresetWeightRow,
} from "../MainWindow/overviewAggregations";

ChartJS.register(
  BarController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

type PresetWeightChartProps = {
  /** Preset rows with relative weights (sum ≈ 1 when non-empty). */
  weights: PresetWeightRow[];
  /** Per-preset counts aligned to local days in the active range. */
  overTime: PresetCountsOverTime;
};

/** Theme chart tokens — cycles by preset rank (matches ModelsPanel markers). */
const CHART_COLOR_VARS = [
  "--chart-1",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-2",
] as const;

const FALLBACK_COLORS = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
] as const;

const DONUT_HEIGHT_PX = 280;
const OVER_TIME_HEIGHT_PX = 280;

/**
 * Resolve a CSS custom property to a concrete color Chart.js can paint.
 * Falls back when the variable is unset (SSR / missing theme).
 */
const readCssColor = (varName: string, fallback: string): string => {
  if (typeof document === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value.length > 0 ? value : fallback;
};

const paletteColor = (index: number, paletteTick: number): string => {
  void paletteTick;
  return readCssColor(
    CHART_COLOR_VARS[index % CHART_COLOR_VARS.length],
    FALLBACK_COLORS[index % FALLBACK_COLORS.length]
  );
};

/** Parses a dense local-day key ("YYYY-MM-DD") into a local `Date` — never round-trip through the ISO string (see spec.i18n-dashboard.md §5.3 trap 7). */
const dateFromDayKey = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/**
 * Bump when the active theme changes so Chart.js re-reads CSS color tokens.
 * Avoids a second `useTheme()` IPC subscription (App already owns that).
 */
const useThemePaletteTick = (): number => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const removeListener = window.electronAPI.onThemeChanged(() => {
      setTick((current) => current + 1);
    });
    return removeListener;
  }, []);

  return tick;
};

export const PresetWeightChart = ({
  weights,
  overTime,
}: PresetWeightChartProps) => {
  const paletteTick = useThemePaletteTick();
  const { t, tl, tm, formatDate, formatNumber } = useI18n();

  const { donutData, donutOptions, overTimeData, overTimeOptions } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");

    const colors = weights.map((_, index) => paletteColor(index, paletteTick));
    const percents = weights.map((row) => weightPercent(row.weight));
    const dayLabels = overTime.days.map((dayKey) =>
      formatDate(dateFromDayKey(dayKey), { month: "short", day: "numeric" })
    );

    const doughnutData: ChartData<"doughnut"> = {
      labels: weights.map((row) => tl(row.presetLabel)),
      datasets: [
        {
          label: t("charts.presetShare.datasetLabel"),
          data: percents,
          backgroundColor: colors,
          borderColor: card,
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };

    const doughnutOptions: ChartOptions<"doughnut"> = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: foreground,
            boxWidth: 12,
            padding: 14,
          },
        },
        title: {
          display: true,
          text: t(CHART_TITLE_KEYS.presetShare),
          color: foreground,
          font: { size: 14, weight: 600 },
          padding: { bottom: 8 },
        },
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            label: (item: TooltipItem<"doughnut">) => {
              const row = weights[item.dataIndex];
              if (!row) {
                return "";
              }
              const pct = percents[item.dataIndex] ?? 0;
              const pctLabel = formatNumber(pct, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              });
              return tm(donutTooltipMessage(row, pctLabel));
            },
          },
        },
      },
    };

    const barDatasets: ChartDataset<"bar">[] = overTime.series.map(
      (series, index) => ({
        label: tl(series.presetLabel),
        data: series.counts,
        backgroundColor: paletteColor(index, paletteTick),
        stack: "presets",
        borderRadius: 2,
      })
    );

    const overTimeChartData: ChartData<"bar"> = {
      labels: dayLabels,
      datasets: barDatasets,
    };

    const overTimeChartOptions: ChartOptions<"bar"> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: foreground,
            boxWidth: 12,
            padding: 14,
          },
        },
        title: {
          display: true,
          text: t(CHART_TITLE_KEYS.correctionsOverTime),
          color: foreground,
          font: { size: 14, weight: 600 },
          padding: { bottom: 8 },
        },
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            footer: (items: TooltipItem<"bar">[]) => {
              const total = items.reduce(
                (sum, item) => sum + (item.parsed.y ?? 0),
                0
              );
              return t("charts.correctionsOverTime.tooltipTotal", {
                count: total,
              });
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
          },
          grid: { display: false },
          border: { color: border },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: t("charts.correctionsOverTime.yAxis"),
            color: muted,
            font: { size: 11 },
          },
          ticks: {
            color: muted,
            precision: 0,
          },
          grid: { color: border },
          border: { color: border },
        },
      },
    };

    return {
      donutData: doughnutData,
      donutOptions: doughnutOptions,
      overTimeData: overTimeChartData,
      overTimeOptions: overTimeChartOptions,
    };
    // `t`/`tl`/`tm`/`formatDate`/`formatNumber` are REQUIRED dependencies
    // here, not an oversight: every label, title, axis title, and tooltip
    // callback built in this memo is now locale-dependent text, and all five
    // are guaranteed to change identity ONLY when the locale changes — never
    // on an unrelated re-render. `t`/`formatDate`/`formatNumber` come
    // straight from `I18nProvider`'s own `useMemo` (keyed on
    // `[state.locale, setLocale]`); `tl`/`tm` are `useCallback`s inside
    // `useI18n()` keyed on that same stable context, and `useI18n()` wraps
    // its whole return value in `useMemo` too, so none of the five is a
    // fresh closure on every render (see `useI18n.ts`). Omitting them would
    // pin the whole chart to whatever language was active when it first
    // mounted — switching the app language would leave every legend/title/
    // tooltip stuck in the old language until `weights`/`overTime` next
    // changed. See spec.i18n-dashboard.md §5.3 trap 2 (the single biggest
    // risk in this chunk) — `paletteTick` already exists in this array for
    // the exact same reason (theme changes with no data change). Because all
    // five are locale-stable, this memo only actually rebuilds on a real
    // locale/theme/data change — an unrelated re-render (e.g. a
    // `ResizeObserver` tick from `useElementWidth` elsewhere in the tree)
    // does NOT rebuild it.
  }, [weights, overTime, paletteTick, t, tl, tm, formatDate, formatNumber]);

  if (weights.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("charts.presetShare.empty")}
      </p>
    );
  }

  const hasActivity = overTime.totalsByDay.some((count) => count > 0);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div style={{ height: DONUT_HEIGHT_PX }} className="min-w-0">
        <Doughnut data={donutData} options={donutOptions} />
      </div>
      <div style={{ height: OVER_TIME_HEIGHT_PX }} className="min-w-0">
        {hasActivity ? (
          <Bar data={overTimeData} options={overTimeOptions} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("charts.correctionsOverTime.empty")}
          </div>
        )}
      </div>
    </div>
  );
};
