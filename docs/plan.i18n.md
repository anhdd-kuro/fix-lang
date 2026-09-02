# i18n (EN + JA) Implementation Plan

## Overview

Add full internationalization to FixLang for **English (`en`)** and **Japanese (`ja`)** only, with the
architecture built so a third locale is a JSON file plus one registry entry — no code changes.

Scope covers **all renderer UI + main-process user-facing strings** (notifications, window titles,
tray tooltip, overlay/error popup).

## Locked Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Library | Hand-rolled typed module in `src/features/i18n/shared/` | No new dep; works in main + preload + renderer + vitest; repo already hand-rolls stores (no zustand) |
| Catalog format | **JSON**, flat dotted keys, one file per locale | `keyof typeof en` gives a compile-time key union with `resolveJsonModule` (already on in `tsconfig.json`) |
| Locale state | `electron-store` + IPC broadcast, mirroring `themeStore` / `ipc/features/theme.ts` | Tray, dashboard, PromptGen, overlay stay in sync; main process can translate too |
| Detection | `app.getLocale()` in main → `ja` if it starts with `ja`, else `en`; user override persisted | Single source of truth in main; renderer never guesses |
| JA content | Real 日本語 for every key in scope (丁寧語, macOS conventions) | No placeholder debt |
| Plurals | `Intl.PluralRules` category suffixes (`key_one` / `key_other`) | JA has only `other`; EN needs two; scales to `zero/two/few/many` untouched |
| Direction | `dir` carried in locale metadata (`ltr` for both), applied to `<html>` | RTL-ready without doing RTL work now |

### Non-goals

- Translating AI prompt assets in `src/prompts/` — those stay English (model-facing, not user-facing).
- Translating preset names/system prompts users author themselves — user data, not UI chrome.
- RTL layout/mirroring (no RTL locale ships).

## Architecture

```
src/features/i18n/shared/
├── locales/
│   ├── en/
│   │   ├── common.json           — source of truth for common keys
│   │   ├── dashboard.json
│   │   ├── history.json
│   │   ├── logs.json
│   │   ├── models.json
│   │   ├── notifications.json
│   │   ├── profiles.json
│   │   ├── settings.json
│   │   └── tray.json
│   ├── ja/
│   │   ├── common.json           — JA translations (partial; missing keys fall back to EN)
│   │   ├── dashboard.json
│   │   ├── history.json
│   │   ├── logs.json
│   │   ├── models.json
│   │   ├── notifications.json
│   │   ├── profiles.json
│   │   ├── settings.json
│   │   └── tray.json
│   └── index.ts                  — merges all namespaces into EN_CATALOG / JA_CATALOG
├── registry.ts            — LOCALE_META: code → { label, nativeLabel, dir, dateFnsLocale, intlTag }
├── translate.ts           — createTranslator(): lookup → plural → interpolate → fallback
├── format.ts              — date / number / currency / relative-time / percent via Intl + date-fns
├── detect.ts              — normalizeLocale(raw): "ja-JP" | "ja" → "ja"; unknown → "en"
├── locales.test.ts        — EN/JA parity, plural completeness, key sorting
├── translate.test.ts
├── format.test.ts
└── detect.test.ts

src/features/i18n/store/localeStore.ts          — persisted locale (electron-store name: "locale")
src/main/i18n.ts                   — sync main-process translator (no React)
src/features/i18n/main/locale.ts    — get-locale / set-locale / broadcastLocale / syncLocaleToWindow
src/features/i18n/preload/locale.ts     — localeFeature (getLocale / setLocale / onLocaleChanged)
src/renderer/i18n/I18nProvider.tsx — context + <html lang dir> sync
src/renderer/i18n/useI18n.ts       — { t, locale, setLocale, format* , dir }
src/renderer/components/LanguageSelect.tsx
```

### Catalog shape (flat dotted keys per namespace, alphabetically sorted within files)

Keys are globally unique and dotted (`"common.cancel"`, `"overview.stat.sessions"`), split across per-namespace files to prevent merge conflicts. At build time, all namespaces for each locale are merged into a single flat catalog (`EN_CATALOG` and `JA_CATALOG`).

