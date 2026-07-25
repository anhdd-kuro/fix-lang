/**
 * @file tokenActivityView.ts
 * @description PURE view-layer helpers for the Overview token-activity
 * calendar, extracted from `OverviewPanel.tsx` (Chunk 8) so the
 * message-descriptor logic is unit-testable without a DOM testing library
 * (none is installed — see `docs/spec.i18n-dashboard.md` §5.3 trap 5).
 *
 * Every export here returns a `Message`/plain-data descriptor, never a
 * formatted string — `tooltipMessageForCell` takes a `fmt.date` callback
 * (not a locale) so it stays as pure as the aggregation layer it sits next to.
 */
import { msg, type Message, type MessageKey } from "~/shared/i18n/message";
import type {
  TokenActivityCalendarCell,
  TokenActivityMode,
} from "../MainWindow/overviewAggregations";

/** Ordered token-activity mode tabs — label resolved via `t(labelKey)` at render time. */
export const TOKEN_ACTIVITY_TABS: readonly {
  labelKey: MessageKey;
  mode: TokenActivityMode;
}[] = [
  { labelKey: "overview.tokenActivity.mode.daily", mode: "daily" },
  { labelKey: "overview.tokenActivity.mode.weekly", mode: "weekly" },
  { labelKey: "overview.tokenActivity.mode.cumulative", mode: "cumulative" },
] as const;

/** Translation keys for the 8 Overview summary stat cards, in display order. */
export const STAT_CARD_KEYS = {
  sessions: "overview.stat.sessions",
  messages: "overview.stat.messages",
  totalTokens: "overview.stat.totalTokens",
  activeDays: "overview.stat.activeDays",
  currentStreak: "overview.stat.currentStreak",
  longestStreak: "overview.stat.longestStreak",
  peakHour: "overview.stat.peakHour",
  favoriteModel: "overview.stat.favoriteModel",
} as const satisfies Record<string, MessageKey>;

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

/**
 * Sunday-start week window (as day keys, YYYY-MM-DD) containing `dayKey`.
 * Locale-free — the renderer formats `start`/`end` via `fmt.date` before
 * interpolating them into a `Message`.
 */
export const weeklyRangeOf = (dayKey: string): { start: string; end: string } => {
  const day = dateFromDayKey(dayKey);
  const start = addDays(day, -day.getDay());
  const end = addDays(start, 6);
  return { start: dayKeyOfDate(start), end: dayKeyOfDate(end) };
};

/** Formats a day key (YYYY-MM-DD) into a display string — supplied by the renderer via `formatDate`. */
export type DayKeyFormatter = { date: (dayKey: string) => string };

/**
 * Builds the real `DayKeyFormatter` the renderer should pass to
 * `tooltipMessageForCell`: formats a day key via the locale-aware `formatDate`
 * from `useI18n()`, using a compact form appropriate for a dense
 * per-cell calendar tooltip.
 *
 * Parses the day key as a **local** calendar date (`dateFromDayKey`, i.e.
 * `new Date(year, month - 1, day)`) rather than handing the raw
 * `"YYYY-MM-DD"` string to `formatDate`/`new Date()` directly — the latter
 * parses as UTC midnight and can render as the *previous* calendar day once
 * formatted in a negative-UTC-offset timezone (see
 * `tokenActivityView.test.ts`'s timezone-hazard case).
 */
export const dayKeyDateFormatter = (
  formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string,
): DayKeyFormatter => ({
  date: (dayKey) => formatDate(dateFromDayKey(dayKey), { month: "short", day: "numeric" }),
});

/**
 * Tooltip descriptor for one token-activity calendar cell. `undefined` for a
 * leading placeholder cell (nothing to show). `count` is always passed as a
 * raw `number` so plural selection (`withCorrections_one`/`_other`) works.
 */
export const tooltipMessageForCell = (
  mode: TokenActivityMode,
  cell: TokenActivityCalendarCell,
  fmt: DayKeyFormatter,
): Message | undefined => {
  if (cell.kind === "placeholder") {
    return undefined;
  }

  const tokens = cell.tokenTotal;
  const count = cell.correctionCount;

  if (mode === "daily") {
    const date = fmt.date(cell.date);
    return count > 0
      ? msg("overview.tokenActivity.tooltip.daily.withCorrections", { tokens, date, count })
      : msg("overview.tokenActivity.tooltip.daily", { tokens, date });
  }

  if (mode === "weekly") {
    const { start, end } = weeklyRangeOf(cell.date);
    const startLabel = fmt.date(start);
    const endLabel = fmt.date(end);
    return count > 0
      ? msg("overview.tokenActivity.tooltip.weekly.withCorrections", {
          tokens,
          start: startLabel,
          end: endLabel,
          count,
        })
      : msg("overview.tokenActivity.tooltip.weekly", {
          tokens,
          start: startLabel,
          end: endLabel,
        });
  }

  // cumulative
  const date = fmt.date(cell.date);
  return count > 0
    ? msg("overview.tokenActivity.tooltip.cumulative.withCorrections", { tokens, date, count })
    : msg("overview.tokenActivity.tooltip.cumulative", { tokens, date });
};

/**
 * Descriptor for the "Peak hour" stat card value: `null` → the empty-value
 * chrome; otherwise a zero-padded `"HH:00"` string param (must not be
 * grouped, so it is built here as a `string`, not a `number`).
 */
export const peakHourMessage = (hour: number | null): Message =>
  hour === null
    ? msg("overview.value.empty")
    : msg("overview.value.hour", { hour: `${hour}`.padStart(2, "0") });
