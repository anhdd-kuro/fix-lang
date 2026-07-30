# FixLang — Instructions

## Overview

Local macOS menu-bar app: fixes grammar and improves writing on selected text via AI (OpenAI, OpenRouter, Ollama, LM Studio). Electron + React + TypeScript, runs on **bun**.

## Main Features

- **Transform** — fix grammar/style or otherwise rewrite selected text via per-preset global hotkeys.
- **Source-app context** — Transform and PromptGen append the frontmost app name ("Slack", "Mail") to the **system prompt** (`src/main/ai.request/transform-context.ts`), so the model can match that app's register. Best-effort: dropped entirely when the read fails or FixLang itself is frontmost, leaving the system prompt byte-identical. Every read is logged under scope `accessibility.activeApp` (debug on read/drop, warn on failure). The block carries an `AppContextFormattingPolicy` (`"preserve-input-markup" | "adapt-to-app"`), resolved per preset by the pure `appContextPolicyForPreset(presetId)`; only the `structured-text` built-in gets `adapt-to-app`, and every other preset plus PromptGen keep the default `preserve-input-markup` variant — whose wording is byte-identical to the pre-policy block, which is load-bearing (it is what keeps every other preset's and PromptGen's prompt unchanged) and is pinned by a literal-string test.
- **Presets** — built-in Correction, Summarize, Translate, Prompt optimization, Business Writing, Context-Aware Structured Text; each preset has its own hotkey, model, system prompt, and Faster↔Smarter reasoning effort (AI SDK `reasoning`: minimal/low/medium/high/xhigh).
- **Prompt generation** — build AI prompts from selected text (PromptGen window).
- **Profiles** — switch transform presets; switch reloads hotkeys + settings + history.
- **Multi-provider** — connect multiple providers (OpenAI, OpenRouter, Ollama, LM Studio) at once, each with its own model discovery/compat/monitor; every connected provider appears in a grouped model picker; a preset can use any connected provider; model ref is composite `<providerId>::<rawModelId>` in config, raw id downstream. Each provider owns a folder under `src/main/llm/providers/` and one entry in that folder's `index.ts` capability registry (`supportsAdminKey`, `supportsUsage`, `fetchModels?`, `makeRequest?`); `ai.request/shared.ts` dispatches THROUGH the registry, so a new provider adds no branch there. The registry's behaviour slots load their module via lazy `import()` on purpose — `~/main/llm` is imported for the Ollama client alone, and eager loading drags the provider SDKs and `electron-store` in with it.
- **Admin keys** — `PROVIDER_SUPPORTS_PROVISIONING_KEY` now covers **OpenAI (Admin API key) and OpenRouter (provisioning key)**. The slot, its settings field, profile-delete cleanup, and the disconnect warning are all derived from that table (`secretKindsForProvider`), so flipping it is what adds a provider. Every accessor in `provisioningKeyStore` and all three IPC channels take an explicit `ProviderId` — never defaulted, because a missed argument would silently read/write another provider's key. Each field carries a "where to get this key" link to the provider's own console, held with the label/placeholder keys in `ADMIN_KEY_MESSAGE_KEYS` (`renderer/components/providerCards.ts`) and opened via `openExternalLink` — main only permits http/https, so a mistyped scheme makes the link a silent no-op, which `providerCards.test.ts` asserts against. **Provider-scoped storage is not the same as a provider-correct value**: a key pasted into the wrong slot used to store fine and show "Key set" (existence is all `hasProfileSecret` can see without decrypting), then 401 forever. `shared/providerKeyShapes.ts` classifies a key by prefix and `findKeyShapeMismatch(provider, kind, raw)` refuses a positively-identified foreign one at BOTH the `connect-provider` handler and `setProfileSecret` (the chokepoint a future writer cannot skip). An **unrecognized** format is still accepted on purpose — refusing it would lock out legacy `sk-…` keys and any future format.
- **Credential requests are logged, keys never are** — every admin-request (`provider.openai.admin`, `provider.openrouter.admin`) and model-list fetch (`provider.models`) logs the key's *shape label*, plus `storedKeyBelongsToAnother{Provider,Slot}` when a pre-guard key is still on disk. That flag is the whole diagnosis for an otherwise opaque `Unauthorized`. Log the shape, never the value, and keep labels free of a `sk-…` prefix: `redactLogMessage` would rewrite them to `[REDACTED]`. **A provider 401 body quotes the submitted key back partially starred** (`Incorrect API key provided: sk-abc12*********wxyz`), and the `sk-…` pattern alone CANNOT catch that — the star run interrupts it one character before its 6-char minimum, so a short visible prefix used to reach the persisted JSONL. `redactLogMessage` now strips the whole masked token first (`MASKED_SECRET_RUN`), and `logModelFetch` additionally splits the exact key out of provider error text, because a key with no recognizable prefix (LM Studio's) matches no pattern at all.
- **History** — SQLite-backed transform + PromptGen history with cost tracking. Each new entry may store a `sessionJson` raw completion snapshot (prompts, reasoning effort, responses, usage) shown via the History row eye / Show details control.
- **Analytics** — Overview dashboard: stat cards, preset donut/time-series charts (`PresetWeightChart`), token activity calendar; shared All/30d/7d range with Models tab (`RANGE_AWARE_TABS` in `MainWindow/App.tsx`). Models tab: Chart.js token-usage bars (axis labels + caption) and **Model Breakdown** (share donut above the ranked table) in `ModelsCharts.tsx` / `ModelsPanel.tsx`. Dashboard tabs: overview, history, models, usage, logs, about (`MainWindow/dashboardTabs.ts`).
- **Usage** — account-level spend/usage, one sub-tab per **connected** usage-capable provider (OpenAI, OpenRouter; the local ones bill nothing). Sub-tab visibility/order is pure logic in `renderer/components/usage/usageTabs.ts` — keyed providers first, then `PROVIDER_ORDER`. Each panel owns its 7d/30d pills, combined IPC and 60s TTL cache (`openrouter-analytics`, `openai-usage`); the three charts live in `usage/UsageCharts.tsx` over pure builders in `usage/usageChartView.ts`. **OpenAI's cards are deliberately not symmetric with OpenRouter's**: OpenAI exposes no credit-balance or key-limit endpoint, and `/organization/costs` groups by `line_item`/`project_id` but NEVER by model — so its per-model table carries tokens only, its donut slices line items, and no per-model dollar figure is estimated (see the MONEY RULE in `providers/openai/usage.parsers.ts`). **`project_id` is the one non-line-item grouping, so per-project spend IS real billed dollars** — a per-project table **inside** the Spend card (one total and the projects it splits into; two separate spend headings read as duplicated sections) plus a project-share donut, requested as its OWN `/costs` call rather than a second `group_by` on the line-item one. The card therefore holds TWO `CardResult`s: `CardShell` draws the frame, and one `CardBody` per request gates its own half, so a failed breakdown cannot blank a good total or vice versa. Names come from `/organization/projects` (`include_archived=true`: an archived project still carries range spend), which paginates by `after=<last_id>`, NOT the `next_page` cursor the usage endpoints use — hence the separate `nextAfterCursor`. That lookup is skipped when nothing was billed, and a failed lookup degrades a row to its raw `proj_…` id instead of sinking the card. Still spend, never balance: no per-project budget or credit endpoint exists to read.
- **Logs** — structured, redacted JSONL persistence (`userData/logs/{YYYY-MM-DD}/fixlang.jsonl`); Logs tab with multi-select level filter (`LogQueryRequest.levels`; empty array = every level), search, copy/export, virtual infinite scroll, timezone stated once in the footer instead of per row.
- **Hotkeys** — customizable global shortcuts (promptGen, profileSwitch) plus per-preset transform hotkeys. `normalizeCorrectionSettings` is the single funnel that keeps a **default-sourced** preset hotkey from colliding: it is relinquished when a stored preset already claims it, or when it equals a (remappable) `promptGen`/`profileSwitch` binding — the latter would otherwise show in Settings as assigned while `registerCorrectionShortcut` skips it as reserved. A **stored** hotkey is never rewritten there; that stays the pre-save `validateHotkeys` gate's job.
- **About** — the tab is a two-sub-tab shell (`renderer/components/about/AboutPanel.tsx`, same pattern as `UsagePanel`): **App updates** (`SettingUpdates`) stays first and is the default, because the tray's update button and every release link land here expecting the update controls. **User guide** (`UserGuidePanel`) is onboarding copy that reads the user's REAL config — presets and their hotkeys, output mode, connected providers, profile-switch binding — so an edited preset can never leave the guide describing defaults the app no longer uses; those reads fire only once the guide sub-tab is opened. It also explains why History/Usage can look empty (Connect vs Admin/Provisioning) with an **Open settings** button to General. It also explains why History/Usage can look empty (Connect vs Admin/Provisioning) with an **Open settings** button to General. Derivations stay pure in `about/userGuideView.ts`, which reuses `DASHBOARD_TABS` label keys and the Settings radio's own output-mode strings rather than restating either. Every topic title under "Settings worth knowing" and every row title under "Where to look afterwards" is a primary-link `Button` (`onOpenSettings(tabId)` / `onNavigateToTab(tabId)`) so the guide is also a navigation shortcut, not just a description — `GUIDE_TOPICS` in `userGuideView.ts` carries the target `SettingsTabId` per topic.
- **Updates** — the dashboard's **About** tab (`SettingUpdates`, not a Settings-modal tab) checks Homebrew for cask installs and GitHub Releases for manual DMG installs; cask installs get a one-click **Update now** that delegates to `brew upgrade --cask fixlang` (`src/main/update/homebrew.ts`). Tray toolbar has a check-only button that reports via native dialog. No self-updater.

