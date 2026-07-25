# Spec — i18n for the Dashboard aggregation layer (Chunk 8)

> Scope: make `src/renderer/MainWindow/overviewAggregations.ts`,
> `src/renderer/MainWindow/modelsAggregations.ts` and their three consuming components
> (`OverviewPanel.tsx`, `ModelsPanel.tsx`, `PresetWeightChart.tsx`) **locale-free in the data layer**.
> Companion to `docs/plan.i18n.md`. Normative — follow literally.

**Prime directive.** The aggregation layer returns *descriptors* (`{ key, params }`), never prose,
never a formatted number, never a formatted date. The renderer is the only place a locale exists.

## Orchestrator amendments to this spec

Three deviations from the original design pass, decided after the kernel landed. These win over
anything below that contradicts them.

1. **Step 0 is already done.** `translate.ts`, `format.ts`, `registry.ts`, `detect.ts`, `keys.ts`,
   `locales/index.ts`, the locale store, the IPC transport, and the renderer `I18nProvider`/`useI18n`
   are all on disk and committed. Do not rewrite them.
2. **`PluralBaseKey` already exists** in `src/shared/i18n/translate.ts` and is re-exported from
   `src/shared/i18n/keys.ts` as part of `TKey`. Import key types from `keys.ts`. `message.ts` must
   reuse those, not redeclare a second `StripPlural` ladder.
3. **All 59 keys go in `dashboard.json`**, including the `models.*` ones. Section 3.1 below says
   `models.*` belongs in `models.json`; that file is owned by a different agent working in parallel,
   and the merge in `locales/index.ts` is flat so the file choice has zero runtime effect.

Number formatting (section 1.4 rule 2) is **implemented as specified**: `t()` locale-formats every
`number` param through a cached `Intl.NumberFormat`; `string` params are inserted verbatim.

## 1. Descriptor type

### 1.1 Location
New file: `src/shared/i18n/message.ts`. Import `TranslationKey`/`TKey` with `import type` only, so the
module has **zero runtime dependencies** and importing `msg()` into a pure aggregation module does not
pull the JSON catalogs into that module's runtime graph.

### 1.2 The types

```ts
export type MessageKey = TKey;            // TranslationKey | PluralBaseKey, from keys.ts
export type MessageParams = Readonly<Record<string, string | number>>;
export type Message = { readonly key: MessageKey; readonly params?: MessageParams };

/** A display value that is EITHER user data (never translated) OR UI chrome (always translated). */
export type Label =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "message"; readonly message: Message };

export const msg = (key: MessageKey, params?: MessageParams): Message =>
  params === undefined ? { key } : { key, params };
export const textLabel = (text: string): Label => ({ kind: "text", text });
export const messageLabel = (key: MessageKey, params?: MessageParams): Label =>
  ({ kind: "message", message: msg(key, params) });

export type Translate = (key: MessageKey, params?: MessageParams) => string;
export const resolveMessage = (m: Message, t: Translate): string => t(m.key, m.params);
export const resolveLabel = (l: Label, t: Translate): string =>
  l.kind === "text" ? l.text : resolveMessage(l.message, t);
```

### 1.3 "Sometimes data, sometimes a message" — use `Label`, never `string | Message`

Two ambiguous values: `PresetBreakdownRow.presetName` (user preset name **or** the literal `"Other"`,
`overviewAggregations.ts:222`) and `ModelRow.model` (real id **or** `"(unknown)"`,
`modelsAggregations.ts:19`).

**Decision.** Keep the existing `string` field as the *identity/grouping key* (Map keys, sort
stability, React `key`, raw-id `title`) and **add a sibling `Label` field** for display. The sentinel
becomes locale-free:

```ts
// overviewAggregations.ts
export const UNTITLED_PRESET_ID = "__untitled__";   // was UNTITLED_PRESET_LABEL = "Other"
export type PresetBreakdownRow = {
  presetName: string;   // identity: user preset name, or UNTITLED_PRESET_ID
  presetLabel: Label;   // display: textLabel(name) | messageLabel("overview.preset.untitled")
  count: number;
};
// modelsAggregations.ts
export const UNKNOWN_MODEL_ID = "__unknown__";      // was UNKNOWN_MODEL_LABEL = "(unknown)"
export type ModelRow = { model: string; modelLabel: Label; /* …unchanged… */ };
```

