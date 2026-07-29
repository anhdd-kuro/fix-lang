/**
 * @file ModelsCharts.tsx
 * @description Chart.js views for the Models tab: a daily token-volume bar
 * (with axis labels + a short caption so the chart is readable without a
 * tooltip) and a per-model share donut that sits above the breakdown table.
 * Presentational — series arrive pre-aggregated from `modelsAggregations.ts`.
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
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  barDateLabel,
  barTooltipMessage,
  donutTooltipMessage,
  MODEL_BREAKDOWN_TITLE_KEY,
  MODEL_USAGE_CHART_KEYS,
} from "./modelsView";
import { useI18n } from "../i18n/useI18n";
import type { ModelRow, TokenDayBar } from "../MainWindow/modelsAggregations";

ChartJS.register(
  BarController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Legend,
  Tooltip,
);

const CHART_COLOR_VARS = [
  "--chart-1",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--success",
  "--warning",
  "--primary",
  "--destructive",
] as const;

const FALLBACK_COLORS = [
  "#6366f1",
  "#ec4899",
  "#14b8a6",
  "#f59e0b",
  "#22c55e",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
] as const;

const BAR_HEIGHT_PX = 220;
const DONUT_HEIGHT_PX = 240;

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
    FALLBACK_COLORS[index % FALLBACK_COLORS.length],
  );
};

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

export const ModelsTokenUsageChart = ({ bars }: { bars: TokenDayBar[] }) => {
  const paletteTick = useThemePaletteTick();
  const { t, tm, formatDate, formatNumber } = useI18n();

  const hasActivity = bars.some((bar) => bar.tokens > 0);

  const { data, options } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");

    const chartData: ChartData<"bar"> = {
      labels: bars.map((bar) => barDateLabel(formatDate, bar.date)),
      datasets: [
        {
          label: t(MODEL_USAGE_CHART_KEYS.datasetLabel),
          data: bars.map((bar) => bar.tokens),
          backgroundColor: paletteColor(0, paletteTick),
          borderRadius: 2,
        },
      ],
    };

    const chartOptions: ChartOptions<"bar"> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            title: () => "",
            label: (item: TooltipItem<"bar">) => {
              const bar = bars[item.dataIndex];
              if (!bar) {
                return "";
              }
              return tm(
                barTooltipMessage(bar, barDateLabel(formatDate, bar.date)),
              );
            },
          },
        },
      },
      scales: {
        x: {
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
          beginAtZero: true,
          title: {
            display: true,
            text: t(MODEL_USAGE_CHART_KEYS.yAxis),
            color: muted,
            font: { size: 11 },
          },
          ticks: {
            color: muted,
            callback: (value) =>
              typeof value === "number" ? formatNumber(value) : String(value),
          },
          grid: { color: border },
          border: { color: border },
        },
      },
    };

    return { data: chartData, options: chartOptions };
  }, [bars, paletteTick, t, tm, formatDate, formatNumber]);

  return (
    <div className="rounded-lg border border-card-control-border bg-card p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {t(MODEL_USAGE_CHART_KEYS.title)}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {t(MODEL_USAGE_CHART_KEYS.description)}
      </p>
      {hasActivity ? (
        <div style={{ height: BAR_HEIGHT_PX }} className="min-w-0">
          <Bar data={data} options={options} />
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("models.usage.empty")}
        </p>
      )}
    </div>
  );
};

export const ModelsBreakdownDonut = ({ rows }: { rows: ModelRow[] }) => {
  const paletteTick = useThemePaletteTick();
  const { t, tl, tm, formatNumber } = useI18n();

  const { data, options } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");

    const percents = rows.map((row) => row.usageSharePct);

    const chartData: ChartData<"doughnut"> = {
      labels: rows.map((row) => tl(row.modelLabel)),
      datasets: [
        {
          label: t("models.breakdown.datasetLabel"),
          data: percents,
          backgroundColor: rows.map((_, index) =>
            paletteColor(index, paletteTick),
          ),
          borderColor: card,
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };

    const chartOptions: ChartOptions<"doughnut"> = {
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
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            label: (item: TooltipItem<"doughnut">) => {
              const row = rows[item.dataIndex];
              if (!row) {
                return "";
              }
              const pctLabel = formatNumber(row.usageSharePct, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              });
              return tm(donutTooltipMessage(row, pctLabel));
            },
          },
        },
      },
    };

    return { data: chartData, options: chartOptions };
  }, [rows, paletteTick, t, tl, tm, formatNumber]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div
      style={{ height: DONUT_HEIGHT_PX }}
      className="mx-auto w-full max-w-md min-w-0"
      aria-label={t(MODEL_BREAKDOWN_TITLE_KEY)}
    >
      <Doughnut data={data} options={options} />
    </div>
  );
};