## Purpose

User data stays local — API keys, history, and logs never leave the machine except to the providers a profile has connected, and each provider only ever sees its own key. Profile and hotkey state must stay consistent across switches; silent breakage there is worse than a loud failure.

## Scope & Key Resources

Electron app with main/preload/renderer split. Highest-risk areas: global hotkeys + profile state, IPC validation, AI prompt bundling, theme derivation, and userData persistence.

### Structure

```
fix-lang/
├── src/
│   ├── main/               — Electron main process
│   │   ├── ai.request/     — cross-provider: model cache, request routing, cost, requestTypes
│   │   ├── ipc/features/   — IPC handlers (api, correction, history, logs, …)
│   │   ├── keybindings/    — global hotkeys (presets, promptGen, profileSwitch)
│   │   ├── logging/        — structured JSONL write/query
│   │   ├── llm/
│   │   │   ├── models/     — cross-provider discovery/compat/monitor
│   │   │   └── providers/  — one folder per ProviderId + index.ts capability registry
│   │   │                     (openai, openrouter: models/request/usage; ollama, lmstudio: client/request)
│   │   ├── update/         — Homebrew probe/fetch/upgrade + pending-update marker
│   │   └── webViewWindows/ — main, promptGen, overlay, tray
│   ├── renderer/           — React UI (MainWindow dashboard, TrayWindow, …)
│   ├── preload/features/   — IPC bridge (validate here)
│   ├── stores/             — historyDb (sqlite), apiStore, keybindingStore
│   ├── prompts/            — bundled AI prompt assets (build-time)
│   └── shared/             — Electron-free, shared across main/preload/renderer
│       ├── providers.ts    — provider identity, card/group ordering, model filtering
│       ├── modelRef.ts     — parse/format/resolve composite refs (`<providerId>::<rawModelId>`)
│       ├── logging.ts      — log types + redaction
│       ├── features.ts     — build-time feature tags
│       └── bundleExternals.ts — bundle-externals scanner core (unit-tested)
├── scripts/                — bun CLIs: check-bundle-externals, i18n-check, theme gen
├── .github/workflows/release.yml — tag → checks → DMG → validate → publish
├── README.md               — user-facing features and usage
└── .claude/skills/fixlang/ — project-specific traps (read on demand)
```