Rejected: `presetName: string | Message` — forces a `typeof` narrow at every call site, and a bare
`string` cannot distinguish "user data" from "English we forgot to migrate". The tag is greppable.

### 1.4 How numbers flow (the rule the whole spec hangs on)

1. **Aggregations never format.** No `toLocaleString`, no `Intl.*`, no `toFixed`, no date-fns. Raw
   values go into `params`.
2. **`t()` locale-formats every `number` param** through the cached `Intl.NumberFormat` for the active
   locale before interpolation. Already implemented and covered in `translate.test.ts`.
3. **Anything that must NOT be grouped, or needs a non-default format, is passed as a `string`,
   produced by the renderer** via `useI18n()`: dates → `formatDate(...)`; fixed-decimal percents →
   `formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 })`; currency →
   `formatCurrency(v, "USD")`; zero-padded hours, years, ids → plain renderer-built strings.
4. **Plural selection uses the raw `count` number.** A `Message` whose `key` is a `PluralBaseKey`
   **must** carry `params.count` as a `number` — `Intl.PluralRules` needs the numeric value; rule 2
   then renders it locale-formatted, so "1,234 corrections" works with no extra param.

Bright line: `number` in params ⇒ "plain count/total, format it for me". `string` in params ⇒ "already
formatted, do not touch". That is the only formatting convention in this chunk.

### 1.5 `useI18n()` additions
`tm: (message: Message) => string` and `tl: (label: Label) => string` — thin wrappers over
`resolveMessage` / `resolveLabel`.

## 2. Per-function inventory

### 2.1 `src/renderer/MainWindow/overviewAggregations.ts` (`✅` = no change; pre-change line numbers)

| # | Export (line) | Returns today | Returns after | Tests to rewrite |
| --- | --- | --- | --- | --- |
| 1 | `type OverviewRange` (29) | `AnalyticsRange` | ✅ | — |
| 2 | `filterByRange` re-export (30) | entries | ✅ | `test:68-90` untouched |
| 3 | `localDayKey` (40) | `"YYYY-MM-DD"` | ✅ (locale-free key, not display) | — |
| 4 | `totalCorrections` (58) | `number` | ✅ | `test:92-107` untouched |
| 5 | `totalTokens` (61) | `number` | ✅ | `test:92-107` untouched |
| 6 | `CostTotal`/`costTotal` (66-67) | `CostSum` | ✅ | `test:109-132` untouched |
| 7 | `activeDays` (70) | `number` | ✅ | `test:134-143` untouched |
| 8 | `streaks` (85) | `{current,longest}` | ✅ | `test:145-175` untouched |
| 9 | `peakHour` (132) | `number \| null` | ✅ — renderer builds `"09:00"`/`"—"` | `test:177-195` untouched |
| 10 | `favoriteModel` (153) | `string \| null` | ✅ — model id is user data | `test:197-211` untouched |
| 11 | `stripModelDate` (186) | `string \| null` | ✅ | `test:663-679` untouched |
| 12 | `splitModelId` (198) | `ModelProvider` | ✅ | `test:600-618` untouched |
| 13 | **`UNTITLED_PRESET_LABEL` (222)** | `"Other"` | **renamed `UNTITLED_PRESET_ID = "__untitled__"`** | import rename `test:34`; uses go through the constant (`test:223,240,266`) so assertions survive |
| 14 | `type PresetBreakdownRow` (213) | `{presetName,count}` | **`+ presetLabel: Label`** | see #15 |
| 15 | **`perPresetBreakdown` (228)** | rows w/ English `"Other"` | rows `+ presetLabel` | **rewrite** `test:213-226` |
| 16 | `type PresetWeightRow` (219) | `+weight` | inherits `presetLabel` | see #17 |
| 17 | **`perPresetWeights` (248)** | rows w/ `"Other"` | rows `+ presetLabel` | **rewrite** `test:228-249` — `toEqual([...])` at `test:237-241` breaks on the new field |
| 18 | `type PresetTimeSeriesRow` (263) | `{presetName,counts}` | **`+ presetLabel: Label`** | see #19 |
| 19 | **`presetCountsOverTime` (282)** | series w/ `"Other"` | series `+ presetLabel` | **partial** `test:251-279` — add 1 assertion |
| 20 | `HeatmapBucket`/`heatmapBuckets` (329,337) | `{date,count}[]` | ✅ | `test:281-312` untouched |
| 21 | `SESSION_GAP_MINUTES`/`sessionCount` (383,390) | `number` | ✅ | `test:549-563` untouched |
| 22 | `messageCount` (411) | `number` | ✅ | `test:565-570` untouched |
| 23 | `HOUR_BLOCKS`/`HOURS_PER_BLOCK` (414-415) | `number` | ✅ | — |
| 24 | `HEATMAP_MIN_DAYS`/`hourBlockHeatmap` (427,439) | cells | ✅ | `test:572-588`, `646-661` untouched |
| 25 | `sevenDayHourBlockHeatmap` (474) | cells | ✅ | `test:622-645` untouched |
| 26 | `BENCHMARK_TOKENS` (504) | `100_000` | ✅ | — |
| 27 | **`benchmarkSentence` (510-525)** | English prose, 3 branches, 2 × `toLocaleString()` | **renamed `benchmarkMessage(tokens, benchmark?): Message`** | **full rewrite** `test:590-598` + new cases (4.3) |
| 28 | `intensityLevel` (532) | `0..4` | ✅ | `test:314-325` untouched |
| 29 | **`type TokenActivityCalendarMonthLabel` (577)** | `{label: string, column}` | **`{ key: MessageKey, column }`** | see #31 |
| 30 | `MONTH_SHORT` (598-611, private) | `"Jan".."Dec"` | **replaced by `MONTH_KEYS = ["charts.month.jan", …]`** | — |
| 31 | **`tokenActivityCalendar` (689; label built 786-791)** | calendar w/ English month labels | same shape, `monthLabels[].key` | **rewrite** `test:476-510`; `test:327-375`, `377-546` untouched |

