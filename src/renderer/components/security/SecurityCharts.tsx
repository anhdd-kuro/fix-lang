/**
 * @file SecurityCharts.tsx
 * @description Chart.js views for the Security dashboard tab: secret-guard
 * and selection-guard donuts, plus a horizontal bar of matched detectors.
 * Presentational — slices arrive from `securityStatsView.ts`. Chart.js
 * canvases are stubbed in `SecurityStatsPanel.test.ts` (jsdom has no canvas
 * 2D context).
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
  SECURITY_CHART_KEYS,
  joinChartAriaSummary,
  securityChartAriaLabel,
  securityChartBarTooltip,
  securityChartDonutTooltip,
  securityChartNamedSlice,
  type SecurityRuleRow,
  type SecurityStatCard,
} from "./securityStatsView";
import { useI18n } from "../../i18n/useI18n";

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

const DONUT_HEIGHT_PX = 240;
const BAR_HEIGHT_PX = 220;

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

const percentLabel = (value: number, total: number, formatNumber: (n: number) => string): string => {
  if (total <= 0) {
    return formatNumber(0);
  }
  return formatNumber(Math.round((value / total) * 1000) / 10);
};

type SecurityChartsProps = {
  secretCards: readonly SecurityStatCard[];
  selectionCards: readonly SecurityStatCard[];
};

export const SecurityCharts = ({
  secretCards,
  selectionCards,
}: SecurityChartsProps) => (
  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
    <GuardMixDonut
      cards={secretCards}
      titleKey={SECURITY_CHART_KEYS.secretTitle}
      datasetKey={SECURITY_CHART_KEYS.secretDataset}
      emptyKey={SECURITY_CHART_KEYS.secretEmpty}
    />
    <GuardMixDonut
      cards={selectionCards}
      titleKey={SECURITY_CHART_KEYS.selectionTitle}
      datasetKey={SECURITY_CHART_KEYS.selectionDataset}
      emptyKey={SECURITY_CHART_KEYS.selectionEmpty}
    />
  </div>
);
type GuardMixDonutProps = {
  cards: readonly SecurityStatCard[];
  titleKey: (typeof SECURITY_CHART_KEYS)[keyof typeof SECURITY_CHART_KEYS];
  datasetKey: (typeof SECURITY_CHART_KEYS)[keyof typeof SECURITY_CHART_KEYS];
  emptyKey: (typeof SECURITY_CHART_KEYS)[keyof typeof SECURITY_CHART_KEYS];
};

const GuardMixDonut = ({
  cards,
  titleKey,
  datasetKey,
  emptyKey,
}: GuardMixDonutProps) => {
  const paletteTick = useThemePaletteTick();
  const { t, tm, formatNumber } = useI18n();

  const { data, options, slices } = useMemo(() => {
    const active = cards.filter((card) => card.value > 0);
    const total = active.reduce((sum, card) => sum + card.value, 0);
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");

    const chartData: ChartData<"doughnut"> = {
      labels: active.map((slice) => t(slice.labelKey)),
      datasets: [
        {
          label: t(datasetKey),
          data: active.map((slice) => slice.value),
          backgroundColor: active.map((_, index) => paletteColor(index, paletteTick)),
          borderColor: card,
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };

    const chartOptions: ChartOptions<"doughnut"> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: muted, boxWidth: 10, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: card,
          titleColor: foreground,
          bodyColor: muted,
          borderColor: border,
          borderWidth: 1,
          callbacks: {
            label: (item: TooltipItem<"doughnut">) => {
              const slice = active[item.dataIndex];
              if (!slice) {
                return "";
              }
              return tm(
                securityChartDonutTooltip(
                  slice.value,
                  percentLabel(slice.value, total, formatNumber),
                ),
              );
            },
          },
        },
      },
    };

    return { data: chartData, options: chartOptions, slices: active };
  }, [cards, paletteTick, t, tm, formatNumber, datasetKey]);

  const total = slices.reduce((sum, card) => sum + card.value, 0);
  const ariaLabel = tm(
    securityChartAriaLabel(
      t(titleKey),
      joinChartAriaSummary(
        slices.map((slice) =>
          tm(
            securityChartNamedSlice(
              t(slice.labelKey),
              tm(
                securityChartDonutTooltip(
                  slice.value,
                  percentLabel(slice.value, total, formatNumber),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  return (
    <div className="rounded-lg border border-card-control-border bg-card p-4">
      <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
        {t(titleKey)}
      </div>
      {slices.length > 0 ? (
        <div style={{ height: DONUT_HEIGHT_PX }} className="min-w-0">
          <Doughnut data={data} options={options} aria-label={ariaLabel} />
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">{t(emptyKey)}</p>
      )}
    </div>
  );
};

export const SecurityRulesBar = ({ rows }: { rows: readonly SecurityRuleRow[] }) => {
  const paletteTick = useThemePaletteTick();
  const { t, tm, formatNumber } = useI18n();

  const { data, options } = useMemo(() => {
    const foreground = readCssColor("--foreground", "#18181b");
    const muted = readCssColor("--muted-foreground", "#71717a");
    const border = readCssColor("--border", "#e4e4e7");
    const card = readCssColor("--card", "#ffffff");

    const labels = rows.map((row) => (row.labelKey === null ? row.ruleId : t(row.labelKey)));

    const chartData: ChartData<"bar"> = {
      labels,
      datasets: [
        {
          label: t(SECURITY_CHART_KEYS.rulesDataset),
          data: rows.map((row) => row.count),
          backgroundColor: paletteColor(0, paletteTick),
          borderRadius: 2,
        },
      ],
    };

    const chartOptions: ChartOptions<"bar"> = {
      indexAxis: "y",
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
            label: (item: TooltipItem<"bar">) => {
              const row = rows[item.dataIndex];
              if (!row) {
                return "";
              }
              return tm(securityChartBarTooltip(row.count));
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: t(SECURITY_CHART_KEYS.yAxis),
            color: muted,
            font: { size: 11 },
          },
          ticks: {
            color: muted,
            precision: 0,
            callback: (value) =>
              typeof value === "number" ? formatNumber(value) : String(value),
          },
          grid: { color: border },
          border: { color: border },
        },
        y: {
          ticks: { color: muted },
          grid: { display: false },
          border: { color: border },
        },
      },
    };

    return { data: chartData, options: chartOptions };
  }, [rows, paletteTick, t, tm, formatNumber]);

  const ariaLabel = tm(
    securityChartAriaLabel(
      t(SECURITY_CHART_KEYS.rulesTitle),
      joinChartAriaSummary(
        rows.map((row) =>
          tm(
            securityChartNamedSlice(
              row.labelKey === null ? row.ruleId : t(row.labelKey),
              tm(securityChartBarTooltip(row.count)),
            ),
          ),
        ),
      ),
    ),
  );

  return (
    <div
      style={{ height: Math.max(BAR_HEIGHT_PX, rows.length * 36) }}
      className="min-w-0"
    >
      <Bar data={data} options={options} aria-label={ariaLabel} />
    </div>
  );
};