## Tech Stack

- Runtime/build
  - Electron 43.2, electron-vite 5.0, Vite 8.1, bun
- Frontend
  - React 19.2, TypeScript 6.0 (stay on 6.x until typescript-eslint supports 7), Tailwind 4.3
- AI
  - openai 6.49, @ai-sdk/openai 4.0, @openrouter/ai-sdk-provider 3.0, ai 7.0, ollama 0.6 — each wired in its own `src/main/llm/providers/<id>/request.ts` and reached through the capability registry; LM Studio and Ollama both use a configurable local host/port (LM Studio via OpenAI-compatible `baseURL`; Ollama via its daemon URL)
- Persistence
  - node:sqlite (history) + electron-store 11 + JSONL logs under userData — no zustand
- Testing
  - Vitest 4.1, jsdom

## Key Commands

```bash
bun run dev             # hot reload (predev runs build)
bun run test            # verify changes — use `bun run test`, not `bun test`
bun run lint            # ESLint (cached)
bun run pack:mac        # dev-identity app → release/mac-arm64/FixLang Dev.app
bun run pack:mac:prod   # production-identity app (pack:install builds this one)
bun run check:bundle    # after `bun run build` — no runtime dep may need node_modules
bun run themes:generate # after theme .ts edits
bun run i18n:check      # catalog parity/plural/sort audit + JA coverage
bun run build:promptgen # feature-tag build (also dev:promptgen, pack:mac:promptgen)
```