**9 exported symbols change** of 31; `benchmarkSentence` is the only one whose return *kind* changes.

### 2.2 `src/renderer/MainWindow/modelsAggregations.ts`

| # | Export (line) | Returns today | Returns after | Tests to rewrite |
| --- | --- | --- | --- | --- |
| 1 | **`UNKNOWN_MODEL_LABEL` (19)** | `"(unknown)"` | **renamed `UNKNOWN_MODEL_ID = "__unknown__"`** | import rename `test:9`; `test:43-47` survives |
| 2 | **`groupKeyForEntry` (26)** | id or `"(unknown)"` | id or `UNKNOWN_MODEL_ID` | `test:29-48` unchanged after import rename |
| 3 | **`type ModelRow` (38)** | `{model, …}` | **`+ modelLabel: Label`** | see #4 |
| 4 | **`perModelBreakdown` (73)** | rows | rows `+ modelLabel` | **additive only** — add 2 assertions |
| 5 | `type TokenDayBar` (124) | `{date,tokens}` | ✅ | `test:163-176` untouched |
| 6 | `tokensPerDay` (131) | dense series | ✅ — `date` stays an ISO day key | `test:163-176` untouched |

### 2.3 New pure view modules (component logic extracted so it is testable in `.ts`)

| New file | Extracted from | Exports (all return descriptors) |
| --- | --- | --- |
| `src/renderer/components/tokenActivityView.ts` | `OverviewPanel.tsx:109-136`, `:49-56`, `:227-241` | `weeklyRangeOf(dayKey): { start: string; end: string }`; `tooltipMessageForCell(mode, cell, fmt): Message \| undefined` where `fmt = { date: (dayKey: string) => string }`; `TOKEN_ACTIVITY_TABS`; `STAT_CARD_KEYS`; `peakHourMessage(hour: number \| null): Message` |
| `src/renderer/components/presetChartView.ts` | `PresetWeightChart.tsx:99-110`, `:186-197` | `weightPercent` (moved unchanged); `donutTooltipMessage(row, pctLabel: string): Message`; `CHART_TITLE_KEYS` |
| `src/renderer/components/modelsView.ts` | `ModelsPanel.tsx:86`, `:148` | `barTooltipMessage(bar, dateLabel: string): Message`; `showMoreMessage(expanded, hiddenCount): Message`; `MODEL_TABLE_HEADER_KEYS` |

`tooltipMessageForCell` takes a `fmt.date` callback, not a locale, so it stays pure.

### 2.4 Component string sites (no logic, just `t()` at render)

