/**
 * @file UsageCharts.tsx
 * @description Chart.js views shared by every Usage provider panel: a daily
 * billed-cost bar, a daily input/output token line, and a cost-share donut.
 * Daily charts show concrete calendar day ticks (not a bare "Day" axis title)
 * plus a y-axis unit title — mirrors ModelsCharts.
 * Presentational — every series arrives pre-aggregated from `usageChartView.ts`.
 *
 * A chart whose data carries no signal renders an explicit empty note instead of
 * flat zeroes: an all-zero cost bar reads as "you spent nothing" when the truth
 * may be "this endpoint reports no prices" (see the MONEY RULE in the OpenAI
 * parsers).
 */
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  costDonutSlices,
  dailyCostSeries,
  dailyTickLabel,
  dailyTokenSeries,
  hasCostData,
  hasTokenData,
  sharePercent,
} from "./usageChartView";
import { useI18n } from "../../i18n/useI18n";
import type { UsageCostSlice, UsageDailyPoint } from "~/shared/usage";

ChartJS.register(
  BarController,
  DoughnutController,
  LineController,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  LineElement,
  PointElement,
  Filler,
  Title,
  Tooltip,
  Legend,
);

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

const CHART_HEIGHT_PX = 260;
const EMBEDDED_CHART_HEIGHT_PX = 180;

/** Resolve a CSS custom property to a color Chart.js can paint. */
const readCssColor = (varName: string, fallback: string): string => {
  if (typeof document === "undefined") return fallback;
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

/** Bump when the theme changes so Chart.js re-reads the CSS color tokens. */
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

const ChartFrame = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-lg border border-card-control-border bg-card p-3">
    <div className="mb-1 text-xs uppercase tracking-wide text-primary">{title}</div>
    {children}
  </div>
);

const EmptyNote = ({ text }: { text: string }) => (
  <div className="py-6 text-center text-sm text-muted-foreground">{text}</div>
);

export const UsageDailyCostChart = ({ points }: { points: UsageDailyPoint[] }) => {
  const paletteTick = useThemePaletteTick();
  const { t, formatDate, formatCurrency } = useI18n();

  const { data, options } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");
    const series = dailyCostSeries(points);

    const chartData: ChartData<"bar"> = {
      labels: series.dates.map((date) => dailyTickLabel(formatDate, date)),
      datasets: [
        {
          label: t("usage.chart.dailyCost.datasetLabel"),
          data: series.costs,
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
            label: (item: TooltipItem<"bar">) =>
              formatCurrency(item.parsed.y ?? 0, "USD"),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            display: true,
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
            text: t("usage.chart.dailyCost.yAxis"),
            color: muted,
            font: { size: 11 },
          },
          ticks: { color: muted },
          grid: { color: border },
          border: { color: border },
        },
      },
    };

    return { data: chartData, options: chartOptions };
    // `t`/`formatDate`/`formatCurrency` are REQUIRED deps: every label and
    // tooltip built here is locale-dependent, and all three change identity only
    // when the locale changes (they come from I18nProvider's own memo).
  }, [points, paletteTick, t, formatDate, formatCurrency]);

  return (
    <ChartFrame title={t("usage.chart.dailyCost.title")}>
      {hasCostData(points) ? (
        <div style={{ height: CHART_HEIGHT_PX }}>
          <Bar data={data} options={options} />
        </div>
      ) : (
        <EmptyNote text={t("usage.chart.dailyCost.empty")} />
      )}
    </ChartFrame>
  );
};