- **The packaged app ships no `node_modules`** (`build.files` excludes it) — every runtime dependency must be inlined by Vite into `out/`. Adding a dependency and importing it passes `dev`, `test`, and `lint` unchanged; only `bun run check:bundle` against a real `bun run build` catches a dependency Vite left external. The scanner lives in `src/shared/bundleExternals.ts` (AST walk via the TypeScript compiler API, not a regex); `scripts/check-bundle-externals.ts` is a CLI-only wrapper that runs under **bun**, whose TS parser differs from vitest's esbuild — which is why an integration test drives that exact file under bun. `ALLOWLIST` is empty on purpose: an entry hides a `MODULE_NOT_FOUND` for users instead of fixing it. Every packaging script (`pack`, `pack:mac`, `pack:mac:prod`, `release:mac`) runs the check. See [Bundle externals](.claude/skills/fixlang/fixlang-bundle-externals/SKILL.md).
- **`dependencies` vs `devDependencies` no longer signals what ships** — nothing resolves from `node_modules` at runtime, so the split is bookkeeping only; what ships is whatever Vite inlined into `out/`. Do not "fix" a runtime import by moving its package between the two sections.
- **Feature tags are opt-in** — features listed in `src/shared/features.ts` are excluded unless the build carries their tag (`FIXLANG_FEATURES=promptgen` env, or `--promptgen` CLI). Flag-off builds emit no renderer bundle for the feature and skip its hotkey, IPC handlers, and settings tab. Read flags at runtime via `isPromptGenEnabled()`, never `__FEATURE_PROMPT_GEN__` directly (the define is absent under vitest). Plain `bun run build` (what the release workflow runs) ships PromptGen OFF.

## Internationalization (i18n)

The app supports **English** and **Japanese** (easily extensible to a third language). All user-facing text in the renderer and main process is translatable via `t()` (renderer) or `mainT()` (main process).

### Catalog structure