| File:line | English today | Key |
| --- | --- | --- |
| `OverviewPanel.tsx:234-241` | Sessions / Messages / Total tokens / Active days / Current streak / Longest streak / Peak hour / Favorite model | `overview.stat.*` |
| `OverviewPanel.tsx:228,241` | `"—"` | `overview.value.empty` |
| `OverviewPanel.tsx:238-239` | `` `${n}d` `` | `overview.value.days` |
| `OverviewPanel.tsx:255-257` | Token activity | `overview.tokenActivity.title` |
| `OverviewPanel.tsx:53-55` | Daily / Weekly / Cumulative | `overview.tokenActivity.mode.*` |
| `OverviewPanel.tsx:320-330` | `label.label` → `t(label.key)` | `charts.month.*` |
| `ModelsPanel.tsx:69-71` | No model usage in this range yet. | `models.usage.empty` |
| `ModelsPanel.tsx:76-78` | Token usage over time | `models.usage.chartTitle` |
| `ModelsPanel.tsx:105-108` | Model / Input / Output / Usage | `models.table.*` |
| `ModelsPanel.tsx:148` | Show less / Show N more | `models.table.showLess` / `.showMore` |
| `PresetWeightChart.tsx:150` | Share (%) | `charts.presetShare.datasetLabel` |
| `PresetWeightChart.tsx:175` | Preset share | `charts.presetShare.title` |
| `PresetWeightChart.tsx:216` | Daily total | `charts.correctionsOverTime.dailyTotal` |
| `PresetWeightChart.tsx:252` | Corrections over time | `charts.correctionsOverTime.title` |
| `PresetWeightChart.tsx:281` | Corrections (y-axis) | `charts.correctionsOverTime.yAxis` |
| `PresetWeightChart.tsx:305-308` | No preset usage in this range yet. | `charts.presetShare.empty` |
| `PresetWeightChart.tsx:322-324` | No daily corrections in this range yet. | `charts.correctionsOverTime.empty` |

## 3. Key naming

### 3.1 File placement
All 59 keys go in `src/shared/i18n/locales/{en,ja}/dashboard.json` — see orchestrator amendment 3.
Keys stay globally unique and alphabetically sorted (Chunk 11 guardrail).

### 3.2 `overview.*` — 28 keys

| Key | EN | JA | Params | Plural |
| --- | --- | --- | --- | --- |
| `overview.stat.sessions` | Sessions | セッション | — | — |
| `overview.stat.messages` | Messages | メッセージ | — | — |
| `overview.stat.totalTokens` | Total tokens | 合計トークン | — | — |
| `overview.stat.activeDays` | Active days | 稼働日数 | — | — |
| `overview.stat.currentStreak` | Current streak | 現在の連続日数 | — | — |
| `overview.stat.longestStreak` | Longest streak | 最長の連続日数 | — | — |
| `overview.stat.peakHour` | Peak hour | ピーク時間 | — | — |
| `overview.stat.favoriteModel` | Favorite model | よく使うモデル | — | — |
| `overview.value.days` | `{count}d` | `{count}日` | `count:number` | no |
| `overview.value.hour` | `{hour}:00` | `{hour}:00` | `hour:string` (zero-padded — **string**, must not be grouped) | — |
| `overview.value.empty` | `—` | `—` | — | — |
| `overview.tokenActivity.title` | Token activity | トークン利用状況 | — | — |
| `overview.tokenActivity.mode.daily` | Daily | 日次 | — | — |
| `overview.tokenActivity.mode.weekly` | Weekly | 週次 | — | — |
| `overview.tokenActivity.mode.cumulative` | Cumulative | 累計 | — | — |
| `overview.tokenActivity.tooltip.daily` | `{tokens} tokens on {date}` | `{date} に {tokens} トークン` | `tokens:number`, `date:string` | — |
| `overview.tokenActivity.tooltip.daily.withCorrections_one` | `{tokens} tokens on {date}, {count} correction` | *(absent in ja)* | + `count:number` | **yes** |
| `overview.tokenActivity.tooltip.daily.withCorrections_other` | `{tokens} tokens on {date}, {count} corrections` | `{date} に {tokens} トークン、{count} 件の校正` | same | **yes** |
| `overview.tokenActivity.tooltip.weekly` | `{tokens} tokens during {start} to {end}` | `{start}〜{end} に {tokens} トークン` | `tokens:number`, `start:string`, `end:string` | — |
| `overview.tokenActivity.tooltip.weekly.withCorrections_one` | `{tokens} tokens during {start} to {end}, {count} correction` | *(absent in ja)* | + `count:number` | **yes** |
| `overview.tokenActivity.tooltip.weekly.withCorrections_other` | `{tokens} tokens during {start} to {end}, {count} corrections` | `{start}〜{end} に {tokens} トークン、{count} 件の校正` | + `count:number` | **yes** |
| `overview.tokenActivity.tooltip.cumulative` | `{tokens} tokens through {date}` | `{date} までに累計 {tokens} トークン` | `tokens:number`, `date:string` | — |
| `overview.tokenActivity.tooltip.cumulative.withCorrections_one` | `{tokens} tokens through {date}, {count} correction` | *(absent in ja)* | + `count:number` | **yes** |
| `overview.tokenActivity.tooltip.cumulative.withCorrections_other` | `{tokens} tokens through {date}, {count} corrections` | `{date} までに累計 {tokens} トークン、{count} 件の校正` | + `count:number` | **yes** |
| `overview.benchmark.empty` | No token usage in this range yet. | この範囲ではまだトークンを使用していません。 | — | — |
| `overview.benchmark.overBudget` | `You've used {tokens} tokens — {pct}% of the {budgetK}k-token reference budget.` | `{tokens} トークンを使用しました — 基準予算 {budgetK}k トークンの {pct}% です。` | `tokens:number`, `pct:number`, `budgetK:number` | — |
| `overview.benchmark.withHeadroom` | `You've used {tokens} tokens — {pct}% of the {budgetK}k-token reference budget, {headroom}% headroom left.` | `{tokens} トークンを使用しました — 基準予算 {budgetK}k トークンの {pct}%、残り {headroom}% です。` | + `headroom:number` | — |
| `overview.preset.untitled` | Other | その他 | — | — |