`src/features/i18n/shared/locales/en/common.json` (excerpt)

```json
{
  "common.cancel": "Cancel",
  "common.save": "Save"
}
```

`src/features/i18n/shared/locales/en/overview.json` or `en/dashboard.json` (excerpt)

```json
{
  "overview.stat.sessions": "Sessions",
  "overview.tokenBudget": "You've used {tokens} tokens — {pct}% of the {budget} reference budget."
}
```

`src/features/i18n/shared/locales/ja/common.json` (excerpt)

```json
{
  "common.cancel": "キャンセル",
  "common.save": "保存"
}
```

`src/features/i18n/shared/locales/ja/dashboard.json` (excerpt)

```json
{
  "overview.stat.sessions": "セッション",
  "overview.tokenBudget": "{tokens} トークンを使用しました（基準予算 {budget} の {pct}%）。"
}
```

Missing keys in JA files fall back to English at runtime — every EN key need not exist in every JA file.

### Type-safety boundary (read before coding)

- `keyof typeof EN_CATALOG` **does** give a literal key union — keys are type-checked at compile time via `export type TranslationKey = keyof typeof EN_CATALOG`.
- JSON string *values* are widened to `string` by TypeScript, so placeholder names **cannot** be
  derived into typed `t()` params. Params are `Record<string, string | number>`, and correctness is
  enforced by (a) a placeholder-parity test across locales and (b) a dev-mode warning when an
  unreplaced `{token}` survives interpolation. Do not try to template-literal your way out of this.
- Non-default locales are typed `Partial<Record<TranslationKey, string>>` so adding a language never
  breaks the build; `ja` completeness is enforced by test instead.

### Fallback chain

`ja[key]` → `ja[base key]` (plural category `other`) → `en[key]` → `key` string itself (never blank,
never `undefined`), plus a `console.warn` in dev only.

## Chunks

Each chunk is independently shippable: `bun run lint` + `bun run test` green at the end of every one.

---

### Chunk 1 — i18n kernel (`src/features/i18n/shared/`)

- [x] `registry.ts`: `LOCALE_CODES = ["en", "ja"] as const`, `Locale` type, `LOCALE_META` with
      `label` / `nativeLabel` / `dir` / `intlTag` / `dateFnsLocale` key, `DEFAULT_LOCALE = "en"`
- [x] `detect.ts`: `normalizeLocale(raw: unknown): Locale` — case-insensitive, strips region
      (`ja-JP` → `ja`), unknown/undefined → `DEFAULT_LOCALE`; `isLocale()` guard
- [x] `locales/en/` + `locales/ja/`: per-namespace JSON files (initially just `common.json`); `locales/index.ts` merges them into `EN_CATALOG` and `JA_CATALOG`
- [x] `locales/index.ts`: `export type TranslationKey = keyof typeof EN_CATALOG`
- [x] `translate.ts`: `createTranslator(locale)` → `t(key, params?)`; plural via `Intl.PluralRules`
      suffix lookup; `{token}` interpolation; full fallback chain; dev warn on miss/unreplaced token
- [x] Tests: key hit, plural EN one/other, plural JA collapses to `other`, missing key → EN,
      missing in both → key echoed, interpolation, unknown placeholder left + warned, `normalizeLocale`
      table (`"ja"`, `"ja-JP"`, `"JA"`, `"en-US"`, `"fr"`, `""`, `undefined`)

**Done when:** kernel is pure, has zero Electron/React imports, and is importable from a vitest test.

---

### Chunk 2 — Locale-aware formatters (`src/features/i18n/shared/format.ts`)

- [ ] `createFormatters(locale)` → `formatNumber`, `formatCompactNumber`, `formatCurrency`,
      `formatPercent`, `formatDate`, `formatDateTime`, `formatRelativeTime`