Translation strings live in `src/shared/i18n/locales/{en,ja}/` as per-namespace JSON files (`common.json`, `dashboard.json`, `tray.json`, `notifications.json`, etc.). This split prevents merge conflicts when separate features add keys to the same catalog.

- Keys are globally unique and dotted (`"settings.general.language.label"`).
- English (`en/`) is the source of truth — every key must exist there; Japanese (`ja/`) may be partial (missing keys fall back to English).
- Both catalogs are merged at build time into `EN_CATALOG` and `JA_CATALOG` in `src/shared/i18n/locales/index.ts`.
- Key names are type-checked at compile time: `t("key")` is a compile error if `"key"` is absent.

### Add a translatable string (recipe)

1. **English**: Add the key-value pair to `src/shared/i18n/locales/en/{namespace}.json`:

   ```json
   { "overview.stat.sessions": "Sessions" }
   ```

2. **Japanese**: Add the translation to `src/shared/i18n/locales/ja/{namespace}.json`:

   ```json
   { "overview.stat.sessions": "セッション" }
   ```

3. **Use it**: The key is type-checked at compile time — a typo will be caught by the TypeScript compiler and displayed in your editor:

   ```tsx
   import { useI18n } from "~/renderer/i18n/useI18n";
   const { t } = useI18n();
   <h1>{t("overview.stat.sessions")}</h1>
   ```

### Plurals

English defines both singular and plural variants; Japanese defines only the plural (other) variant. Use the base key plus a numeric `count` param:

```json
// en/history.json
{ "history.count_one": "{count} transform", "history.count_other": "{count} transforms" }

// ja/history.json
{ "history.count_other": "{count} 件の変換" }
```

```tsx
const { t, formatNumber } = useI18n();
// Calls t("history.count_one") if count is 1, t("history.count_other") otherwise;
// the raw count is never shown, so never pass count as a string.
t("history.count", { count: 12 })  // "12 transforms" (EN) / "12 件の変換" (JA)
```

### Number and date formatting

`t()` locale-formats every numeric param automatically (grouping separators, native digits). Pre-formatted values (currency, dates, fixed decimals) are passed as strings so they are not re-formatted:

```tsx
const { t, formatCurrency, formatDate } = useI18n();
t("overview.tokenBudget", {
  tokens: 123456,           // auto-formatted: "123,456" (EN) / "123,456" (JA)
  pct: 50,
  budget: 100_000,
});

// For dates and currency, format first, pass as string:
t("model.lastUsed", {
  date: formatDate(new Date()),      // "Jul 25, 2026" (EN) / "2026年7月25日" (JA)
  cost: formatCurrency(12.5, "USD"), // "$12.50"
});
```

### Adding a third language

Add the language to `LOCALE_CODES` and `LOCALE_META` in `src/shared/i18n/registry.ts`; then create one JSON file per namespace under `src/shared/i18n/locales/{code}/` (e.g., `src/shared/i18n/locales/fr/common.json`). The language picker grows automatically; IPC, formatters, and storage need no changes.

### Main process strings

Notifications and window titles are built in the main process, which has no React context. Use `mainT()` instead of `useI18n()`:

```ts
import { mainT } from "~/main/i18n";

new Notification({
  title: mainT("notification.title"),
  body: mainT("notification.body", { name: "John" }),
}).show();
```

### Locale persistence and broadcast

- The user's locale choice is persisted via `electron-store` in `src/stores/localeStore.ts`.
- On first run, the system locale (from `app.getLocale()`) is auto-detected and stored.
- Changing the language via Settings broadcasts the new locale to every open window (tray, dashboard, PromptGen) via IPC, so they update immediately without an app restart.
- See `src/main/ipc/features/locale.ts` for the IPC handlers; `src/preload/features/locale.ts` for the bridge; `src/renderer/i18n/I18nProvider.tsx` for the context subscription.

## How to Work

