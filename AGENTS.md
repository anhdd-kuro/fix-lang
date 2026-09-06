# FixLang — Instructions

## Overview

Local macOS menu-bar app: fixes grammar and improves writing on selected text via AI (OpenAI, OpenRouter, Anthropic, AWS Bedrock, Ollama, LM Studio). Electron + React + TypeScript, runs on **bun**.

Current release: **v0.34.0**.

## Main Features

What the user gets. Implementation traps live under [Known Gotchas](#known-gotchas) — read the matching skill before touching that area.

- **Writing transforms**
  - **Transform** — select text in any app, press a preset hotkey, get a rewrite back via Direct paste or Show popup (global default, overridable per preset).
  - **Selection read** — every hotkey (including Ask AI) reads selection the same way, with clipboard fallback when the copy produces nothing; Ask labels clipboard-sourced context as From clipboard.
  - **Presets** — eight built-ins (Correction, Summarize, Prompt optimization, Translate, Business Writing, Context-Aware Structured Text, Ask AI, Caveman) plus custom ones; each has its own hotkey, model, system prompt, reasoning effort, and output mode.
  - **Preset-scoped options** — a preset can declare its own settings through the registry in `src/features/correction/shared/presetOptions.ts`, persisted on `CorrectionPreset.extraOptions` and composed into the system prompt by `withPresetOptions`. Caveman uses it for its three intensity levels (lite/full/ultra). Settings renders whatever a preset declares with no per-preset UI code, so a new option needs a registry entry and its localized strings — a label, a hint, and one label per choice, in each locale (five keys per locale for Caveman's three levels) — not an interface change.
  - **Combos** — one hotkey runs 2–5 presets in sequence and delivers only the last step; includes a built-in Perfect prompt combo, Correction → Prompt optimization → Caveman (no default hotkey), and a Combos Settings tab.
  - **Source-app context** — frontmost app name shapes tone (and markup for Context-Aware Structured Text); dropped when unreadable or when FixLang is frontmost.
  - **Hotkeys** — remappable preset, PromptGen, and profile-switch bindings; conflicts refused before save.
- **Ask & autocomplete**
  - **Ask AI** — optional selection as context; opens an input window and answers in cascading popups, both rendered by the shared `ChatTranscript` (selection → question → markdown answer).
  - **Request transparency** — the input window shows the exact system prompt and the exact context appended to the request, both rendered by main and shown verbatim, in a row that is 40px collapsed and overlays the window when expanded, showing both texts unfolded so one click reveals them.
  - **Request context** — resolved once per press (`askEnvironment.ts`): app locale, macOS system language, active keyboard input source (best-effort, absent when unreadable), current local time, and the last 5 transforms as **preset names and timestamps only** — never their text. Rendered by `buildAskDirectives` and applied to system prompts by `withUserMetadata` (`ai.request/user-metadata.ts`) for every preset and Autocomplete; Ask still appends the same string to the submitted user message. The secret gate scans this block with the selection (`companionText`): confirm covers both in one dialog, and mask redacts companion spans as `[redacted]` rather than restore placeholders (the model is not asked to echo metadata). Autocomplete redacts fully-maskable environment spans the same way and refuses the ghost when a span is not fully maskable. Empty/absent directives leave the prompt byte-identical.
  - **Autocomplete** — opt-in ghost-text suggestions in the Ask AI input (Tab accept; Esc clears ghost, then closes); Settings toggle, model picker, daily cost cap, and Usage rollups.
  - **Prompt generation** — PromptGen builds AI prompts from selected text (`Control+Shift+G`); feature-tagged, OFF in release builds.
  - **Security guard rails** — four checks before text leaves the machine: a frontmost-app deny-list, a stale/unknown-age clipboard confirm, a selection-size confirm, and a secret guard (`off`/`confirm`/`mask`). Configured from **Settings → Security**; the **Security** dashboard tab is the read-only roll-up of what they did (masked requests, blocked apps, cancelled confirms), derived from the persisted JSONL logs. Autocomplete cannot show a dialog, so it refuses to dispatch instead. See [Security guard rails](.claude/skills/fixlang/fixlang-security-guards/SKILL.md).
  - **External navigation guard** — a fifth, app-wide control, and the only one that is not user-configurable: every window factory in `src/main/webViewWindows/` calls `applyExternalNavigationGuard` (`externalNavigationGuard.ts`), which denies every window-open and `preventDefault()`s every cross-document navigation, handing the URL instead to the single `openExternalUrl` that also backs the `open-external-link` IPC (one http/https scheme check, one `shell.openExternal`). It exists because these windows render text they did not author — GitHub release notes, model output — and a MIDDLE click fires `auxclick`, so no renderer `onClick` runs and Electron's default for an unhandled window-open is to ALLOW it into a chrome-less app-owned window with no address bar. `externalNavigationGuard.test.ts` goes red when a factory is added without the guard: **the fix is to install the guard on the new factory, never to exclude the factory from the test.** This is a security control, not a lint.
- **Providers & profiles**
  - **Multi-provider** — OpenAI, OpenRouter, Anthropic, AWS Bedrock, Ollama, and LM Studio can all be connected; any preset can use any connected model.
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
  - **Pre-release channel** — a Pre-release section below the stable flow in About → Updates, with its own check button and its own result line, visible to every user. Discovery is button-only, so a routine update check is unchanged. Switching to a beta asks a main-process confirm naming the exact version; **Revert to stable asks nothing** — it is the safe direction, reached for precisely when a beta is misbehaving. Both run a detached Homebrew helper that fetches, uninstalls the current cask token and installs the other, restoring the original if that fails. The switch itself carries settings, profiles, keys and history across **both directions untouched** — but that is a claim about the switch, not about compatibility: whether a *stable* build can still read what a *beta* wrote has no guarantee behind it, and the confirm dialog is where that risk is disclosed to the user. Betas are published from `beta/**` branches by `.github/workflows/prerelease.yml` under the same build gates as a stable release (the ancestry gate has no beta equivalent — see the pre-release gotcha). **Three facts here have one owner each, and this line is not it:** the dialog's wording lives in the i18n catalog (`settings.updates.prerelease.*`) with the user-facing retelling in `README.md`, the helper's ordering and log file live in [Pre-release channel](.claude/skills/fixlang/fixlang-prerelease-channel/SKILL.md), and the tap/cask mechanics live in [Release + Homebrew](.claude/skills/fixlang/fixlang-release-homebrew/SKILL.md). Do not re-expand them here — this paragraph asserting its own copy of the dialog's contents is exactly how it went stale before.
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
│   │   ├── update/         — in-app update types + IPC; TWO renderer states (UpdateState + shared/prerelease.ts) registered by one registrar
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
│   │   ├── update/         — Homebrew probe/fetch/upgrade + pending-update marker; prereleaseVersion.ts (beta grammar), releaseAsset.ts (shared notes/asset validation), githubReleaseSource.ts (release list)
│   │   ├── profileChange.ts — single funnel for profile activation
│   │   └── webViewWindows/ — main, promptGen, overlay, tray, askInput/askResult, correctionResult, error popup + externalNavigationGuard.ts (every factory installs it)
│   ├── renderer/           — React UI
│   │   ├── components/     — SHARED UI primitives + the dashboard panels. Look here BEFORE
│   │   │                     writing any control: Button, Select, SearchableSelect,
│   │   │                     MultiSelect, Checkbox, Input, Dialog, HotkeyInput, ModelSelect,
│   │   │                     ReasoningEffortSlider, CopyButton, MarkdownView, ChatTranscript,
│   │   │                     …; sub-dirs about/, security/, usage/ hold that tab's screens
│   │   ├── hooks/          — shared renderer hooks
│   │   ├── i18n/           — I18nProvider, useI18n
│   │   ├── analytics/, appearance/, themes/ — dashboard sections + generated theme tokens
│   │   └── MainWindow/, TrayWindow/, AskInputWindow/, AskResultWindow/,
│   │       CorrectionResultWindow/, PromptGenWindow/ — one root per BrowserWindow
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
  - openai 6.49, @ai-sdk/openai 4.0, @openrouter/ai-sdk-provider 3.0, @ai-sdk/anthropic 4.0.23 (pinned — see below), @ai-sdk/amazon-bedrock 5.0 + @aws-sdk/client-bedrock 3.x, ai 7.0, ollama 0.6 — each wired in its own `src/main/llm/providers/<id>/request.ts` and reached through the capability registry; LM Studio and Ollama both use a configurable local host/port (LM Studio via OpenAI-compatible `baseURL`; Ollama via its daemon URL), and Bedrock stores its AWS region in `providerEndpoints.bedrock.host` (`src/features/providers/shared/bedrockEndpoint.ts`, default `us-east-1`)
- Persistence
  - node:sqlite (history) + electron-store 11 + JSONL logs under userData — no zustand
- Testing
  - Vitest 4.1, jsdom

## Key Commands

```bash
bun run dev             # hot reload (predev runs build)
bun run test            # verify changes — use `bun run test`, not `bun test`
bun run lint            # ESLint (cached) — does NOT typecheck; run `bunx tsc --noEmit` separately
# NEVER `bunx prettier --write` — there is no prettier config and eslint-config-prettier
# DISABLES formatting rules, so prettier reformats wholesale and buries your diff.
bun run pack:mac        # dev-identity app → release/mac-arm64/FixLang Dev.app
bun run pack:mac:prod   # production-identity app (pack:install builds this one)
bun run check:bundle    # after `bun run build` — no runtime dep may need node_modules
bun run themes:generate # after theme .ts edits
bun run i18n:check      # catalog parity/plural/sort audit + JA coverage
bun run build:promptgen # feature-tag build (also dev:promptgen, pack:mac:promptgen)
```

- **The packaged app ships no `node_modules`** (`build.files` excludes it) — every runtime dependency must be inlined by Vite into `out/`. Adding a dependency and importing it passes `dev`, `test`, and `lint` unchanged; only `bun run check:bundle` against a real `bun run build` catches a dependency Vite left external. The scanner lives in `src/features/core/shared/bundleExternals.ts` (AST walk via the TypeScript compiler API, not a regex); `scripts/check-bundle-externals.ts` is a CLI-only wrapper that runs under **bun**, whose TS parser differs from vitest's esbuild — which is why an integration test drives that exact file under bun. `ALLOWLIST` is empty on purpose: an entry hides a `MODULE_NOT_FOUND` for users instead of fixing it. Every packaging script (`pack`, `pack:mac`, `pack:mac:prod`, `release:mac`) runs the check. See [Bundle externals](.claude/skills/fixlang/fixlang-bundle-externals/SKILL.md).
- **`@ai-sdk/anthropic` is pinned to `4.0.23`, and the pin is the bundle check, not taste** — from `4.0.24` it depends on `@ai-sdk/provider-utils` ≥ `5.0.15`, which bun installs as a NESTED copy (the other providers hold the hoisted `5.0.12`/`5.0.14`). That copy resolves `undici` through a runtime `createRequire` for its file-download path — a specifier Vite cannot inline and a `node_modules`-free `app.asar` cannot resolve. Same reason Anthropic's model list is a plain `keepAliveFetch` against `/v1/models` rather than `@anthropic-ai/sdk`, which carries the identical require. Re-run `bun run check:bundle` after any bump.
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

- Work in work tree unless user requests new branch or names branch.
- Use shared components first: inspect `src/renderer/components/`; prefer control already used by same-panel siblings. Hand-rolled controls bypass theme tokens, i18n, and focus/keyboard behavior, with drift appearing on theme/locale changes. Extend shared component when needed; fork only with why-comment.
- Bundle prompts locally from `src/prompts/`; no runtime fetch.
- Store SQLite/JSONL under `app.getPath("userData")`; never signed bundle.
- Use async I/O only in main process.
- Consider sub-agents to reduce main-agent context load.
- Write gotchas caveman-style.
- If unclear after exploring, use batch-grill-me before guessing.
- Before declaring done:
  - Spawn fresh sub-agent to review changes before committing.
  - Run linting and tests.
  - Update AGENTS.md when needed.
- Use clear, descriptive function/variable names. Prefer readable meaningful naming, straightforward structure, and small focused functions. Avoid comments unless explaining non-obvious intent, constraints, or decisions not expressible clearly in code.

⚠️ Ask first:

- Before deleting important files, ask for confirmation.

🚫 Never:

- Commit secrets, `.env`, `node_modules`, `out/`, `release/`, `coverage/`, or agent scratch space (`.scratch/`, `.claude/settings.local.json`)—all gitignored.
- Reintroduce pnpm or bypass preload IPC validation.
- Use `any` without why-comment.
- Bump TypeScript to 7.x until ESLint support lands.

## CI

- **PR + push to `main`** — `.github/workflows/ci.yml` runs two independent jobs on `ubuntu-latest` (Bun 1.3.14; the test job also sets up Node 24 for `node:sqlite`): a `lint` job, and a `test` job fanned out over a 3-way `--shard` matrix with `fail-fast: false` so one shard's failure still reports the others. Concurrency cancels superseded runs. Release packaging stays in `release.yml` only.
- **Vitest runs as two projects, and the split is the whole reason CI is fast** — `node` (everything outside `src/renderer/`) and `renderer` (`src/renderer/**`, `jsdom`). jsdom costs roughly 0.75 s of environment setup **per test file**, so running all 188 files under it spent ~143 s of cumulative environment time for the 33 files that actually need a DOM; the split cut a full local run from 24.7 s to 13.4 s with no change to what is tested. A new test outside `src/renderer/` that reaches for `document`/`window` will fail under the `node` project — move it under `src/renderer/`, or give that one file a `// @vitest-environment jsdom` docblock, rather than widening the `renderer` project's globs.
- **Coverage is off by default** (`coverage.enabled: false`); run `bun run test:coverage` for a report. Nothing gates on it, and a sharded run only ever sees its own third of the files, so a coverage number collected in CI would be a lie.

## Release & Distribution

- **Trigger** — bump `package.json` to a strictly higher stable semver, PR to `main`, merge. Push to `main` fires `.github/workflows/release.yml` (`prepare` on ubuntu creates the `v<version>` tag; `release` on macos-14 runs lint → test → `i18n:check` → build → `check:bundle` → DMG, validates the DMG, publishes `FixLang-<v>-arm64.dmg` + `SHA256SUMS.txt`). The DMG is compressed with ULFO (LZFSE) via `build.dmg.format` and ships only the `en`/`ja` Electron locale paks (`build.mac.electronLanguages`); with `node_modules` gone from `app.asar` that lands at ~102 MiB. Between *Build renderer and processes* and *Build unsigned arm64 DMG*, a `bun run check:bundle` step AST-scans the built CommonJS for bare `require()` specifiers so a future dynamic dependency cannot silently become a `MODULE_NOT_FOUND` in a shipped app. Docs-only pushes no-op (version already public).
- **The DMG validation step is the packaged-artifact half of that guard** — it mounts the image, matches `CFBundleShortVersionString` against `package.json`, then asserts via `bunx @electron/asar list` that `app.asar` holds **no** `/node_modules/` entries and **does** hold `/out/renderer/` (a missing renderer ships a white-screen app). `@electron/asar` is a declared devDependency on purpose: the bare `asar` bin was only hoisted transitively through electron-builder, and `bunx asar` would otherwise fetch the deprecated standalone package from the registry.
- **Pre-release trigger** — push a `beta/**` branch whose `package.json` version is `X.Y.Z-beta.N`. That fires `.github/workflows/prerelease.yml`, which runs the same gates as stable (lint → test → `i18n:check` → build → `check:bundle` → DMG + the same mount-and-inspect validation) and publishes with `--prerelease`. `release.yml` is byte-unchanged, and `main`'s manifest never carries a beta version — that is what keeps the monotonic-version guard and the config-lock test green as they are. `.github/release-tag-ruleset.json` excludes `refs/tags/v*-beta.*` from update and deletion so a botched beta tag can be recut; stable `v*` tags keep full protection. **The publish job's `environment: prerelease` gates nothing until a GitHub environment of that name with required reviewers is created in repository settings** — see the gotcha.
- **Homebrew** — public tap `anhdd-kuro/homebrew-tap` auto-syncs verified releases into `Casks/fixlang.rb`; users run `brew install --cask anhdd-kuro/tap/fixlang` and `brew update && brew upgrade --cask fixlang`. arm64-only, unsigned — never automate Gatekeeper/`xattr`.
- **Two cask tokens, not one** — `fixlang` (`STABLE_CASK_TOKEN`) and `fixlang@beta` (`BETA_CASK_TOKEN`), declared `conflicts_with` each other so brew itself refuses both. The tap emits both casks from one sync run so they cannot drift. Homebrew has **no cask downgrade** — no `--version`, `brew version-install` is formula-only, install-from-URL is blocked and install-from-file is trust-gated and silently undone by the next `brew upgrade` — so sibling tokens are the only sanctioned channel mechanism, and a channel change is an **uninstall-then-install**, in that order: cask uninstall removes artifacts by **path, not identity**, and both tokens ship the same `/Applications/FixLang.app`. Every Caskroom path and brew argv therefore takes an explicit token guarded by `isCaskToken`; `detectActiveCaskChannel` is two directory probes and no subprocess (`stable`/`beta`/`both`), and `index.ts` binds the upgrader from its answer. Neither cask has a `zap` stanza and the helper never passes `--zap` or `--force`, which is what leaves `userData` untouched across a switch.
- **In-app update** — `updates:install` starts a detached `/bin/sh` helper that waits for FixLang to exit, runs `brew update && brew upgrade --cask fixlang` (`NONINTERACTIVE=1`), then reopens the app; the app quits itself right after. brew is resolved only from `/opt/homebrew/bin/brew` or `/usr/local/bin/brew` (never PATH), and the button is off unless `<prefix>/Caskroom/fixlang` exists. A `pending-update.json` marker under `userData` reports a stalled upgrade on the next launch; helper output goes to `userData/logs/homebrew-update.log`.
- **The check asks Homebrew, not GitHub** — for a cask install `checkForUpdates` offers `HomebrewUpgrader.getInstallableVersion()`, because Homebrew is what the button runs. GitHub is queried in parallel but only supplies release notes and the DMG size, and only when it describes the exact version being offered. A published release the tap has not synced yet is reported as `up-to-date` + `tapPendingMessage`, never as an offer — but it still carries that release's notes and points `getReleaseUrl()` at its tag, so the panel shows what changed next to a **Download from GitHub** button. Only the DMG size is withheld, because the download bar it feeds belongs to an install that cannot start. Cost control: the routine check reads the local tap clone (`getInstallableVersion(false)`, no `brew update` — that is a git fetch across every tap) and pays for one refresh only when GitHub shows something newer. Manual DMG installs, and casks whose brew probe returns null, still fall back to GitHub.
- **Two version sources** — **GitHub Releases** is what publishes a version (and, for manual DMG installs, what the check reads), the install runs **the Homebrew tap**, and the tap lags the release (cron, up to 6h). `installUpdate` therefore probes `brew info --cask fixlang --json=v2` (after `brew update`) and refuses to quit when the tap is still behind. Never delete that gate: `brew upgrade` exits **0** on "already installed", so without it the app quits and reopens unchanged and the button looks dead. A null/unparseable probe means "unknown" → proceed; only a *parsed lower* version blocks.
- **Download happens while the app is alive** — `installUpdate` runs `brew fetch --cask fixlang` first (fills the download cache only, installed bundle untouched) and publishes a `downloading` phase with byte progress read by `statSync` from `<HOMEBREW_CACHE>/downloads/*--FixLang-<v>-arm64.dmg[.incomplete]`. Progress is read from the growing cache file, never parsed out of brew's output, and the denominator is the GitHub release asset `size`. Only after the fetch succeeds does the app quit; the detached helper then just runs `brew upgrade` off the cache (no `brew update` — the tap probe already refreshed it), so the app is away for seconds instead of a minute.
- **What the app looks like on relaunch proves nothing in either direction** — an unchanged version usually means Homebrew is still downloading (the marker carries `startedAt`; reconcile answers `in-progress`, keeps the marker and keeps the button inert, so a second click cannot die on the first upgrade's download lock), and a *changed* version can be a stray older bundle being reopened (`reconcilePendingInstall` compares `toVersion` **and** the recorded `appPath` → `wrong-bundle`). `open -b` cannot replace a running app — it focuses the stale process — which is why the `restart-required` phase exists and why `pack:mac` builds as `com.fixlang.app.dev` (`pack:mac:prod` for production identity). Real traces, the lock error, and the `mdfind` recipe for finding stray bundles: [Release + Homebrew](.claude/skills/fixlang/fixlang-release-homebrew/SKILL.md).
- **The pre-release check is a different GitHub endpoint** — `/releases/latest` never returns a prerelease, so discovery pages the release-list endpoint (button-press only, so an ordinary check still costs one unauthenticated request) and validates it item by item, treating the `Link` header as untrusted. Beta version ordering lives in `src/main/update/prereleaseVersion.ts`; the parser split, the paging rules and the tap-lag gate's dependence on `parseCurrentVersion` are owned by [Pre-release channel](.claude/skills/fixlang/fixlang-prerelease-channel/SKILL.md) TRAP 5 and TRAP 7 — read them before touching either parser.
- **The marker distinguishes a rollback from a success** — `pending-update.json` carries the **target** `caskToken` plus an optional `fromCaskToken`, and a `"rolled-back"` outcome exists because a revert's marker is otherwise token-identical to an ordinary stable upgrade. Routing rules and the failure they prevent: [Pre-release channel](.claude/skills/fixlang/fixlang-prerelease-channel/SKILL.md) TRAP 6.
- **Traps** — release Test step needs Node 24 on macos runners (`node:sqlite` builtin); tap cask generation + `brew style/audit` have several traps; the channel-switch helper's `trap` handling and the beta-only limitations have their own gotcha. See the gotchas below before touching release, tap, or pre-release code.

## References

- [README](README.md) — features, dashboard tabs, hotkeys, build/install.

## Known Gotchas

Project-specific traps under `.claude/skills/fixlang/`:

- [Hotkeys](.claude/skills/fixlang/fixlang-hotkeys/SKILL.md) — preset hotkey reload on profile switch (silent failures) + pre-save conflict validation + frontmost-app read must precede the overlay spinner.
- [Presets](.claude/skills/fixlang/fixlang-presets/SKILL.md) — retired reasoning efforts must MAP, not vanish; per-preset `outputMode` must be resolved on BOTH delivery paths; Ask AI's optional selection and its markdown answer are both untrusted; the `# Metadata context` block's default wording is byte-pinned.
- [Providers](.claude/skills/fixlang/fixlang-provider/SKILL.md) — nine-step recipe for adding a provider (which tables the compiler forces, which files need nothing, which test fixtures always break), then the invariants: capability registry is the only dispatch table (and its `import()`s must stay lazy); secret slots are per profile + provider + kind; a foreign-shaped key is refused at both write chokepoints; log the key's shape, never its value; per-provider cost honesty rules; a new provider's slot in `PROVIDER_ORDER` reroutes bare ids and is a billing decision.
- [Usage & analytics](.claude/skills/fixlang/fixlang-usage-analytics/SKILL.md) — OpenAI's MONEY RULE (tokens per model, dollars per line item/project, never per-model dollars or a balance); split Spend card so one failed half cannot blank the other; tray siblings keyed by `profileId` need distinct key prefixes or a duplicate card survives.
- [i18n](.claude/skills/fixlang/fixlang-i18n/SKILL.md) — JSON values widen to `string` (params not type-checked); tests must be `.test.ts` (no RTL); aggregations return descriptors; memoized callbacks over `t` or formatters must list them in deps; `date-fns` needs explicit `{ locale }`; main process uses `mainT()`, not `useI18n()`.
- [Prompt bundling](.claude/skills/fixlang/fixlang-prompt-bundling/SKILL.md) — prompts bundle at build time from `src/prompts/`, not `~/.agents/`; rebuild + reinstall to apply.
- [Profile state](.claude/skills/fixlang/fixlang-profile-state/SKILL.md) — profile switch must atomically reload hotkeys + settings UI + history; connecting a provider does NOT wipe presets.
- [Model refs](.claude/skills/fixlang/fixlang-model-refs/SKILL.md) — composite ref `<providerId>::<rawModelId>` lives in config only; SQLite history and downstream API calls get the raw id only. Leaking the prefix into a `startsWith` check gives a silent wrong answer with no error.
- [Theme mapping](.claude/skills/fixlang/fixlang-theme-mapping/SKILL.md) — derive-ladder + composite-alpha strategy; run `bun run themes:generate` after theme .ts edits, then `bun run test` to validate all 149 themes.
- [Package upgrade](.claude/skills/fixlang/fixlang-pkg-upgrade/SKILL.md) — wave-based bun upgrades; pin TypeScript to 6.x; Electron 43+ requires main/preload CommonJS (`.cjs`) or app shows white screen; unset `ELECTRON_RUN_AS_NODE` when launching Electron from Cursor's terminal.
- [Release + Homebrew](.claude/skills/fixlang/fixlang-release-homebrew/SKILL.md) — release trigger + orphan-tag resume; release Test step needs Node 24 on macos-14 (`node:sqlite` builtin); tap cask write uses `jq -je` (not `-er`); `brew style/audit` need a registered tap + `#{version}` URL + `depends_on :macos`; genuine-release-only `brew upgrade` proof. Also owns three facts the whole update path depends on: the tap must emit **two** casks with mutual `conflicts_with`, every Homebrew-driven operation shares **one** in-flight flag, and release notes are untrusted input with a single shared normalizer.
- [Pre-release channel](.claude/skills/fixlang/fixlang-prerelease-channel/SKILL.md) — Homebrew has no cask downgrade, so a channel change is uninstall-then-install and the ORDER is the whole correctness story (uninstall removes artifacts by path, not identity); the helper's `trap - EXIT` inside `abort_without_reopen` is load-bearing, and its signal tests hold trivially under dash on Linux CI so a green run is not proof; the marker's `"rolled-back"` outcome and its `fromVersion` routing; the confirm dialog's compatibility warning (catalog key, no content test — do not trim it); a mocked `ipcRenderer.invoke` resolves whether or not a handler exists; plus the accepted `unknown`-channel limitation and **a `prerelease` GitHub environment the maintainer still has to create**.
- [Settings panel writes](.claude/skills/fixlang/fixlang-settings-writes/SKILL.md) — every `Setting*.tsx` persists the WHOLE settings object, so overlapping writes clobber, a writer-computed rollback target is never trustworthy, and a value the store REJECTED can ride into the next write and become real. Serialize per store; claim the status line at the user's action and never re-claim late. The renderer harness hides all of it — a dispatched click on a controlled checkbox makes zero writes and still reports green.
- [Security guard rails](.claude/skills/fixlang/fixlang-security-guards/SKILL.md) — clipboard age carries an ORIGIN (a baseline is a lower bound, not an age); the age guards CONFIRM rather than block because an identical re-copy is indistinguishable from no copy; `SECRET_SEND_SITE_POLICY` is the one table; restore enforces multiplicity and non-relocation; and every natural log key in the feature is blanked by `redactLogContext`.
- [Bundle externals](.claude/skills/fixlang/fixlang-bundle-externals/SKILL.md) — `app.asar` ships no `node_modules`; a new runtime dependency must be Vite-inlined or it dies at launch in a packaged build only, never in `dev`/`test`/`lint`. Run `bun run check:bundle` after `bun run build`.