The em dash `—` and the `k-token` suffix live **inside the JSON value**. Never concatenate a translated
fragment with punctuation in code — that is what `overviewAggregations.ts:518` does today, and why the
correction suffix at `OverviewPanel.tsx:124-127` becomes six full `withCorrections` keys instead of an
appended fragment (JA word order puts the date first).

### 3.3 `charts.*` — 21 keys

| Key | EN | JA | Params | Plural |
| --- | --- | --- | --- | --- |
| `charts.month.jan` … `charts.month.dec` (12) | Jan … Dec | 1月 … 12月 | — | — |
| `charts.presetShare.title` | Preset share | プリセット比率 | — | — |
| `charts.presetShare.datasetLabel` | Share (%) | 比率（%） | — | — |
| `charts.presetShare.tooltip_one` | `{pct}% · {count} correction` | *(absent in ja)* | `pct:string` (pre-formatted 1 dp), `count:number` | **yes** |
| `charts.presetShare.tooltip_other` | `{pct}% · {count} corrections` | `{pct}% · {count} 件の校正` | same | **yes** |
| `charts.presetShare.empty` | No preset usage in this range yet. | この範囲ではまだプリセットの利用がありません。 | — | — |
| `charts.correctionsOverTime.title` | Corrections over time | 校正数の推移 | — | — |
| `charts.correctionsOverTime.dailyTotal` | Daily total | 日次合計 | — | — |
| `charts.correctionsOverTime.yAxis` | Corrections | 校正数 | — | — |
| `charts.correctionsOverTime.empty` | No daily corrections in this range yet. | この範囲ではまだ日次の校正がありません。 | — | — |

Month keys use lowercase 3-letter stems indexed by `Date#getMonth()` via a `MONTH_KEYS` tuple, so the
lookup stays a plain array index exactly like `MONTH_SHORT` today.

### 3.4 `models.*` — 10 keys

