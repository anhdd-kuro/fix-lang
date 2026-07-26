/**
 * @file presetChartView.ts
 * @description PURE view-layer helpers for the Overview preset donut +
 * corrections-over-time stacked-bar chart, extracted from `PresetWeightChart.tsx`
 * (Chunk 8) so the descriptor logic is unit-testable without a DOM testing
 * library (none is installed).
 */
import { msg, type Message, type MessageKey } from "~/shared/i18n/message";
import type { PresetWeightRow } from "../MainWindow/overviewAggregations";

/** Chart title keys — resolved via `t()` at render time. */
export const CHART_TITLE_KEYS = {
  presetShare: "charts.presetShare.title",
  correctionsOverTime: "charts.correctionsOverTime.title",
} as const satisfies Record<string, MessageKey>;

/** Round weight to one decimal percent (e.g. 0.5 → 50, 1/3 → 33.3). Moved unchanged from `PresetWeightChart.tsx`. */
export const weightPercent = (weight: number): number => Math.round(weight * 1000) / 10;

/**
 * Donut tooltip descriptor: `{pct}% · {count} correction(s)`. `pctLabel` is a
 * pre-formatted, fixed-decimal string built by the renderer (via
 * `formatNumber`) — it must not be re-grouped, so it flows in as a `string`
 * param, never a `number`. `count` stays a raw `number` so plural selection
 * works.
 */
export const donutTooltipMessage = (
  row: Pick<PresetWeightRow, "count">,
  pctLabel: string,
): Message => msg("charts.presetShare.tooltip", { pct: pctLabel, count: row.count });
