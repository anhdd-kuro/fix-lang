/**
 * @file PresetWeightChart.tsx
 * @description Chart.js preset usage charts for the Overview dashboard:
 * a donut for total share (%) and a combo (stacked bars + line) for counts
 * over time. Presentational — receives pre-aggregated rows + time series.
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
  LineController,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Chart, Doughnut } from "react-chartjs-2";
import type {
  PresetCountsOverTime,
  PresetWeightRow,
} from "../MainWindow/overviewAggregations";

ChartJS.register(
  BarController,
  LineController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
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
const COMBO_HEIGHT_PX = 280;
const LINE_COLOR_VAR = "--warning";
const LINE_FALLBACK = "#f59e0b";

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

/** Round weight to one decimal percent (e.g. 0.5 → 50, 1/3 → 33.3). */
const weightPercent = (weight: number): number =>
  Math.round(weight * 1000) / 10;

const formatDayLabel = (dayKey: string): string => {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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

  const { donutData, donutOptions, comboData, comboOptions } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");
    const lineColor = readCssColor(LINE_COLOR_VAR, LINE_FALLBACK);

    const colors = weights.map((_, index) => paletteColor(index, paletteTick));
    const percents = weights.map((row) => weightPercent(row.weight));
    const dayLabels = overTime.days.map(formatDayLabel);

    const doughnutData: ChartData<"doughnut"> = {
      labels: weights.map((row) => row.presetName),
      datasets: [
        {
          label: "Share (%)",
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
          text: "Preset share",
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
              const pct = percents[item.dataIndex]?.toFixed(1) ?? "0.0";
              const countLabel =
                row.count === 1 ? "1 correction" : `${row.count} corrections`;
              return `${pct}% · ${countLabel}`;
            },
          },
        },
      },
    };

    const barDatasets: ChartDataset<"bar">[] = overTime.series.map(
      (series, index) => ({
        type: "bar" as const,
        label: series.presetName,
        data: series.counts,
        backgroundColor: paletteColor(index, paletteTick),
        stack: "presets",
        borderRadius: 2,
        order: 2,
      })
    );

    const lineDataset: ChartDataset<"line"> = {
      type: "line" as const,
      label: "Daily total",
      data: overTime.totalsByDay,
      borderColor: lineColor,
      backgroundColor: lineColor,
      pointBackgroundColor: card,
      pointBorderColor: lineColor,
      pointBorderWidth: 2,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.25,
      fill: false,
      order: 1,
    };

    const comboChartData: ChartData<"bar" | "line"> = {
      labels: dayLabels,
      datasets: [...barDatasets, lineDataset],
    };

    const comboChartOptions: ChartOptions<"bar" | "line"> = {
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
          text: "Corrections over time",
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
            text: "Corrections",
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
      comboData: comboChartData,
      comboOptions: comboChartOptions,
    };
  }, [weights, overTime, paletteTick]);

  if (weights.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No preset usage in this range yet.
      </p>
    );
  }

  const hasActivity = overTime.totalsByDay.some((count) => count > 0);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div style={{ height: DONUT_HEIGHT_PX }} className="min-w-0">
        <Doughnut data={donutData} options={donutOptions} />
      </div>
      <div style={{ height: COMBO_HEIGHT_PX }} className="min-w-0">
        {hasActivity ? (
          <Chart type="bar" data={comboData} options={comboOptions} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No daily corrections in this range yet.
          </div>
        )}
      </div>
    </div>
  );
};