- **Use bun** — not npm/pnpm; lockfile is `bun.lock`.
- **Explore with gitnexus first** — use MCP over grep/find; fallback only if unavailable.
- **Verify before finishing** — run `bun run test`; for UI changes, also check in `bun run dev` before packaging.
- **Ask through tools** — use structured question tools, not plain-prose questions.
- **Update docs when behavior changes** — spawn sub-agents or update instruction files at task end.
- **Commits** — Conventional Commits on `feature/*` or `fix/*` branches from `main`.
- When user ask for "Ship as new version", you should:
  - Check version & Release as new version in main repository.
  - Manually trigger brew cask update sync.
  - Wait and confirm the new version is available in the cask.

## Boundaries

✅ Always:

- Work in the work tree if the user does not ask for a new branch or directly mention a branch name.
- Keep prompts bundled locally from `src/prompts/` — no runtime fetch.
- Store SQLite/JSONL under `app.getPath("userData")` — never inside the signed bundle.
- Use async I/O only in the main process.
- Consider spawning sub-agents to avoid flooding the main agent context window.
- Write gotchas in caveman style.
- Anything unclear after exploring — use batch-grill-me before guessing.
- Before declaring tasks done:
  - Spawn fresh sub-agent to review the changes before committing.
  - Run linting and testing to verify changes.
  - Update AGENTS.md instructions if needed.
- Use clear function and variable names so the code speaks for itself. **Avoid comments to code** unless they are absolutely necessary to explain non-obvious intent or constraints. Prioritize readability through naming, structure, and small, focused functions.

⚠️ Ask first:

- Before deleting important files, ask for confirmation.

🚫 Never:

- Commit secrets, `.env`, `node_modules`, `out/`, `release/`, `coverage/`, or agent scratch space (`.scratch/`, `.claude/settings.local.json`) — all gitignored.
- Reintroduce pnpm or bypass preload IPC validation.
- Use `any` without a why-comment.
- Bump TypeScript to 7.x until ESLint support lands.

## CI

- **PR + push to `main`** — `.github/workflows/ci.yml` runs `bun run lint` then `bun run test` on `ubuntu-latest` (Bun 1.3.14, Node 24 for `node:sqlite`). Concurrency cancels superseded runs. Release packaging stays in `release.yml` only.

## Release & Distribution