| Key | EN | JA | Params | Plural |
| --- | --- | --- | --- | --- |
| `models.unknown` | `(unknown)` | （不明） | — | — |
| `models.usage.empty` | No model usage in this range yet. | この範囲ではまだモデルの利用がありません。 | — | — |
| `models.usage.chartTitle` | Token usage over time | トークン使用量の推移 | — | — |
| `models.usage.barTooltip` | `{date} — {tokens} tokens` | `{date} — {tokens} トークン` | `date:string`, `tokens:number` | — |
| `models.table.model` | Model | モデル | — | — |
| `models.table.input` | Input | 入力 | — | — |
| `models.table.output` | Output | 出力 | — | — |
| `models.table.usage` | Usage | 使用率 | — | — |
| `models.table.showLess` | Show less | 表示を減らす | — | — |
| `models.table.showMore` | `Show {count} more` | `他 {count} 件を表示` | `count:number` | no |

**Total: 59 keys**, of which **10 are plural members** (5 `_one`/`_other` pairs). JA defines only the
`_other` member — `Intl.PluralRules("ja").select(n)` always returns `"other"` — so the `_one` keys are
intentionally absent from `ja/*.json` and the Chunk-11 plural-completeness guardrail must permit that.

`ModelRow.usageSharePct` (`ModelsPanel.tsx:135`) gets **no key**: the renderer prints
`formatNumber(pct, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%"`.

## 4. Test migration strategy

### 4.1 The invariant
> For every prose assertion deleted, there must exist **(a)** a descriptor assertion in the
> aggregation/view test **and (b)** a rendered-string assertion in a locale-rendering test.
> Never delete (a) without adding (b).

Coverage goes *up*: (b) covers JA too, and (a) makes implicit branch coverage explicit.

### 4.2 What stays exactly as it is
`overviewAggregations.test.ts` is 680 lines and only **~30 lines** are prose-coupled. Do **not**
rewrite the file. Leave untouched: `filterByRange`, `totalCorrections`/`totalTokens`, `costTotal`,
`activeDays`, `streaks`, `peakHour`, `favoriteModel`, `heatmapBuckets`, `intensityLevel`,
`sessionCount`, `messageCount`, all three `hourBlockHeatmap` blocks, `sevenDayHourBlockHeatmap`,
`splitModelId`, `stripModelDate`, and the `tokenActivityCalendar` data tests. That is >90% of the file.
`modelsAggregations.test.ts` needs an import rename plus two added assertions; nothing is deleted.

### 4.3 The rewrites, one by one

**(1) `test:34` + `modelsAggregations.test.ts:9`** — import `UNTITLED_PRESET_ID` / `UNKNOWN_MODEL_ID`.

**(2) `test:213-226` `perPresetBreakdown`** — `test:222` becomes:
```ts
expect(result[0]).toEqual({
  presetName: "Correction",
  presetLabel: { kind: "text", text: "Correction" },
  count: 2,
});
```
plus: the untitled row's label is `{ kind: "message", message: { key: "overview.preset.untitled" } }`.

**(3) `test:228-249` `perPresetWeights`** — keep the exhaustive `toEqual([...])` (do **not** weaken to
`toMatchObject`; the exact-array shape asserts ordering + weight completeness) and add `presetLabel` to
all three expected rows. `test:242-243` (weights sum to 1) untouched.

**(4) `test:251-279` `presetCountsOverTime`** — untouched except one added `presetLabel` assertion.

**(5) `test:476-510` month labels** — mechanical `label: "Jul"` → `key: "charts.month.jul"`. **These two
tests are business logic wearing prose clothing** and must keep their exact `column` values:
`test:476-490` encodes the "skip the partial first month so edge months don't overlap" rule;
`test:492-510` pins all 12 label column positions for a month-end `now`. Do not relax either.

**(6) `test:590-598` `benchmarkSentence` → `benchmarkMessage`** — the only genuine rewrite. Today
`toContain("50%")` is a **business-logic assertion disguised as prose**: it is the only coverage of
`Math.round((tokens/benchmark)*100)`, and `toContain("150%")` the only coverage of the `pct >= 100`
branch. Neither asserts the headroom clause. Replace and extend:

