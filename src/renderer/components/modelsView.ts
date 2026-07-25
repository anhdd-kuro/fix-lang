/**
 * @file modelsView.ts
 * @description PURE view-layer helpers for the Models dashboard tab,
 * extracted from `ModelsPanel.tsx` (Chunk 8) so the descriptor logic is
 * unit-testable without a DOM testing library (none is installed).
 */
import { msg, type Message, type MessageKey } from "~/shared/i18n/message";
import type { TokenDayBar } from "../MainWindow/modelsAggregations";

/** Model table column header keys — resolved via `t()` at render time. */
export const MODEL_TABLE_HEADER_KEYS = {
  model: "models.table.model",
  input: "models.table.input",
  output: "models.table.output",
  usage: "models.table.usage",
} as const satisfies Record<string, MessageKey>;

/**
 * Token-volume bar tooltip descriptor: `"{date} — {tokens} tokens"`.
 * `dateLabel` is a pre-formatted string built by the renderer (the bar's
 * `date` is a dense local-day key, not display-ready on its own) so it flows
 * in as a `string` param; `tokens` stays a raw `number` for locale grouping.
 */
export const barTooltipMessage = (
  bar: Pick<TokenDayBar, "tokens">,
  dateLabel: string,
): Message => msg("models.usage.barTooltip", { date: dateLabel, tokens: bar.tokens });

/**
 * "Show less" / "Show {count} more" toggle descriptor. Not a plural family —
 * `expanded` picks between two unrelated keys, `hiddenCount` is a plain
 * interpolated total, never pluralized.
 */
export const showMoreMessage = (expanded: boolean, hiddenCount: number): Message =>
  expanded ? msg("models.table.showLess") : msg("models.table.showMore", { count: hiddenCount });
