# FixLang — Instructions

## Overview

Local macOS menu-bar app: fixes grammar and improves writing on selected text via AI (OpenAI, OpenRouter, AWS Bedrock, Ollama, LM Studio). Electron + React + TypeScript, runs on **bun**.

Current release: **v0.24.1**.

## Main Features

What the user gets. Implementation traps live under [Known Gotchas](#known-gotchas) — read the matching skill before touching that area.

- **Writing transforms**
  - **Transform** — select text in any app, press a preset hotkey, get a rewrite back via Direct paste or Show popup (global default, overridable per preset).
  - **Selection read** — every hotkey (including Ask AI) reads selection the same way, with clipboard fallback when the copy produces nothing; Ask labels clipboard-sourced context as From clipboard.
  - **Presets** — seven built-ins (Correction, Summarize, Prompt optimization, Translate, Business Writing, Context-Aware Structured Text, Ask AI) plus custom ones; each has its own hotkey, model, system prompt, reasoning effort, and output mode.
  - **Combos** — one hotkey runs 2–5 presets in sequence and delivers only the last step; includes a built-in Perfect prompt combo (no default hotkey) and a Combos Settings tab.
  - **Source-app context** — frontmost app name shapes tone (and markup for Context-Aware Structured Text); dropped when unreadable or when FixLang is frontmost.
  - **Hotkeys** — remappable preset, PromptGen, and profile-switch bindings; conflicts refused before save.
- **Ask & autocomplete**
  - **Ask AI** — optional selection as context; opens an input window and answers in cascading popups, both rendered by the shared `ChatTranscript` (selection → question → markdown answer).
  - **Request transparency** — the input window shows the exact system prompt and the exact context appended to the request, both rendered by main and shown verbatim, in a row that is 40px collapsed and overlays the window when expanded.
  - **Request context** — resolved once per press (`askEnvironment.ts`): app locale, macOS system language, active keyboard input source (best-effort, absent when unreadable), current local time, and the last 5 transforms as **preset names and timestamps only** — never their text. Rides both the Ask submit and every autocomplete dispatch.
  - **Autocomplete** — opt-in ghost-text suggestions in the Ask AI input (Tab accept; Esc clears ghost, then closes); Settings toggle, model picker, daily cost cap, and Usage rollups.
  - **Prompt generation** — PromptGen builds AI prompts from selected text (`Control+Shift+G`); feature-tagged, OFF in release builds.
  - **Security guard rails** — four checks before text leaves the machine: a frontmost-app deny-list, a stale/unknown-age clipboard confirm, a selection-size confirm, and a secret guard (`off`/`confirm`/`mask`). Configured from the Security dashboard tab; autocomplete cannot show a dialog, so it refuses to dispatch instead. See [Security guard rails](.claude/skills/fixlang/fixlang-security-guards/SKILL.md).
- **Providers & profiles**
  - **Multi-provider** — OpenAI, OpenRouter, AWS Bedrock, Ollama, and LM Studio can all be connected; any preset can use any connected model.
  - **Admin keys** — OpenAI Admin / OpenRouter provisioning keys unlock that provider's Usage sub-tab (encrypted, main-process-only).
  - **Profiles** — named configs cycled with `Control+Shift+P`; a switch reloads hotkeys, settings, and history together.
- **History, usage & diagnostics**
  - **History** — local SQLite history for transforms, Ask, and PromptGen with cost tracking and raw completion snapshots.
  - **Analytics** — Overview and Models dashboards for token stats, presets, and model breakdown (All / 30d / 7d).
  - **Usage** — account-level spend and tokens for providers with a billing API (OpenAI, OpenRouter).
  - **Logs** — redacted JSONL logs with a searchable Logs tab (filter, copy/export).
  - **Latency logging** — one per-press latency line with phase breakdown for what the user actually felt.
- **App shell**
  - **Tray popover** — quick access to provider credit/spend, language, output mode, model, reasoning effort, updates, and dashboard.
  - **About** — app updates (Homebrew upgrade) and a user guide built from the user's real config.
  - **Appearance & language** — 149 terminal-inspired themes; English and Japanese, switchable without restart.

## Purpose

User data stays local — API keys, history, and logs never leave the machine except to the providers a profile has connected, and each provider only ever sees its own key. Profile and hotkey state must stay consistent across switches; silent breakage there is worse than a loud failure.

## Scope & Key Resources

Electron app with main/preload/renderer split. Highest-risk areas: global hotkeys + profile state, IPC validation, AI prompt bundling, theme derivation, and userData persistence.

### Structure

```
fix-lang/
├── src/
│   ├── features/           — domain modules (shared / store / main / preload per feature)
│   │   ├── core/shared/    — ipcChannels, features (build tags), bundleExternals, dashboardTabIds
│   │   ├── providers/      — API keys, model refs, provider registry, apiStore
│   │   ├── correction/     — presets output mode, reasoning effort, keybindings store
│   │   ├── history/        — SQLite history, session snapshots
│   │   ├── i18n/           — catalogs, locale store, locale IPC
│   │   ├── logs/           — structured logging types + Logs IPC
│   │   ├── profiles/       — profile import/export, migration
│   │   ├── settings/       — settings IPC, ipc result labels
│   │   ├── theme/          — theme store + theme IPC
│   │   ├── update/         — in-app update types + IPC
│   │   ├── usage/          — OpenAI/OpenRouter usage IPC
│   │   ├── ask/            — Ask AI preload bridge
│   │   ├── ui/             — window/focus IPC
│   │   ├── promptgen/      — PromptGen IPC (feature-tagged)
│   │   ├── main/index.ts   — barrel: all main-process IPC handlers
│   │   └── preload/index.ts — barrel: all preload bridges
│   ├── main/               — Electron main process
│   │   ├── ai.request/     — cross-provider: model cache, request routing, cost, requestTypes
│   │   ├── ipc/            — re-exports ~/features/main
│   │   ├── keybindings/    — global hotkeys (presets, promptGen, profileSwitch)
│   │   ├── logging/        — structured JSONL write/query
│   │   ├── llm/
│   │   │   ├── models/     — cross-provider discovery/compat/monitor
│   │   │   └── providers/  — one folder per ProviderId + index.ts capability registry
│   │   ├── update/         — Homebrew probe/fetch/upgrade + pending-update marker
│   │   ├── profileChange.ts — single funnel for profile activation
│   │   └── webViewWindows/ — main, promptGen, overlay, tray, askInput/askResult, error popup
│   ├── renderer/           — React UI (MainWindow dashboard, TrayWindow, …)
│   ├── preload/            — re-exports ~/features/preload; exposeInMainWorld entry
│   └── prompts/            — bundled AI prompt assets (build-time)
├── scripts/                — bun CLIs: check-bundle-externals, i18n-check, theme gen
├── .github/workflows/release.yml
├── README.md
└── .claude/skills/fixlang/
```

## Tech Stack

- Runtime/build
  - Electron 43.2, electron-vite 5.0, Vite 8.1, bun
- Frontend
  - React 19.2, TypeScript 6.0 (stay on 6.x until typescript-eslint supports 7), Tailwind 4.3
- AI
  - openai 6.49, @ai-sdk/openai 4.0, @openrouter/ai-sdk-provider 3.0, @ai-sdk/amazon-bedrock 5.0 + @aws-sdk/client-bedrock 3.x, ai 7.0, ollama 0.6 — each wired in its own `src/main/llm/providers/<id>/request.ts` and reached through the capability registry; LM Studio and Ollama both use a configurable local host/port (LM Studio via OpenAI-compatible `baseURL`; Ollama via its daemon URL), and Bedrock stores its AWS region in `providerEndpoints.bedrock.host` (`src/features/providers/shared/bedrockEndpoint.ts`, default `us-east-1`)
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

- **The packaged app ships no `node_modules`** (`build.files` excludes it) — every runtime dependency must be inlined by Vite into `out/`. Adding a dependency and importing it passes `dev`, `test`, and `lint` unchanged; only `bun run check:bundle` against a real `bun run build` catches a dependency Vite left external. The scanner lives in `src/features/core/shared/bundleExternals.ts` (AST walk via the TypeScript compiler API, not a regex); `scripts/check-bundle-externals.ts` is a CLI-only wrapper that runs under **bun**, whose TS parser differs from vitest's esbuild — which is why an integration test drives that exact file under bun. `ALLOWLIST` is empty on purpose: an entry hides a `MODULE_NOT_FOUND` for users instead of fixing it. Every packaging script (`pack`, `pack:mac`, `pack:mac:prod`, `release:mac`) runs the check. See [Bundle externals](.claude/skills/fixlang/fixlang-bundle-externals/SKILL.md).
- **`dependencies` vs `devDependencies` no longer signals what ships** — nothing resolves from `node_modules` at runtime, so the split is bookkeeping only; what ships is whatever Vite inlined into `out/`. Do not "fix" a runtime import by moving its package between the two sections.
- **Feature tags are opt-in** — features listed in `src/features/core/shared/features.ts` are excluded unless the build carries their tag (`FIXLANG_FEATURES=promptgen` env, or `--promptgen` CLI). Flag-off builds emit no renderer bundle for the feature and skip its hotkey, IPC handlers, and settings tab. Read flags at runtime via `isPromptGenEnabled()`, never `__FEATURE_PROMPT_GEN__` directly (the define is absent under vitest). Plain `bun run build` (what the release workflow runs) ships PromptGen OFF.

## Internationalization (i18n)

The app supports **English** and **Japanese** (easily extensible to a third language). All user-facing text in the renderer and main process is translatable via `t()` (renderer) or `mainT()` (main process).

### Catalog structure

Translation strings live in `src/features/i18n/shared/locales/{en,ja}/` as per-namespace JSON files (`common.json`, `dashboard.json`, `tray.json`, `notifications.json`, etc.). This split prevents merge conflicts when separate features add keys to the same catalog.

- Keys are globally unique and dotted (`"settings.general.language.label"`).
- English (`en/`) is the source of truth — every key must exist there; Japanese (`ja/`) may be partial (missing keys fall back to English).
- Both catalogs are merged at build time into `EN_CATALOG` and `JA_CATALOG` in `src/features/i18n/shared/locales/index.ts`.
- Key names are type-checked at compile time: `t("key")` is a compile error if `"key"` is absent.

### Add a translatable string (recipe)

1. **English**: Add the key-value pair to `src/features/i18n/shared/locales/en/{namespace}.json`:

   ```json
   { "overview.stat.sessions": "Sessions" }
   ```

2. **Japanese**: Add the translation to `src/features/i18n/shared/locales/ja/{namespace}.json`:

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

Add the language to `LOCALE_CODES` and `LOCALE_META` in `src/features/i18n/shared/registry.ts`; then create one JSON file per namespace under `src/features/i18n/shared/locales/{code}/` (e.g., `src/features/i18n/shared/locales/fr/common.json`). The language picker grows automatically; IPC, formatters, and storage need no changes.

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

- The user's locale choice is persisted via `electron-store` in `src/features/i18n/store/localeStore.ts`.
- On first run, the system locale (from `app.getLocale()`) is auto-detected and stored.
- Changing the language via Settings broadcasts the new locale to every open window (tray, dashboard, PromptGen) via IPC, so they update immediately without an app restart.
- See `src/features/i18n/main/locale.ts` for the IPC handlers; `src/features/i18n/preload/locale.ts` for the bridge; `src/renderer/i18n/I18nProvider.tsx` for the context subscription.

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

- **PR + push to `main`** — `.github/workflows/ci.yml` runs two independent jobs on `ubuntu-latest` (Bun 1.3.14; the test job also sets up Node 24 for `node:sqlite`): a `lint` job, and a `test` job fanned out over a 3-way `--shard` matrix with `fail-fast: false` so one shard's failure still reports the others. Concurrency cancels superseded runs. Release packaging stays in `release.yml` only.
- **Vitest runs as two projects, and the split is the whole reason CI is fast** — `node` (everything outside `src/renderer/`) and `renderer` (`src/renderer/**`, `jsdom`). jsdom costs roughly 0.75 s of environment setup **per test file**, so running all 188 files under it spent ~143 s of cumulative environment time for the 33 files that actually need a DOM; the split cut a full local run from 24.7 s to 13.4 s with no change to what is tested. A new test outside `src/renderer/` that reaches for `document`/`window` will fail under the `node` project — move it under `src/renderer/`, or give that one file a `// @vitest-environment jsdom` docblock, rather than widening the `renderer` project's globs.
- **Coverage is off by default** (`coverage.enabled: false`); run `bun run test:coverage` for a report. Nothing gates on it, and a sharded run only ever sees its own third of the files, so a coverage number collected in CI would be a lie.

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
- [Presets](.claude/skills/fixlang/fixlang-presets/SKILL.md) — retired reasoning efforts must MAP, not vanish; per-preset `outputMode` must be resolved on BOTH delivery paths; Ask AI's optional selection and its markdown answer are both untrusted; the `# Metadata context` block's default wording is byte-pinned.
- [Provider credentials](.claude/skills/fixlang/fixlang-provider-credentials/SKILL.md) — capability registry is the only dispatch table (and its `import()`s must stay lazy); secret slots are per profile + provider + kind; a foreign-shaped key is refused at both write chokepoints; log the key's shape, never its value; per-provider cost honesty rules.
- [Usage & analytics](.claude/skills/fixlang/fixlang-usage-analytics/SKILL.md) — OpenAI's MONEY RULE (tokens per model, dollars per line item/project, never per-model dollars or a balance); split Spend card so one failed half cannot blank the other; tray siblings keyed by `profileId` need distinct key prefixes or a duplicate card survives.
- [i18n](.claude/skills/fixlang/fixlang-i18n/SKILL.md) — JSON values widen to `string` (params not type-checked); tests must be `.test.ts` (no RTL); aggregations return descriptors; memoized callbacks over `t` or formatters must list them in deps; `date-fns` needs explicit `{ locale }`; main process uses `mainT()`, not `useI18n()`.
- [Prompt bundling](.claude/skills/fixlang/fixlang-prompt-bundling/SKILL.md) — prompts bundle at build time from `src/prompts/`, not `~/.agents/`; rebuild + reinstall to apply.
- [Profile state](.claude/skills/fixlang/fixlang-profile-state/SKILL.md) — profile switch must atomically reload hotkeys + settings UI + history; connecting a provider does NOT wipe presets.
- [Model refs](.claude/skills/fixlang/fixlang-model-refs/SKILL.md) — composite ref `<providerId>::<rawModelId>` lives in config only; SQLite history and downstream API calls get the raw id only. Leaking the prefix into a `startsWith` check gives a silent wrong answer with no error.
- [Theme mapping](.claude/skills/fixlang/fixlang-theme-mapping/SKILL.md) — derive-ladder + composite-alpha strategy; run `bun run themes:generate` after theme .ts edits, then `bun run test` to validate all 149 themes.
- [Package upgrade](.claude/skills/fixlang/fixlang-pkg-upgrade/SKILL.md) — wave-based bun upgrades; pin TypeScript to 6.x; Electron 43+ requires main/preload CommonJS (`.cjs`) or app shows white screen; unset `ELECTRON_RUN_AS_NODE` when launching Electron from Cursor's terminal.
- [Release + Homebrew](.claude/skills/fixlang/fixlang-release-homebrew/SKILL.md) — release trigger + orphan-tag resume; release Test step needs Node 24 on macos-14 (`node:sqlite` builtin); tap cask write uses `jq -je` (not `-er`); `brew style/audit` need a registered tap + `#{version}` URL + `depends_on :macos`; genuine-release-only `brew upgrade` proof.
- [Security guard rails](.claude/skills/fixlang/fixlang-security-guards/SKILL.md) — clipboard age carries an ORIGIN (a baseline is a lower bound, not an age); the age guards CONFIRM rather than block because an identical re-copy is indistinguishable from no copy; `SECRET_SEND_SITE_POLICY` is the one table; restore enforces multiplicity and non-relocation; and every natural log key in the feature is blanked by `redactLogContext`.
- [Bundle externals](.claude/skills/fixlang/fixlang-bundle-externals/SKILL.md) — `app.asar` ships no `node_modules`; a new runtime dependency must be Vite-inlined or it dies at launch in a packaged build only, never in `dev`/`test`/`lint`. Run `bun run check:bundle` after `bun run build`.
