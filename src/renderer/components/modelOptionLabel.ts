/**
 * @file modelOptionLabel.ts
 * @description Pure builder for the human-readable label shown for one model
 * option in `ModelSelect.tsx`'s dropdown. Extracted out of the component's
 * `useMemo` so it is unit-testable without React (Vitest only collects
 * `.test.ts`, and `@testing-library/react` is not installed).
 *
 * JA and EN order the created-date/price/size clauses differently, so each
 * locale gets its own full template (`models.select.optionLabel.local` /
 * `.cloud`) rather than string-concatenating locale-agnostic fragments.
 *
 * CONTRACT: `ModelSelect.tsx`'s custom `Option` renderer re-parses the string
 * this function returns via `label.split(",")` to lay out the id/date/badge
 * as separate chips. That means every `models.select.optionLabel.local` /
 * `.cloud` catalog value, in every locale, MUST contain exactly two literal
 * ASCII commas (`,`) — never a fullwidth `、` — or the split silently
 * collapses to one part and the option renders as a single unstyled line
 * with no date/price badge. `modelOptionLabel.test.ts` asserts this contract
 * against every catalog so a translator "fixing" the punctuation, or a new
 * locale, fails CI instead of failing silently in the UI.
 */
import { format as formatDateFns } from "date-fns";
import type { Locale as DateFnsLocale } from "date-fns/locale";
import type { Translator } from "~/shared/i18n/translate";
import type { Model } from "~/stores/apiStore";

export type ModelOptionLabelDeps = {
  t: Translator;
  /** From `useI18n()` — already bound to the active locale/currency shape. */
  formatCurrency: (value: number, currency?: string) => string;
  /** From `useI18n()` — passed explicitly to every `date-fns` `format()` call. */
  dateFnsLocale: DateFnsLocale;
};

/** Subset of `Model` the label builder actually reads. */
export type ModelForLabel = Pick<Model, "id" | "created" | "local" | "pricing">;

/**
 * Handles both Unix-seconds and Unix-milliseconds timestamps. Seconds
 * timestamps have ~10 digits until year 2286; milliseconds have 13.
 */
const normalizeTimestamp = (timestamp: number): number => {
  const isLikelySeconds = Math.floor(Math.log10(timestamp) + 1) <= 10;
  return isLikelySeconds ? timestamp * 1000 : timestamp;
};

/**
 * Builds the localized option label for one model: local models show a size
 * (or a generic "Local LLM" badge when size is unknown), cloud models show
 * the per-million-token price.
 */
export const buildModelOptionLabel = (
  model: ModelForLabel,
  deps: ModelOptionLabelDeps,
): string => {
  const { t, formatCurrency, dateFnsLocale } = deps;
  const createdAt = formatDateFns(
    new Date(normalizeTimestamp(model.created)),
    "yyyy-MM-dd",
    { locale: dateFnsLocale },
  );
  const isLocalModel = model.local !== undefined;

  if (isLocalModel) {
    const size = model.local?.size ? `${model.local.size}B` : t("models.select.localLlm");
    return t("models.select.optionLabel.local", { id: model.id, createdAt, size });
  }

  const pricePerMillionTokens = formatCurrency(
    +(model.pricing?.prompt || 0) * 1_000_000,
    "USD",
  );
  return t("models.select.optionLabel.cloud", {
    id: model.id,
    createdAt,
    price: pricePerMillionTokens,
  });
};
