---
name: fixlang-i18n
description: "Use when adding translatable strings, migrating existing English text to use t(), or editing the i18n infrastructure. Covers src/shared/i18n/, src/main/i18n.ts, locale IPC transport, and renderer I18nProvider. Examples: \"add a translation string\", \"why did the interface stay in English after switching languages\", \"migrate the tray window to use translations\"."
---

# FixLang — i18n Traps

Code: `src/shared/i18n/` (catalogs, registry, translate, format, message, keys), `src/main/i18n.ts`, `src/stores/localeStore.ts`, `src/main/ipc/features/locale.ts`, `src/preload/features/locale.ts`, `src/renderer/i18n/` (I18nProvider, useI18n, localeState), `src/shared/i18n/locales/{en,ja}/*.json` (catalogs).

## Type-checked keys, untyped placeholders

JSON string **values** widen to `string` in TypeScript, so placeholder names inside `{token}` brackets are **not type-checked**. A missing `{expectedToken}` in a call site or a typo in the JSON value both compile clean; the interpolation silently leaves the unreplaced text in the output at runtime (e.g., `"Hello {userName}"` → `"Hello {userName}"` if `userName` param is missing).

**Guard:** Parity tests in `src/shared/i18n/dashboardKeys.test.ts` assert that placeholder names match across English and Japanese for every key. If you add a new key, add a test case.

## Tests are `.test.ts`, not `.test.tsx`

`@testing-library/react` is **not** installed, so component rendering in tests will fail. Vitest collects `src/**/*.test.{ts,js}` only, not `.tsx`. For components that call `useI18n()`:

1. Extract the locale-independent logic into a sibling `.ts` file
2. Unit-test the `.ts` file directly (import `createTranslator` from `~/shared/i18n/translate`)
3. Keep the `.tsx` file thin — just UI wiring and `useI18n()` calls

**Example** — `OverviewPanel.tsx` calls `useI18n()` and passes result to a view module:

```ts
// tokenActivityView.ts (pure, testable)
export const tooltipMessageForCell = (mode, cell, fmt): Message | undefined => { … }
```

```tsx
// OverviewPanel.tsx (thin, not tested in component)
const { tm } = useI18n();
const msg = tooltipMessageForCell(…);
return <div title={tm(msg)} />;
```

## Aggregations return descriptors, never prose

The aggregation layer (`overviewAggregations.ts`, `modelsAggregations.ts`) **must** return `Message` / `Label` descriptors, **never** prose strings or formatted numbers. Turning a descriptor into a display string is the **renderer's** job, via `tm()` or `tl()` on `useI18n()`.

**Violates the rule:**
```ts
export const benchmarkSentence = (tokens: number): string =>
  tokens > 100_000 ? "Over budget" : "OK";
```

**Correct:**
```ts
export const benchmarkMessage = (tokens: number): Message =>
  tokens > 100_000 ? msg("overview.benchmark.overBudget") : msg("overview.benchmark.ok");
```

Descriptors stay locale-free; the renderer provides `t()` at render time.

## Memoized strings stale after locale switch

Any `useMemo()` or `useCallback()` that **closes over** `t()` or a formatter (`formatDate`, `formatNumber`, etc.) must list them in the dependency array. Otherwise, switching language leaves the old translations in the memoized value until something in the deps actually changes.

**Silent failure:**
```tsx
const memoChart = useMemo(() => ({
  title: t("charts.title"),  // "Transforms over time"
  axis: t("charts.axis"),    // "Transforms"
}), [weights, overTime]);    // ← No t() in deps; memo never rebuilds after locale switch
```

**Correct:**
```tsx
const memoChart = useMemo(() => ({
  title: t("charts.title"),
  axis: t("charts.axis"),
}), [weights, overTime, t]);  // ← Add t to deps (and any other formatters used inside)
```

**Safer:** Keep memos **string-free** (only raw data); resolve strings during render, outside the memo:
```tsx
const memoChart = useMemo(() => ({
  data: weights,
}), [weights, overTime]);

// Render-time resolution (no memo):
const title = t("charts.title");
const axis = t("charts.axis");
return <Chart title={title} axis={axis} data={memoChart.data} />;
```

## date-fns needs explicit locale

`date-fns` defaults to English for any text token (day/month names, relative terms). Pass the locale explicitly:

```tsx
import { format } from "date-fns";
import { useI18n } from "~/renderer/i18n/useI18n";

const { locale, dateFnsLocale } = useI18n();
// Without { locale: dateFnsLocale }, this renders English month names in a JA UI:
const label = format(date, "MMM d", { locale: dateFnsLocale });
```

**Exception:** `useFuzzySearch.ts` is **deliberately locale-free** — the search haystack (e.g., preset names, model ids) is user data, not UI. Localizing it changes fuzzy-match behavior per language. Leave it as-is.

## Main process uses mainT(), not useI18n()

The main process has no React context, so it cannot call `useI18n()`. Use `mainT()` from `~/main/i18n.ts` instead:

```ts
// WRONG — will throw/fail in main:
import { useI18n } from "~/renderer/i18n/useI18n";
const { t } = useI18n();  // ← No React context in main!

// CORRECT:
import { mainT } from "~/main/i18n";
new Notification({
  title: mainT("notification.title"),
  body: mainT("notification.body", { name: profile.name }),
}).show();
```

`mainT()` is sync and reads the active locale on every call (via `localeStore.getLocale()`). Formatters are accessed via `mainFormatters()`.

## Japanese only has the `other` plural category

English defines both `_one` and `_other` variants for plural keys (e.g., `"history.count_one"` and `"history.count_other"`). Japanese **only** defines `_other` — `Intl.PluralRules("ja").select(n)` always returns `"other"`, even for count 1.

**In JSON catalogs:**
```json
// en/history.json
{ "history.count_one": "{count} transform", "history.count_other": "{count} transforms" }

// ja/history.json
{ "history.count_other": "{count} 件の校正" }
```

The `_one` key is intentionally absent from `ja/history.json`. The fallback chain handles it: if `ja[key_one]` is missing, the translator tries `ja[key_other]`, then falls back to `en[key_one]`.

## Checklist before finishing i18n work

- [ ] Every new string is in `en/*.json` first
- [ ] Every new string in `en/*.json` has a Japanese translation in `ja/*.json`
- [ ] Plural keys follow the `key_one`/`key_other` pattern; Japanese `_one` variants are intentionally absent
- [ ] Aggregation code returns `Message`/`Label`, never prose
- [ ] Tests are `.test.ts` for pure logic (not `.test.tsx` with RTL)
- [ ] Memoized values that use `t()` or formatters list them in deps (or move strings out of the memo)
- [ ] Main-process strings use `mainT()`, not `useI18n()`
- [ ] `date-fns` calls include `{ locale: dateFnsLocale }` (except in `useFuzzySearch.ts`)
- [ ] `bun run lint` + `bun run test` pass