- **Trigger** — bump `package.json` to a strictly higher stable semver, PR to `main`, merge. Push to `main` fires `.github/workflows/release.yml` (`prepare` on ubuntu creates the `v<version>` tag; `release` on macos-14 runs lint → test → `i18n:check` → build → `check:bundle` → DMG, validates the DMG, publishes `FixLang-<v>-arm64.dmg` + `SHA256SUMS.txt`). The DMG is compressed with ULFO (LZFSE) via `build.dmg.format` and ships only the `en`/`ja` Electron locale paks (`build.mac.electronLanguages`); with `node_modules` gone from `app.asar` that lands at ~102 MiB. Between *Build renderer and processes* and *Build unsigned arm64 DMG*, a `bun run check:bundle` step AST-scans the built CommonJS for bare `require()` specifiers so a future dynamic dependency cannot silently become a `MODULE_NOT_FOUND` in a shipped app. Docs-only pushes no-op (version already public).
- **The DMG validation step is the packaged-artifact half of that guard** — it mounts the image, matches `CFBundleShortVersionString` against `package.json`, then asserts via `bunx @electron/asar list` that `app.asar` holds **no** `/node_modules/` entries and **does** hold `/out/renderer/` (a missing renderer ships a white-screen app). `@electron/asar` is a declared devDependency on purpose: the bare `asar` bin was only hoisted transitively through electron-builder, and `bunx asar` would otherwise fetch the deprecated standalone package from the registry.
- **Homebrew** — public tap `anhdd-kuro/homebrew-tap` auto-syncs verified releases into `Casks/fixlang.rb`; users run `brew install --cask anhdd-kuro/tap/fixlang` and `brew update && brew upgrade --cask fixlang`. arm64-only, unsigned — never automate Gatekeeper/`xattr`.
- **In-app update** — `updates:install` starts a detached `/bin/sh` helper that waits for FixLang to exit, runs `brew update && brew upgrade --cask fixlang` (`NONINTERACTIVE=1`), then reopens the app; the app quits itself right after. brew is resolved only from `/opt/homebrew/bin/brew` or `/usr/local/bin/brew` (never PATH), and the button is off unless `<prefix>/Caskroom/fixlang` exists. A `pending-update.json` marker under `userData` reports a stalled upgrade on the next launch; helper output goes to `userData/logs/homebrew-update.log`.
- **The check asks Homebrew, not GitHub** — for a cask install `checkForUpdates` offers `HomebrewUpgrader.getInstallableVersion()`, because Homebrew is what the button runs. GitHub is queried in parallel but only supplies release notes and the DMG size, and only when it describes the exact version being offered. A published release the tap has not synced yet is reported as `up-to-date` + `tapPendingMessage`, never as an offer — but it still carries that release's notes and points `getReleaseUrl()` at its tag, so the panel shows what changed next to a **Download from GitHub** button. Only the DMG size is withheld, because the download bar it feeds belongs to an install that cannot start. Cost control: the routine check reads the local tap clone (`getInstallableVersion(false)`, no `brew update` — that is a git fetch across every tap) and pays for one refresh only when GitHub shows something newer. Manual DMG installs, and casks whose brew probe returns null, still fall back to GitHub.
- **Two version sources** — **GitHub Releases** is what publishes a version (and, for manual DMG installs, what the check reads), the install runs **the Homebrew tap**, and the tap lags the release (cron, up to 6h). `installUpdate` therefore probes `brew info --cask fixlang --json=v2` (after `brew update`) and refuses to quit when the tap is still behind. Never delete that gate: `brew upgrade` exits **0** on "already installed", so without it the app quits and reopens unchanged and the button looks dead. A null/unparseable probe means "unknown" → proceed; only a *parsed lower* version blocks.
- **An unchanged version on relaunch is not proof of failure** — the app quits in under a second, Homebrew keeps downloading ~101.6 MiB for a minute or more, and a user who reopens FixLang meanwhile lands in `reconcileLastInstall` with the old bundle still in place. Treating that as failure clears the marker, shows "Homebrew did not finish the last update", and re-arms the button, so the next click starts a second `brew upgrade` that dies on the first one's **download lock**. The marker therefore carries `startedAt`, and reconcile returns `in-progress` (keep marker, keep the button inert, poll the Caskroom) until either `<prefix>/Caskroom/fixlang/<target>` appears → `restart-required`, or `UPGRADE_GRACE_MS` (20 min) passes → `failed`.
- **Download happens while the app is alive** — `installUpdate` runs `brew fetch --cask fixlang` first (fills the download cache only, installed bundle untouched) and publishes a `downloading` phase with byte progress read by `statSync` from `<HOMEBREW_CACHE>/downloads/*--FixLang-<v>-arm64.dmg[.incomplete]`. Progress is read from the growing cache file, never parsed out of brew's output, and the denominator is the GitHub release asset `size`. Only after the fetch succeeds does the app quit; the detached helper then just runs `brew upgrade` off the cache (no `brew update` — the tap probe already refreshed it), so the app is away for seconds instead of a minute.
- **`open -b` cannot replace a running app** — the helper's closing `open -b com.fixlang.app` resolves with `preferIdentical`, so when FixLang is already running it merely *focuses* the stale process while `/Applications` already holds the new bundle. That is why the `restart-required` phase exists, and why its restart re-executes `process.execPath` (`app.relaunch()` + `app.exit(0)`) instead of shelling out to `open`.
- **The bundle id is not a unique app** — a `pack:mac` build sitting in a checkout used to carry `com.fixlang.app` too, so the helper's closing `open -b` could reopen *that* copy right after a successful upgrade, and the user landed on an older version. Two defences: the helper reopens the recorded `.app` path (`open -a "<path>"`, id only as fallback), and `pack:mac` now builds as `com.fixlang.app.dev` / `FixLang Dev` (use `pack:mac:prod` for a production-identity local build; `pack:install` already does). Dev builds still share `userData` — the packaged `package.json` keeps `name: fix-lang`, which is what `app.getName()` reads.
- **A changed version is not proof of success** — `reconcilePendingInstall` compares against `toVersion` and against the recorded `appPath`, not merely "differs from `fromVersion`"; otherwise reopening a stray *older* copy reports as a completed update. A mismatched path yields `wrong-bundle` → `restart-required` carrying `wrongBundleMessage`, and that restart opens `pending.appPath` instead of re-executing `process.execPath` (which would just relaunch the wrong copy forever).
- **Traps** — release Test step needs Node 24 on macos runners (`node:sqlite` builtin); tap cask generation + `brew style/audit` have several traps. See the gotcha below before touching release or tap code.