| Case | Expected `Message` |
| --- | --- |
| `benchmarkMessage(0)` | `{ key: "overview.benchmark.empty" }` |
| `benchmarkMessage(-5)` (new) | `{ key: "overview.benchmark.empty" }` — pins the `tokens <= 0` guard |
| `benchmarkMessage(50_000, 100_000)` | `withHeadroom`, `{ tokens: 50000, pct: 50, budgetK: 100, headroom: 50 }` |
| `benchmarkMessage(150_000, 100_000)` | `overBudget`, `{ tokens: 150000, pct: 150, budgetK: 100 }` |
| `benchmarkMessage(100_000, 100_000)` (new) | `overBudget`, `pct: 100` — the `>=` boundary |
| `benchmarkMessage(1_234, 100_000)` (new) | `withHeadroom`, `pct: 1`, `headroom: 99` — pins `Math.round` |
| `benchmarkMessage(1_500, 100_000)` (new) | `withHeadroom`, `pct: 2`, `headroom: 98` — round-half-up |
| `benchmarkMessage(50_000, 500)` (new) | `overBudget`, `budgetK: 0.5` — `budgetK` is `benchmark/1000` unrounded |

Assert with `toEqual` on the whole descriptor — never `toMatchObject`, or a wrong-branch key slips through.

### 4.4 New tests

| File | Asserts descriptors | Asserts rendered strings (EN **and** JA) |
| --- | --- | --- |
| `src/shared/i18n/message.test.ts` | `msg`/`textLabel`/`messageLabel` shapes; `resolveLabel` picks text vs message; `resolveMessage` forwards params | — |
| `src/renderer/components/tokenActivityView.test.ts` | `tooltipMessageForCell` for 3 modes × {0, 1, N corrections}; placeholder cell → `undefined`; `weeklyRangeOf` Sunday-start boundaries; `peakHourMessage(null)` → `overview.value.empty`, `peakHourMessage(9)` → `{hour:"09"}` | one case per mode + the singular/plural pair via `createTranslator("en")` / `("ja")` |
| `src/renderer/components/presetChartView.test.ts` | `donutTooltipMessage` singular/plural; `weightPercent` rounding | `charts.presetShare.tooltip` in en/ja for count 1 and 12 |
| `src/renderer/components/modelsView.test.ts` | `barTooltipMessage`; `showMoreMessage(true, n)` → `showLess`; `showMoreMessage(false, 3)` → `{key:"models.table.showMore", params:{count:3}}` | `models.usage.barTooltip` en/ja |
| `src/shared/i18n/dashboardKeys.test.ts` | every key this spec introduces exists in `EN_CATALOG`; every `_one` has an `_other`; every ja plural family has `_other`; placeholder sets match across en/ja per key; no non-plural key ends in a plural suffix | — |

Locale-rendering tests live at the **view-module** level (pure `.ts`, `createTranslator` imported
directly), *not* the component level (no RTL installed). One representative case per sentence family;
exhaustive per-branch coverage stays in the descriptor assertions.

### 4.5 Explicitly forbidden test weakenings
No `expect.any(Object)`/`expect.anything()` for a `Message`. No `toMatchObject` where `toEqual` is used
today. No `toContain` on a rendered string as a substitute for a descriptor assertion — that reproduces
the exact flaw being removed. No catalog snapshots; parity is asserted structurally.

## 5. Ordering + risk

### 5.1 The safe sequence

| Step | Edit | Why here |
| --- | --- | --- |
| 0 | ~~Land `translate.ts` / `format.ts`~~ | **Already done — see orchestrator amendment 1** |
| 1 | `src/shared/i18n/message.ts` + `message.test.ts` | Types used by every step below |
| 2 | **Add all 59 keys** to `en/dashboard.json` + `ja/dashboard.json` | `TranslationKey = keyof EN_CATALOG`; a descriptor with a missing key is a **compile error**, so keys must exist before any producer |
| 3 | Add `tm`/`tl` to `useI18n.ts` | Steps 6-7 call them at runtime |
| 4 | **Pilot: `modelsAggregations.ts` + test** (4 symbols, ~5 test lines) | Smallest closed loop; proves the descriptor shape before the 23.8KB file |
| 5 | `overviewAggregations.ts` in three passes, each with its test edits in the **same** pass: (a) `UNTITLED_PRESET_ID` + `presetLabel`, (b) `monthLabels[].key`, (c) `benchmarkMessage` | Each sub-step is independently green |
| 6 | Create the three view modules + tests (2.3) — descriptors from day one | Step 7 imports them |
| 7 | Wire the components: `OverviewPanel.tsx` → `ModelsPanel.tsx` → `PresetWeightChart.tsx` | `PresetWeightChart` last — memoisation minefield |
| 8 | Formatting sweep inside these three files only: `toLocaleString()` → `formatNumber`, `toLocaleDateString` → `formatDate` | Earlier means editing the same lines twice |
| 9 | `dashboardKeys.test.ts`; full lint + test | — |