export const UsageDailyTokenChart = ({ points }: { points: UsageDailyPoint[] }) => {
  const paletteTick = useThemePaletteTick();
  const { t, formatDate, formatNumber } = useI18n();

  const { data, options } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");
    const series = dailyTokenSeries(points);

    const chartData: ChartData<"line"> = {
      labels: series.dates.map((date) => dailyTickLabel(formatDate, date)),
      datasets: [
        {
          label: t("usage.chart.dailyTokens.input"),
          data: series.inputTokens,
          borderColor: paletteColor(0, paletteTick),
          backgroundColor: paletteColor(0, paletteTick),
          tension: 0.25,
          pointRadius: 2,
        },
        {
          label: t("usage.chart.dailyTokens.output"),
          data: series.outputTokens,
          borderColor: paletteColor(1, paletteTick),
          backgroundColor: paletteColor(1, paletteTick),
          tension: 0.25,
          pointRadius: 2,
        },
      ],
    };

    const chartOptions: ChartOptions<"line"> = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: foreground, boxWidth: 12, padding: 14 },
        },
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            label: (item: TooltipItem<"line">) =>
              `${item.dataset.label ?? ""}: ${formatNumber(item.parsed.y ?? 0)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            display: true,
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
            text: t("usage.chart.dailyTokens.yAxis"),
            color: muted,
            font: { size: 11 },
          },
          ticks: { color: muted, precision: 0 },
          grid: { color: border },
          border: { color: border },
        },
      },
    };

    return { data: chartData, options: chartOptions };
  }, [points, paletteTick, t, formatDate, formatNumber]);

  return (
    <ChartFrame title={t("usage.chart.dailyTokens.title")}>
      {hasTokenData(points) ? (
        <div style={{ height: CHART_HEIGHT_PX }}>
          <Line data={data} options={options} />
        </div>
      ) : (
        <EmptyNote text={t("usage.chart.dailyTokens.empty")} />
      )}
    </ChartFrame>
  );
};

export const UsageCostShareChart = ({
  slices,
  titleKey,
  embedded = false,
}: {
  slices: UsageCostSlice[];
  /** Providers slice spend differently — by model, billed line item, or project. */
  titleKey:
    | "usage.chart.costShare.byModel"
    | "usage.chart.costShare.byLineItem"
    | "usage.chart.costShare.byProject";
  /** Skip the outer card frame — for charts nested inside another card. */
  embedded?: boolean;
}) => {
  const paletteTick = useThemePaletteTick();
  const { t, formatCurrency, formatNumber } = useI18n();

  const { data, options, hasData } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");

    const { slices: head, remainder } = costDonutSlices(slices);
    const labelled = [
      ...head,
      ...(remainder
        ? [
            {
              label: t("usage.chart.costShare.remainder", {
                count: remainder.count,
              }),
              costUsd: remainder.costUsd,
            },
          ]
        : []),
    ];
    // An unlabelled line item comes back from an ungrouped page; naming it in the
    // legend beats an empty legend entry.
    const displayLabel = (label: string): string =>
      label.trim() === "" ? t("usage.chart.costShare.unlabelled") : label;
    const total = labelled.reduce((sum, slice) => sum + slice.costUsd, 0);

    const chartData: ChartData<"doughnut"> = {
      labels: labelled.map((slice) => displayLabel(slice.label)),
      datasets: [
        {
          label: t(titleKey),
          data: labelled.map((slice) => slice.costUsd),
          backgroundColor: labelled.map((_, index) =>
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
          labels: { color: foreground, boxWidth: 12, padding: 14 },
        },
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            label: (item: TooltipItem<"doughnut">) => {
              const slice = labelled[item.dataIndex];
              if (!slice) return "";
              const pct = formatNumber(sharePercent(slice.costUsd, total), {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              });
              return `${formatCurrency(slice.costUsd, "USD")} · ${pct}%`;
            },
          },
        },
      },
    };

    return {
      data: chartData,
      options: chartOptions,
      hasData: labelled.length > 0,
    };
  }, [slices, titleKey, paletteTick, t, formatCurrency, formatNumber]);

  const chartHeight = embedded ? EMBEDDED_CHART_HEIGHT_PX : CHART_HEIGHT_PX;

  const chartBody = hasData ? (
    <div style={{ height: chartHeight }}>
      <Doughnut data={data} options={options} />
    </div>
  ) : (
    <EmptyNote text={t("usage.chart.costShare.empty")} />
  );

  if (embedded) {
    return chartBody;
  }

  return <ChartFrame title={t(titleKey)}>{chartBody}</ChartFrame>;
};