## References

- [README](README.md) — features, dashboard tabs, hotkeys, build/install.

## Known Gotchas

Project-specific traps under `.claude/skills/fixlang/`:

- [Hotkeys](.claude/skills/fixlang/fixlang-hotkeys/SKILL.md) — preset hotkey reload on profile switch (silent failures) + pre-save conflict validation + frontmost-app read must precede the overlay spinner.
- [i18n](.claude/skills/fixlang/fixlang-i18n/SKILL.md) — JSON values widen to `string` (params not type-checked); tests must be `.test.ts` (no RTL); aggregations return descriptors; memoized callbacks over `t` or formatters must list them in deps; `date-fns` needs explicit `{ locale }`; main process uses `mainT()`, not `useI18n()`.
- [Prompt bundling](.claude/skills/fixlang/fixlang-prompt-bundling/SKILL.md) — prompts bundle at build time from `src/prompts/`, not `~/.agents/`; rebuild + reinstall to apply.
- [Profile state](.claude/skills/fixlang/fixlang-profile-state/SKILL.md) — profile switch must atomically reload hotkeys + settings UI + history; connecting a provider does NOT wipe presets.
- [Model refs](.claude/skills/fixlang/fixlang-model-refs/SKILL.md) — composite ref `<providerId>::<rawModelId>` lives in config only; SQLite history and downstream API calls get the raw id only. Leaking the prefix into a `startsWith` check gives a silent wrong answer with no error.
- [Theme mapping](.claude/skills/fixlang/fixlang-theme-mapping/SKILL.md) — derive-ladder + composite-alpha strategy; run `bun run themes:generate` after theme .ts edits, then `bun run test` to validate all 149 themes.
- [Package upgrade](.claude/skills/fixlang/fixlang-pkg-upgrade/SKILL.md) — wave-based bun upgrades; pin TypeScript to 6.x; Electron 43+ requires main/preload CommonJS (`.cjs`) or app shows white screen; unset `ELECTRON_RUN_AS_NODE` when launching Electron from Cursor's terminal.
- [Release + Homebrew](.claude/skills/fixlang/fixlang-release-homebrew/SKILL.md) — release trigger + orphan-tag resume; release Test step needs Node 24 on macos-14 (`node:sqlite` builtin); tap cask write uses `jq -je` (not `-er`); `brew style/audit` need a registered tap + `#{version}` URL + `depends_on :macos`; genuine-release-only `brew upgrade` proof.
- [Bundle externals](.claude/skills/fixlang/fixlang-bundle-externals/SKILL.md) — `app.asar` ships no `node_modules`; a new runtime dependency must be Vite-inlined or it dies at launch in a packaged build only, never in `dev`/`test`/`lint`. Run `bun run check:bundle` after `bun run build`.
