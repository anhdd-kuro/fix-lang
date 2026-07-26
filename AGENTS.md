# FixLang — Instructions

## Overview

Local macOS menu-bar app: fixes grammar and improves writing on selected text via AI (OpenAI, OpenRouter, Ollama). Electron + React + TypeScript, runs on **bun**.

## Main Features

- **Transform** — fix grammar/style or otherwise rewrite selected text via per-preset global hotkeys.
- **Source-app context** — Transform and PromptGen append the frontmost app name ("Slack", "Mail") to the **system prompt** (`src/main/ai.request/transform-context.ts`), so the model can match that app's register. Best-effort: dropped entirely when the read fails or FixLang itself is frontmost, leaving the system prompt byte-identical. Every read is logged under scope `accessibility.activeApp` (debug on read/drop, warn on failure).
- **Presets** — built-in Correction, Summarize, Translate, Prompt optimization; each preset has its own hotkey, model, and system prompt.
- **Prompt generation** — build AI prompts from selected text (PromptGen window).
- **Profiles** — switch transform presets; switch reloads hotkeys + settings + history.
- **Multi-provider** — OpenAI, OpenRouter, Ollama; model discovery/compat/monitor.
- **History** — SQLite-backed transform + PromptGen history with cost tracking.
- **Analytics** — Overview dashboard: stat cards, preset donut/time-series charts (`PresetWeightChart`), token activity calendar, benchmark sentence; shared All/30d/7d range with Models tab.
- **Logs** — structured, redacted JSONL persistence (`userData/logs/{YYYY-MM-DD}/fixlang.jsonl`); Logs tab with multi-select level filter (`LogQueryRequest.levels`; empty array = every level), search, copy/export, virtual infinite scroll, timezone stated once in the footer instead of per row.
- **Hotkeys** — customizable global shortcuts (promptGen, profileSwitch) plus per-preset transform hotkeys.
- **Updates** — Settings → About checks GitHub Releases; cask installs get a one-click **Update now** that delegates to `brew upgrade --cask fixlang` (`src/main/update/homebrew.ts`). No self-updater.

## Purpose

User data stays local — API keys, history, and logs never leave the machine except to the configured provider. Profile and hotkey state must stay consistent across switches; silent breakage there is worse than a loud failure.

## Scope & Key Resources

Electron app with main/preload/renderer split. Highest-risk areas: global hotkeys + profile state, IPC validation, AI prompt bundling, theme derivation, and userData persistence.

### Structure

```
fix-lang/
├── src/
│   ├── main/               — Electron main process
│   │   ├── ai.request/     — AI calls, cost, cache, resolve-model
│   │   ├── ipc/features/   — IPC handlers (api, correction, history, logs, …)
│   │   ├── keybindings/    — global hotkeys (presets, promptGen, profileSwitch)
│   │   ├── logging/        — structured JSONL write/query
│   │   ├── llm/            — provider model discovery/compat/monitor
│   │   └── webViewWindows/ — main, promptGen, overlay, tray
│   ├── renderer/           — React UI (MainWindow dashboard, TrayWindow, …)
│   ├── preload/features/   — IPC bridge (validate here)
│   ├── stores/             — historyDb (sqlite), apiStore, keybindingStore
│   ├── prompts/            — bundled AI prompt assets (build-time)
│   └── shared/logging.ts   — log types + redaction (shared)
├── README.md               — user-facing features and usage
└── .claude/skills/fixlang/ — project-specific traps (read on demand)
```

## Tech Stack

- Runtime/build
  - Electron 43.2, electron-vite 5.0, Vite 8.1, bun
- Frontend
  - React 19.2, TypeScript 6.0 (stay on 6.x until typescript-eslint supports 7), Tailwind 4.3
- AI
  - openai 6.49, @openrouter/ai-sdk-provider 3.0, ai 7.0, ollama 0.6
- Persistence
  - node:sqlite (history) + electron-store 11 + JSONL logs under userData — no zustand
- Testing
  - Vitest 4.1, jsdom

## Key Commands

```bash
bun run dev             # hot reload (predev runs build)
bun run test            # verify changes — use `bun run test`, not `bun test`
bun run lint            # ESLint (cached)
bun run pack:mac        # package macOS app → release/
bun run themes:generate # after theme .ts edits
bun run i18n:check      # catalog parity/plural/sort audit + JA coverage
bun run build:promptgen # feature-tag build (also dev:promptgen, pack:mac:promptgen)
```

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

⚠️ Ask first:

- Before deleting important files, ask for confirmation.

