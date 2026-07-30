---
name: fixlang-usage-analytics
description: "Use when editing the Usage tab, the OpenAI/OpenRouter usage panels, the tray Providers card, or the Overview/Models analytics. Examples: \"add a usage card\", \"why is OpenAI missing a per-model cost\", \"tray shows a duplicate provider card\", \"add a range-aware dashboard tab\". Covers src/renderer/components/usage/, src/main/llm/providers/*/usage*, src/renderer/TrayWindow/."
---

# FixLang — Usage, Analytics & Tray Gotchas

Code: `src/renderer/components/usage/` (`usageTabs.ts`, `UsageCharts.tsx`, `usageChartView.ts`), `src/main/llm/providers/openai/usage.parsers.ts`, `src/renderer/TrayWindow/components/TrayProviderSummary.tsx`, `src/renderer/TrayWindow/TrayWindowMain.tsx`, `src/renderer/components/{OverviewPanel,ModelsPanel,ModelsCharts}.tsx`, `MainWindow/dashboardTabs.ts`.

## Sub-tab visibility is pure logic, shared with the tray

`usage/usageTabs.ts` (`buildUsageSubTabs`) decides which providers get a Usage sub-tab and in what order — keyed providers first, then `PROVIDER_ORDER`. Only usage-capable providers qualify (`supportsUsage`: OpenAI, OpenRouter; Bedrock and the local ones bill nothing here). The tray Providers card reuses that same builder, so the two surfaces cannot disagree about which providers have an account.

Each panel owns its 7d/30d pills, one combined IPC call, and a 60s TTL cache (`openrouter-analytics`, `openai-usage`).

## OpenAI's cards are deliberately NOT symmetric with OpenRouter's

The MONEY RULE lives in `providers/openai/usage.parsers.ts`. OpenAI exposes no credit-balance or key-limit endpoint, and `/organization/costs` groups by `line_item` / `project_id` but NEVER by model. Therefore:

- Per-model table carries **tokens only** — no per-model dollar figure is estimated.
- The donut slices **line items**, not models.
- No balance/limit card exists to build.

`project_id` is the one non-line-item grouping, so **per-project spend IS real billed dollars**: a per-project table lives INSIDE the Spend card (one total and the projects it splits into — two separate spend headings read as duplicated sections) plus a project-share donut, requested as its OWN `/costs` call rather than a second `group_by` on the line-item one. The card therefore holds TWO `CardResult`s: `CardShell` draws the frame and one `CardBody` per request gates its own half, so a failed breakdown cannot blank a good total or vice versa.

Project names come from `/organization/projects` with `include_archived=true` (an archived project still carries range spend). That endpoint paginates by `after=<last_id>`, NOT the `next_page` cursor the usage endpoints use — hence the separate `nextAfterCursor`. The lookup is skipped when nothing was billed, and a failed lookup degrades a row to its raw `proj_…` id instead of sinking the card.

Still spend, never balance: no per-project budget or credit endpoint exists to read.

## Which OpenAI project is not discoverable

An admin key is organization-scoped and OpenAI exposes no endpoint naming the project behind a key, so `SettingsStore.openaiProjectId` is a **user-supplied** setting (validated by `shared/openaiProject.ts`, submitted through `connect-provider`, cleared on profile export as account-local detail).

A project absent from `projectCosts.projects` renders "no spend", never `$0.00` — `parseProjectCosts` drops zero-cost projects, so "absent" also covers "unknown project", and a dollar figure would assert something `/costs` never said.

## Tray: only the ACTIVE provider tab mounts

`TrayProviderSummary.tsx` renders one tab per provider but mounts only the active tab's body. That is what keeps opening the tray to ONE request instead of one per provider.

## Two tray siblings keyed by `profileId` need DISTINCT key prefixes

`TrayWindowMain.tsx`: `useActiveProfileId` returns `""` until its IPC resolves. Two siblings sharing the key `""` collide in React's reconciliation map (keyed by `key`, so the second evicts the first), and when the key flips to the real id the evicted fiber is never deleted — its DOM node stays behind as a **duplicate card**. Production React logs no duplicate-key warning, so nothing surfaces it but a rendered count: `TrayWindowMain.test.ts` asserts one card and pins the distinct-prefix arrangement.

## Dashboard analytics

Dashboard tabs live in `MainWindow/dashboardTabs.ts` (overview, history, models, usage, logs, about). Overview and Models share the All/30d/7d range via `RANGE_AWARE_TABS` in `MainWindow/App.tsx` — a new range-aware tab must be listed there or its pills silently do nothing.

Overview's Total-tokens card carries an N/A-aware estimated cost hint (`overviewCostView.ts`): partial coverage renders "Est. $X · N of M priced" rather than pretending unpriced transforms cost nothing. Same honesty rule as `ai.request/cost.ts` — see [Provider credentials](../fixlang-provider-credentials/SKILL.md).