- [ ] Back `formatDate*` with `Intl.DateTimeFormat`, `formatRelativeTime` with `Intl.RelativeTimeFormat`
- [ ] `dateFnsLocale(locale)` → `enUS` | `ja` from `date-fns/locale`, for the 6 files already on date-fns
- [ ] Cache `Intl.*` instances per locale (constructor cost is real; tray re-renders often)
- [ ] Tests: JA vs EN date order, thousands separators, JPY vs USD currency shape, relative time
      ("2 days ago" / "2日前"), invalid `Date` → safe empty string not `Invalid Date`

**Done when:** no formatter call anywhere needs a hardcoded locale tag.

---

### Chunk 3 — Persistence, detection, IPC transport

- [ ] `src/features/i18n/store/localeStore.ts` — mirror `themeStore.ts`: `getLocale()` / `setLocale()`,
      `clearInvalidConfig: true`, store name `"locale"`, `undefined` stored value → detect from
      `app.getLocale()` once and persist
- [ ] `src/features/i18n/main/locale.ts` — `get-locale` / `set-locale` handlers (reject non-`Locale`
      input with `{ success: false, error }`, same shape as `set-theme`), `broadcastLocale()` over all
      `BrowserWindow`s + `syncLocaleToWindow()` on load; register in `src/features/main/index.ts`
      and wherever `registerThemeHandlers` is called
- [ ] `src/features/i18n/preload/locale.ts` — `localeFeature` = `getLocale` / `setLocale` /
      `onLocaleChanged` (returns unsubscribe, exactly like `onThemeChanged`); add to
      `src/features/preload/index.ts`, spread into `exposeInMainWorld`, add `LocaleFeature` to the
      `ElectronAPI` intersection in `src/preload/index.ts`
- [ ] Tests: store default/roundtrip/invalid-value, handler validation rejects `"fr"` and non-strings

**Done when:** locale survives app restart and every window receives `locale-changed`.

---

### Chunk 4 — Renderer runtime

- [ ] `src/renderer/i18n/I18nProvider.tsx` — loads locale via `electronAPI.getLocale()`, subscribes to
      `onLocaleChanged`, memoizes translator + formatters, sets `document.documentElement.lang` and
      `.dir` from `LOCALE_META`
- [ ] `src/renderer/i18n/useI18n.ts` — `{ t, locale, setLocale, dir, ...formatters }`; throws a clear
      error when used outside the provider
- [ ] Wrap all four entrypoints: `MainWindow/index.tsx`, `TrayWindow/index.tsx`,
      `PromptGenWindow/index.tsx`, `CorrectionResultWindow/index.tsx`
- [ ] Render nothing translated until the initial locale resolves (avoid an EN→JA flash)
- [ ] Test: pure reducer/selector logic only — **`@testing-library/react` is not installed**, and
      vitest `includeSource` is `./src/**/*.test.{ts,js}`, so tests must be `.test.ts` with logic
      extracted out of `.tsx`

**Done when:** `useI18n().t("common.save")` renders 保存 after a locale switch, in every window.

---

### Chunk 5 — Language switcher UI

- [ ] `src/renderer/components/LanguageSelect.tsx` — options generated from `LOCALE_META`
      (label + nativeLabel: "English" / "日本語"), no hardcoded two-item list
- [ ] Mount in `SettingGeneral.tsx` next to the existing appearance/general controls
- [ ] Switch is instant and global: dashboard, tray, PromptGen, and future notifications all follow
- [ ] Migrate every string in `SettingGeneral.tsx` to `t()` as the reference conversion

**Done when:** switching in Settings retitles the tray window without an app restart.

---

### Chunk 6 — Main-process strings

- [ ] `src/main/i18n.ts` — `mainT(key, params?)` reading `localeStore` synchronously; invalidate its
      cached translator inside `set-locale`
- [ ] Migrate notifications: `keybindings/correction.ts` ("Good job!", "…already correct…",
      `${preset.name} result`), `keybindings/profileSwitch.ts`, `ipc/features/profiles.ts`
      (Created / Applied / Updated / Deleted / Switched — 6+ sites)
- [ ] Migrate window titles: `webViewWindows/promptGenWindow.ts` ("Generated Prompts"),
      `webViewWindows/correctionResultWindow.ts` ("FixLang result"); tray tooltip in `tray.ts`