🚫 Never:

- Commit secrets, `.env`, `node_modules`, `out/`, `release/`.
- Reintroduce pnpm or bypass preload IPC validation.
- Use `any` without a why-comment.
- Bump TypeScript to 7.x until ESLint support lands.

## Release & Distribution

- **Trigger** — bump `package.json` to a strictly higher stable semver, PR to `main`, merge. Push to `main` fires `.github/workflows/release.yml` (`prepare` on ubuntu creates the `v<version>` tag; `release` on macos-14 lints/tests/builds, validates the DMG, publishes `FixLang-<v>-arm64.dmg` + `SHA256SUMS.txt`). Docs-only pushes no-op (version already public).
- **Homebrew** — public tap `anhdd-kuro/homebrew-tap` auto-syncs verified releases into `Casks/fixlang.rb`; users run `brew install --cask anhdd-kuro/tap/fixlang` and `brew update && brew upgrade --cask fixlang`. arm64-only, unsigned — never automate Gatekeeper/`xattr`.
- **In-app update** — `updates:install` starts a detached `/bin/sh` helper that waits for FixLang to exit, runs `brew update && brew upgrade --cask fixlang` (`NONINTERACTIVE=1`), then reopens the app; the app quits itself right after. brew is resolved only from `/opt/homebrew/bin/brew` or `/usr/local/bin/brew` (never PATH), and the button is off unless `<prefix>/Caskroom/fixlang` exists. A `pending-update.json` marker under `userData` reports a stalled upgrade on the next launch; helper output goes to `userData/logs/homebrew-update.log`.
- **The check asks Homebrew, not GitHub** — for a cask install `checkForUpdates` offers `HomebrewUpgrader.getInstallableVersion()`, because Homebrew is what the button runs. GitHub is queried in parallel but only supplies release notes and the DMG size, and only when it describes the exact version being offered. A published release the tap has not synced yet is reported as `up-to-date` + `tapPendingMessage`, never as an offer. Cost control: the routine check reads the local tap clone (`getInstallableVersion(false)`, no `brew update` — that is a git fetch across every tap) and pays for one refresh only when GitHub shows something newer. Manual DMG installs, and casks whose brew probe returns null, still fall back to GitHub.
- **Two version sources** — the check reads **GitHub Releases**, the install runs **the Homebrew tap**, and the tap lags the release (cron, up to 6h). `installUpdate` therefore probes `brew info --cask fixlang --json=v2` (after `brew update`) and refuses to quit when the tap is still behind. Never delete that gate: `brew upgrade` exits **0** on "already installed", so without it the app quits and reopens unchanged and the button looks dead. A null/unparseable probe means "unknown" → proceed; only a *parsed lower* version blocks.
- **An unchanged version on relaunch is not proof of failure** — the app quits in under a second, Homebrew keeps downloading ~128 MB for a minute or more, and a user who reopens FixLang meanwhile lands in `reconcileLastInstall` with the old bundle still in place. Treating that as failure clears the marker, shows "Homebrew did not finish the last update", and re-arms the button, so the next click starts a second `brew upgrade` that dies on the first one's **download lock**. The marker therefore carries `startedAt`, and reconcile returns `in-progress` (keep marker, keep the button inert, poll the Caskroom) until either `<prefix>/Caskroom/fixlang/<target>` appears → `restart-required`, or `UPGRADE_GRACE_MS` (20 min) passes → `failed`.
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
- [Profile state](.claude/skills/fixlang/fixlang-profile-state/SKILL.md) — profile switch must atomically reload hotkeys + settings UI + history.
- [Theme mapping](.claude/skills/fixlang/fixlang-theme-mapping/SKILL.md) — derive-ladder + composite-alpha strategy; run `bun run themes:generate` after theme .ts edits, then `bun run test` to validate all 149 themes.
- [Package upgrade](.claude/skills/fixlang/fixlang-pkg-upgrade/SKILL.md) — wave-based bun upgrades; pin TypeScript to 6.x; Electron 43+ requires main/preload CommonJS (`.cjs`) or app shows white screen; unset `ELECTRON_RUN_AS_NODE` when launching Electron from Cursor's terminal.
- [Release + Homebrew](.claude/skills/fixlang/fixlang-release-homebrew/SKILL.md) — release trigger + orphan-tag resume; release Test step needs Node 24 on macos-14 (`node:sqlite` builtin); tap cask write uses `jq -je` (not `-er`); `brew style/audit` need a registered tap + `#{version}` URL + `depends_on :macos`; genuine-release-only `brew upgrade` proof.