### 5.2 What breaks if done out of order
- **Aggregations before keys (5 before 2):** every `msg("overview.…")` is a type error at once; the
  23.8KB file goes fully red with no incremental green path, and the implementer will be tempted to
  cast to `TranslationKey` — which permanently defeats the type check.
- **Components before `I18nProvider`:** `useI18n()` throws at render. Unit tests are pure and stay
  green, so this ships silently broken.
- **Renaming `UNTITLED_PRESET_LABEL` without the same-pass consumer update:** `presetName` feeds React
  `key`s *and* Chart.js dataset labels (`PresetWeightChart.tsx:147` donut, `:205` stacked bar). The
  sentinel `"__untitled__"` renders literally in both legends if `presetLabel` is not wired
  simultaneously — loud in dev, **invisible in tests** (the charts have no unit tests).
- **`TokenActivityCalendarMonthLabel.label` → `.key` without updating `OverviewPanel.tsx:320-330`:**
  compile error (good), but line 322's React `key` prop also reads `label.label` — update both.

### 5.3 Trap list
1. **`PresetWeightChart.tsx:106` — `toLocaleDateString(undefined, …)`.** `undefined` resolves to the
   **OS** locale, not the app locale. Replace with `formatDate(date, { month: "short", day: "numeric" })`.
2. **Memoised strings go stale on locale switch — the single biggest risk in this chunk.**
   `PresetWeightChart.tsx:135-301` builds *all* labels, titles, axis titles and the tooltip callback
   inside one `useMemo` with deps `[weights, overTime, paletteTick]`. After migration that memo closes
   over `t`, `formatDate`, `formatNumber`; **`locale` (or `t`) must be added to the dep array**, exactly
   as `paletteTick` exists for themes. Otherwise switching language leaves the whole chart in the old
   language until the data changes. Review `ModelsPanel.tsx:47-56` the same way. **Mitigation rule:**
   keep `OverviewPanel.tsx:196-210`'s `view` memo **string-free** (descriptors only) and resolve
   descriptors during render, outside `useMemo`.
3. **`ModelSelect.tsx:262-271` — hardcoded `.toLocaleString("en-US", { style: "currency" … })`.** Owned
   by the settings/models agent, not this chunk. Do not edit that file.
4. **date-fns needs an explicit `locale`.** `format()` defaults to English for any textual token.
   Pass `{ locale: dateFnsLocale }` everywhere **except** `useFuzzySearch.ts:33` — that string is a
   **search haystack**, not UI; localising it changes fuzzy-match behaviour per language and makes the
   index non-deterministic. Leave it and add a `// locale-free on purpose` comment.
5. **Tests must be pure `.ts`.** `@testing-library/react` is **not** installed, so components cannot be
   rendered in a test at all — that is why 2.3 exists. Do not add RTL in this chunk.
6. **ICU data.** JA formatting silently degrades to English if the Node build lacks full ICU. Already
   smoke-asserted in `format.test.ts`.
7. **Timezone.** Aggregation tests build local-time timestamps. `formatDate` must receive a local
   `Date` built from the day key, never the ISO string.
8. **Plural key hygiene.** Because `PluralBaseKey` strips a trailing plural suffix, **no non-plural key
   may end in one.** None of the 59 do; the Chunk-11 guardrail must assert it for future keys.
9. **`params` object identity.** `msg()` returns a fresh object per call, so descriptors are not
   reference-stable. Never put a `Message` in a `useMemo` dep array or a `React.memo` prop compare
   without a custom comparator — compare the underlying `key`/count.
10. **`title` / `aria-label` need strings.** `OverviewPanel.tsx:299-300` passes the same value to both.
    Resolve once per cell into a local `const` and pass the string twice; do not call `tm()` twice.

### 5.4 Definition of done for this chunk
- `overviewAggregations.ts` and `modelsAggregations.ts` contain **zero** English sentences, zero
  `toLocaleString`, zero `Intl.*`, zero date-fns.
- Their tests contain **zero** English display strings (model ids, preset names and the
  `__untitled__`/`__unknown__` sentinels excepted).
- All 59 keys exist in `en`, and all but the 5 `_one` members in `ja`.
- `bun run lint` + `bun run test` green.