- [ ] `webViewWindows/overlay.html` + `errorPopupWindow.ts` — the two strings there
      ("Mouse Loading Spinner Overlay", "FixLang Error") get injected the same way theme is synced;
      do not add a build step for one standalone HTML file
- [ ] Tests: notification payload builders extracted to pure functions and asserted in both locales

**Done when:** a JA user gets JA notifications and JA window titles.

---

### Chunk 7 — Renderer migration wave A (tray + small shared)

- [ ] `TrayWindow/`: `TrayToolbar.tsx`, `TrayCreditBalance.tsx`, `TrayActivityHeatmap.tsx`, `shared.ts`
- [ ] `CorrectionResultWindow/index.tsx`
- [ ] Small shared components: `CopyButton`, `Dialog`, `SearchInput`, `Spinner`,
      `MouseLoadingSpinner`, `Tooltip`, `TrashButton`, `StatCard`, `PlaceholderPanel`,
      `SettingTabBtn`, `KeyBinding`, `SearchableSelect`
- [ ] Existing `TrayToolbar.test.ts` must still pass — update expectations to key-based assertions

---

### Chunk 8 — Renderer migration wave B (dashboard)

- [ ] `MainWindow/App.tsx`, `dashboardTabs.ts` (tab labels become keys + a `t()` at render time,
      **not** translated strings baked into the tab table — keep `dashboardTabs.test.ts` locale-free)
- [ ] `OverviewPanel.tsx`, `overviewAggregations.ts` (its sentence builders return
      `{ key, params }`, not prose — that file is 23KB of English strings and is the main trap here)
- [ ] `ModelsPanel.tsx`, `PresetWeightChart.tsx`, `LogsPanel.tsx` + `logsView.ts`
- [ ] `HistoryPanel.tsx`, `HistoryEntryItem.tsx`, `HistoryReviewModal.tsx`
- [ ] Keep aggregation tests asserting keys/params, not rendered English

---

### Chunk 9 — Renderer migration wave C (settings + models + profiles)

- [ ] `SettingCorrection.tsx` (19KB), `SettingPromptGen.tsx`, `SettingAppearance.tsx`,
      `SettingUpdates.tsx` (+ keep `SettingUpdates.test.ts` green), `SettingsModal.tsx`
- [ ] `ProfileManager.tsx` (15KB), `ProfileSelector.tsx`
- [ ] `ModelSelect.tsx` (16KB), `ModelManagerDialog.tsx` (14KB), `OpenRouterPanel.tsx`
- [ ] `HotkeyInput.tsx`, `validateHotkeys.ts` error messages, `SettingsIcon.tsx` a11y labels

---

### Chunk 10 — Locale-aware formatting sweep

- [ ] Replace bare `toLocaleString()` — `overviewAggregations.ts:518-522`, `OverviewPanel.tsx:130-236`,
      `ModelsPanel.tsx:86-132`, `ProfileManager.tsx:275` — with `formatNumber` / `formatDateTime`
- [ ] Remove the hardcoded `"en-US"` in `ModelSelect.tsx:262`
- [ ] Pass `dateFnsLocale(locale)` to every `date-fns` `format`/`formatDistance` call in the 6
      date-fns files; `PresetWeightChart.tsx:106` `toLocaleDateString(undefined, …)` → `formatDate`
- [ ] Test: same input renders EN and JA differently for number, date, and currency

---

### Chunk 11 — Guardrails + docs

- [ ] `locales.test.ts`: `ja` key set === `en` key set (no missing, no orphans)
- [ ] Placeholder-parity test: `{tokens}` in `en` must appear in `ja` for the same key
- [ ] Plural-completeness test: every `*_one` in `en` has an `*_other`; every plural base resolves in `ja`
- [ ] JSON key-sort + no-duplicate-key test (keeps diffs reviewable as the catalog grows)
- [ ] `bun run i18n:check` script wired into the lint/test story
- [ ] Optional: ESLint `react/jsx-no-literals` scoped to `src/renderer/**` to stop new hardcoded text
- [ ] Update `AGENTS.md` (i18n section + "add a string" recipe) and `README.md` (language setting)
- [ ] Add `.claude/skills/fixlang/fixlang-i18n/SKILL.md` with the traps: JSON values widen to
      `string`, tests must be `.test.ts`, aggregations return keys not prose, main process needs its
      own translator

