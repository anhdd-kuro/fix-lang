/**
 * @file modelsView.ts
 * @description PURE view-layer helpers for the Models dashboard tab,
 * extracted from `ModelsPanel.tsx` (Chunk 8) so the descriptor logic is
 * unit-testable without a DOM testing library (none is installed).
 */
import { msg, type Message, type MessageKey } from "~/shared/i18n/message";
import type { TokenDayBar } from "../MainWindow/modelsAggregations";

/** Parses a dense local-day key ("YYYY-MM-DD") into a local `Date` — never round-trip through the ISO string (a UTC-midnight parse can render as the previous day in a negative-offset timezone). Mirrors `tokenActivityView.ts`'s helper of the same name. */
const dateFromDayKey = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/**
 * Formats a token-volume bar's dense local-day key into the compact display
 * label its tooltip expects, via the locale-aware `formatDate` from
 * `useI18n()`. The renderer must call this (not hand `bar.date` straight to
 * `barTooltipMessage`) — the bar's `date` is a raw `"YYYY-MM-DD"` key, not
 * display-ready.
 */
export const barDateLabel = (
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string,
  dayKey: string,
): string => formatDate(dateFromDayKey(dayKey), { month: "short", day: "numeric" });

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