---

## Sample code

### Adding a new translatable string

1. Add to `src/features/i18n/shared/locales/en/{namespace}.json` (e.g. `en/models.json`):

```json
{
  "models.refresh.tooltip": "Refresh the model list for {provider}"
}
```

2. Add the JA value to `src/features/i18n/shared/locales/ja/{namespace}.json` (e.g. `ja/models.json`):

```json
{
  "models.refresh.tooltip": "{provider} のモデル一覧を再取得します"
}
```

3. Use it. The key is type-checked — a typo fails `bun run lint`:

```tsx
import { useI18n } from "~/renderer/i18n/useI18n";

export function RefreshModelsButton({ provider }: { provider: string }) {
  const { t } = useI18n();
  return (
    <button title={t("models.refresh.tooltip", { provider })}>
      {t("common.refresh")}
    </button>
  );
}
```

Plural form — define both categories in `en`, only `_other` in `ja`:

```json
{ "history.count_one": "{count} correction", "history.count_other": "{count} corrections" }
```

```tsx
const { t, formatNumber } = useI18n();
t("history.count", { count: formatNumber(n) }); // picks _one/_other via Intl.PluralRules
```

### Switching locale at runtime

```tsx
import { LOCALE_CODES, LOCALE_META } from "~/features/i18n/shared/registry";
import { useI18n } from "~/renderer/i18n/useI18n";

export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label>
      {t("settings.general.language.label")}
      <select
        value={locale}
        onChange={(event) => void setLocale(event.target.value as typeof locale)}
      >
        {LOCALE_CODES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_META[code].nativeLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
```

`setLocale` calls `electronAPI.setLocale(code)`; main persists it and broadcasts `locale-changed`, so
every window — tray, dashboard, PromptGen, result popup — re-renders in the new language, and the next
notification from the main process is already translated.

### Formatting

```tsx
const { formatNumber, formatDateTime, formatCurrency } = useI18n();
formatNumber(1234567);          // en: 1,234,567   ja: 1,234,567
formatDateTime(entry.createdAt); // en: Jul 25, 2026, 3:04 PM   ja: 2026年7月25日 15:04
formatCurrency(0.0123, "USD");  // en: $0.01   ja: $0.01 (JPY when the provider bills JPY)
```

### Main process

```ts
import { mainT } from "~/main/i18n";

new Notification({
  title: mainT("notification.profileSwitched.title"),
  body: mainT("notification.profileSwitched.body", { name: nextProfile.name }),
}).show();
```

## Adding a third language later

1. `src/features/i18n/shared/locales/fr.json` — partial is fine; missing keys fall back to EN.
2. Add `fr` to `LOCALE_CODES` and one `LOCALE_META` entry (`label`, `nativeLabel`, `dir`, `intlTag`,
   `dateFnsLocale`).

No component, IPC, store, or formatter change. `LanguageSelect` grows an option automatically. If the
locale is RTL, set `dir: "rtl"` — the provider already writes `dir` onto `<html>`.

## Risks / traps

- **`overviewAggregations.ts` (23.8KB) builds English sentences.** Returning `{ key, params }` instead
  of prose is the single largest refactor in the plan and touches a 21KB test file.
- **JSON values widen to `string`.** Placeholder names are not type-checked; the parity test is the
  only guard. Don't reach for a template-literal type — it can't work through a JSON import.
- **Vitest `includeSource` is `.test.{ts,js}`** and there is no React testing library. Extract logic
  from `.tsx` into `.ts` to keep it testable.
- **Main process is CJS (`.cjs`) on Electron 43.** Keep `src/main/i18n.ts` import-cycle-free; importing
  a renderer module there will break the build.
- **Tray re-renders often.** Cache `Intl.*` instances per locale.
- **Notification permission** is unrelated to locale — do not touch that flow while migrating strings.
