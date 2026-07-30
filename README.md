# FixLang

A local macOS menu-bar app that fixes grammar, improves writing, and runs other text transformations on selected text via AI. Supports **OpenAI**, **OpenRouter**, **Ollama**, and **LM Studio**. Runs entirely on your machine; API keys never leave it and are encrypted at rest via the macOS keychain.

## Features

### Transform & presets

- Select text in any app, press a preset hotkey, then either paste the result back automatically or show it in a result-only popup
- Built-in presets (each with its own hotkey): **Correction** (`Ctrl+Shift+F`), **Summarize** (`Ctrl+Shift+S`), **Prompt optimization** (`Ctrl+Shift+D`), **Translate** (`Ctrl+Shift+T`), **Business Writing** (`Ctrl+Shift+B`), **Context-Aware Structured Text** (`Ctrl+Shift+R`), **Ask AI** (`Ctrl+Shift+A`)
- **Ask AI** opens a small input window instead of requiring a selection: type a question, optionally with selected text carried along as context, and get a GFM-rendered answer in a popup (up to 5 stacked at once)
- **Profiles** — multiple named configurations; switch with `Ctrl+Shift+P` (profile switch reloads hotkeys, settings, and history)
- Custom presets with per-preset model, system prompt, hotkey, and reasoning effort (Faster↔Smarter)
- **App-aware output** — the name of the app you selected the text in (e.g. Slack, Mail, Xcode) is added to the system prompt as context, so the result matches that app's tone and formatting conventions. Applies to transform presets and PromptGen. Most presets only use it to infer tone and formality, not markup; **Context-Aware Structured Text** is the exception and actively adapts formatting to the app. The app name is never echoed into the output, and nothing is sent when it can't be read

### Prompt generation

- **PromptGen** (`Ctrl+Shift+G`) — build AI prompts from selected text in a dedicated window
- Opt-in from **0.3.4** onward: PromptGen ships only in builds carrying the
  `--promptgen` feature tag, so it is **absent from the prebuilt DMGs** (window,
  hotkey, settings tab, and history chip alike). See
  [Feature tags](#feature-tags-opt-in-features).

### Dashboard (MainWindow)

Six tabs, opened from the menu-bar tray or after a transform:

| Tab | What it shows |
| --- | --- |
| **Overview** | Token stats, preset usage charts, Codex-style token activity calendar |
| **History** | Transform + PromptGen history with cost tracking; last-action preview |
| **Models** | Token usage over time, Model Breakdown donut + table for the selected range |
| **Usage** | Account-level spend and token usage, one sub-tab per connected provider (OpenAI, OpenRouter) — daily spend and token charts, spend-share donut, per-model activity, and (OpenAI) billed spend per project |
| **Logs** | Structured, redacted app events — multi-select level filter, search, copy/export as `.txt` |
| **About** | Two sub-tabs — **App updates** (version, release notes, install; see [App updates](#app-updates)) and **User guide** (onboarding that shows your own preset shortcuts, output mode, connected providers, and why History/Usage may look empty) |

Overview and Models share a time-range filter (All / 30d / 7d).

### Logging

- `src/shared/logging.ts` + `src/main/logging/logService.ts` — structured logs with API-key and clipboard redaction
- Persisted to `userData/logs/{YYYY-MM-DD}/fixlang.jsonl` (one folder per local day)
- Logs tab reloads from disk with virtual infinite scroll (`@tanstack/react-virtual`)
- Any subset of levels can be checked at once (no selection = all levels); the row timestamps omit the UTC offset because the footer states the zone once
- Errors use a native macOS notification when available; if macOS rejects it, FixLang shows a brief in-app popup near the cursor instead — dismissible with its close button, not only by waiting it out.

### Appearance

- 149 terminal-inspired themes with derive-ladder color mapping
- Scrollbars are styled to match native macOS, per theme

### Language

FixLang is available in **English** and **Japanese**. On first run, the app automatically uses your system language (English if your system language is not one of the supported ones). You can change the language anytime in **Settings → General → Language**, or from the tray popover, without restarting the app. The tray popover also has a quick switch for transform output mode (**Direct paste** / **Show popup**), right below the language switch, plus **global** model and reasoning-effort selectors (presets can override both in Settings → Transform). At the top it shows a **Providers** card with one tab per connected, usage-capable provider — OpenRouter shows remaining credit, OpenAI shows the last 7 days of billed spend for the project set in **Settings → General → OpenAI → Project ID**. Clicking the figure opens that provider's Usage sub-tab. History rows with a saved session expose a Show details (eye) control with the raw completion JSON.

### Provider setup (Settings → General)

You can connect multiple providers at once. Each connected provider's models appear in the model picker, grouped by provider. A preset can use any connected provider, independently of which is the global default.

**Connect a provider:**

1. Open Settings → General → Providers
2. For each provider you want to use:
   - Enter its API key when required (OpenAI and OpenRouter need keys; Ollama needs none but accepts host/port like LM Studio; LM Studio accepts an optional key plus host/port for its local server)
   - Optionally add an admin key to unlock that provider's **Usage** sub-tab: an OpenRouter provisioning key, or an OpenAI Admin API key (`sk-admin-…`, organization owner). Admin keys are read only in the main process and never returned to the UI.
   - OpenAI only: optionally set a **Project ID** (`proj_…`) so the tray's Providers card can report that project's billed spend. An admin key covers the whole organization, so OpenAI cannot tell FixLang which project you meant.
   - Click **Connect** — this validates the credentials and fetches that provider's model list
3. Choose a default model for the profile
4. A preset's model selector shows all connected providers' models, grouped by provider

**Disconnect a provider:**

If you disconnect a provider, only the presets and settings that were using it get reset — their model reference changes to "inherit from global default". Other presets keep their settings intact.

**Cost:** Direct OpenAI requests report cost as N/A (no per-token pricing available). OpenRouter cost is estimated from OpenRouter's published pricing. Ollama and LM Studio (local) are always zero cost.

### App updates

- The dashboard's **About** tab compares the installed version with what
  Homebrew can actually install, since that is what **Update now** runs. Manual
  DMG installs fall back to comparing against the latest stable GitHub Release.
- The tray popover also has a quick **check for updates** button; it reports the
  result in a native dialog and links to the release. Installing still happens
  from the About tab.
- **Homebrew installs (recommended)**: when a newer version is available,
  **Update now** runs `brew update && brew upgrade --cask fixlang` for you.
  FixLang quits so Homebrew can replace the bundle, then reopens on the new
  version. The button appears only when the running app came from the cask.
- **The download runs with FixLang still open**, showing a progress bar and a
  byte count in the About panel. The app only quits once the DMG is on disk, and
  the remaining bundle swap takes a few seconds before it reopens itself.
- **Don't reopen FixLang during those few seconds.** If you do, you get the old
  version back and macOS re-verifies the freshly installed bundle, which is what
  makes that launch slow. The About panel then says the upgrade is still running
  — that is not a failure, and clicking **Update now** again would only collide
  with the upgrade in progress. Once Homebrew finishes, the panel offers
  **Restart now** to switch to the installed version.
- **Right after a release**, the Homebrew tap can still be a few hours behind
  GitHub. FixLang then reports that the version exists but Homebrew has not
  picked it up yet, instead of offering a button that could not install it. The
  panel still shows that release's notes next to a **Download from GitHub**
  button, so you can read what changed and install the DMG yourself, or wait and
  check again later. Only the download size and progress bar are missing, since
  they belong to an install that cannot start yet.
- **Manual DMG installs**: **Download from GitHub** opens that exact release;
  replace the app in `/Applications` yourself. Source and development builds are
  not updated by this flow.
- FixLang never downloads or replaces itself, and nothing installs without that
  explicit click. If the upgrade does not complete, the next launch reports it
  instead of failing silently; details are in
  `~/Library/Application Support/fix-lang/logs/homebrew-update.log`.

## Installation

### From release

1. Download the Apple Silicon (`arm64`) DMG from the [latest FixLang
   release](https://github.com/anhdd-kuro/fix-lang/releases/latest).
2. Optionally download `SHA256SUMS.txt` from the same release and verify the
   DMG before opening it. Run the following in the download folder, then compare
   its output with the matching line in `SHA256SUMS.txt`:

   ```bash
   shasum -a 256 "FixLang-<version>-arm64.dmg"
   ```
3. Open the DMG and drag FixLang to `/Applications`. To update an existing
   installation, quit FixLang first and replace `/Applications/FixLang.app`.
4. Open the app, go to Settings → General to connect one or more providers (see
   [Provider setup](#provider-setup-settings--general)), and grant Accessibility
   permission when prompted.

FixLang releases are unsigned and not notarized. macOS Gatekeeper may warn or
block the app. Only if you downloaded a release you trust and Gatekeeper blocks
it, run:

```bash
xattr -dr com.apple.quarantine "/Applications/FixLang.app"
```

### With Homebrew (Apple Silicon)

FixLang is available through the public tap, which automatically synchronizes
verified stable [GitHub
Releases](https://github.com/anhdd-kuro/fix-lang/releases); it does not build,
sign, notarize, or change the app. New releases normally appear in the tap
within six hours of being published.

Install it with:

```bash
brew install --cask anhdd-kuro/tap/fixlang
```

Homebrew adds `anhdd-kuro/tap` automatically. If you prefer to add the tap
first, run `brew tap anhdd-kuro/tap`, then `brew install --cask fixlang`.

To receive a newer release through Homebrew:

```bash
brew update && brew upgrade --cask fixlang
```

If `brew upgrade --cask fixlang` reports `Error: Cask 'fixlang' is
unavailable: No Cask with this name exists`, the tap has not been added on this
machine (for example, you installed the DMG manually). Add the tap and install
once:

```bash
brew tap anhdd-kuro/tap
brew install --cask anhdd-kuro/tap/fixlang
```

If the app already exists from a manual install, adopt it with `--force`:

```bash
brew install --cask --force anhdd-kuro/tap/fixlang
```

After the tap is added, upgrades also work with the fully-qualified name:

```bash
brew upgrade --cask anhdd-kuro/tap/fixlang
```

To remove it:

```bash
brew uninstall --cask fixlang
```

Homebrew may ask you to review and trust this third-party cask. You can approve
that prompt, or explicitly trust only this cask first:

```bash
brew trust --cask anhdd-kuro/tap/fixlang
```

FixLang remains unsigned. Homebrew does not bypass Gatekeeper or grant
Accessibility permission. If macOS blocks a release you trust, use the manual
`xattr` command above; grant Accessibility permission when FixLang asks. The
app's **About** tab delegates its **Update now** button to `brew upgrade --cask
fixlang` — it is not a self-updater, and it never touches Gatekeeper.

### Build from source

Requires [bun](https://bun.sh).

```bash
git clone <repo-url>
cd fix-lang
bun install
bun run pack:mac       # → release/mac-arm64/FixLang Dev.app — dev identity
bun run pack:mac:prod  # → release/mac-arm64/FixLang.app — production identity
bun run pack:install   # pack:mac:prod + copy to /Applications/FixLang.app
```

`pack:mac` deliberately builds as **FixLang Dev** (`com.fixlang.app.dev`) so a
local build cannot be mistaken for the installed app — macOS opens apps by
bundle id, and a checkout sharing `com.fixlang.app` could be reopened in place of
the real one after a Homebrew upgrade. Use `pack:mac:prod` when you specifically
want a production-identity build. Both share the same `userData` directory, so a
dev build reads and writes your real history, logs, and keys.

### Feature tags (opt-in features)

Some features only ship when their tag is given to the build command. **If the
tag is absent, the feature is excluded from the build** — no renderer bundle is
emitted for it, its global hotkey is never registered (so the key stays free for
other apps), its IPC handlers are not installed, and its settings tab is hidden.

| Feature | Tag | Env form |
| --- | --- | --- |
| Prompt generation (PromptGen) | `--promptgen` | `FIXLANG_FEATURES=promptgen` |

```bash
bun run build              # PromptGen EXCLUDED (default)
bun run build:promptgen    # PromptGen included
bun run dev:promptgen      # dev with PromptGen
bun run pack:mac:promptgen # packaged app with PromptGen

# Equivalent long forms
FIXLANG_FEATURES=promptgen bun run build
FIXLANG_FEATURES=all bun run build   # every feature tag on
```

Grammar: `--promptgen` / `--promptgen=true|1|yes|on` enable;
`--no-promptgen` / `--promptgen=false|0|no|off` disable. `FIXLANG_FEATURES`
takes a comma- or space-separated tag list (`all` enables everything), and
explicit CLI tags override the env value. Unknown tags are ignored.

The prebuilt DMGs on the Releases page are produced by the plain `build`
command, so they currently ship **without** PromptGen — build from source with
the tag if you want it.

## Usage

1. Select text in any application (or copy to clipboard)
2. Press a preset hotkey (default: `Ctrl+Shift+F` for Correction)
3. FixLang delivers the result using the mode selected in **Settings → General → Transform output**: **Direct paste** or **Show popup**
4. Open the tray popover → dashboard icon for Overview, History, Models, Usage, Logs, or About
5. `Ctrl+Shift+G` opens PromptGen on the current selection — tag-on builds only, see [Feature tags](#feature-tags-opt-in-features)
6. `Ctrl+Shift+P` cycles to the next profile
7. `Ctrl+Shift+A` opens **Ask AI**'s input window — no selection required; any selected text is carried along as optional context

Hotkeys are customizable per preset and for global actions (PromptGen where built in, profile switch) in Settings. Transform output mode is global and defaults to **Direct paste**, but each preset can override it to Paste or Popup in Settings → Correction.

## Development

```bash
bun run dev            # hot reload (predev runs build first)
bun run build          # production build
bun run start          # preview production build
bun run test           # Vitest once — use `bun run test`, NOT `bun test`
bun run test:w         # Vitest watch
bun run lint           # ESLint (cached)
bun run i18n:check     # catalog parity, plurals, sort order, JA coverage
bun run check:bundle   # after `bun run build` — verify no runtime dep needs node_modules
bun run themes:generate  # after editing theme .ts files
```

> `bun test` invokes bun's own runner and ignores the Vitest config.

> **The packaged app ships no `node_modules`** (`build.files` excludes it — see
> [Publishing a macOS release](#publishing-a-macos-release)). Every runtime
> dependency must be inlined by Vite into `out/`. Adding a dependency and
> importing it passes `bun run dev`, `bun run test`, and `bun run lint`
> unchanged — the only thing that catches a dependency Vite left external is
> `bun run check:bundle` against a real `bun run build`. Run it locally after
> adding or upgrading a runtime dependency; every script that packages a
> distributable (`pack`, `pack:mac`, `pack:mac:prod`, `release:mac`) and the
> release workflow run it too. Because nothing resolves from `node_modules` at
> runtime, the `dependencies` / `devDependencies` split no longer says which
> packages ship — what ships is whatever Vite inlined into `out/`.

## Publishing a macOS release

FixLang distributes unsigned Apple Silicon macOS releases through public GitHub
Releases. No Apple ID, Developer ID certificate, notarization, or GitHub Actions
secrets are required. This keeps publishing simple, but users will encounter the
Gatekeeper warning described above.

Release a version by increasing `package.json` to a strictly higher stable
version, running the checks locally, committing the version bump, and pushing it
to `main`. For example:

```bash
bun run lint
bun run test
bun run i18n:check
bun run build
bun run check:bundle
git add package.json bun.lock
git commit -m "chore(release): bump version to 0.7.0"
git push origin main
```

The release workflow creates `v<version>` at the pushed commit when that version
does not already have a tag. It runs the same checks (lint, test, i18n catalog,
build, bundle externals), publishes the validated `FixLang-<version>-arm64.dmg`
and `SHA256SUMS.txt` from a draft release, then makes the release public. Later
pushes with a version that already has a public release skip publication.

Before uploading, the workflow mounts the DMG and asserts that its bundle version
matches `package.json`, that `app.asar` contains no `node_modules` entries, and
that `out/renderer` is present — a missing renderer would ship an app that only
shows a white screen. The DMG itself is compressed with LZFSE (`ULFO`), which
together with pruning the Electron locale packs down to `en` and `ja` and
dropping `node_modules` from the bundle keeps the download around 102 MiB.

Matching `v<version>` tag pushes remain supported. The workflow rejects a tag
whose version differs from `package.json` or whose commit is not on `main`.
Existing tags are never moved, and public release assets are never replaced. If a
run leaves a tag with a missing or draft release, re-run the failed workflow or
push `main` again with that same version; do not delete or rewrite the tag.

The protected `v*` tag ruleset allows new tag creation by the repository
`GITHUB_TOKEN`, while preventing existing release tags from being updated or
deleted. The workflow independently validates every release tag against `main`
and `package.json`. Keep the repository public: the in-app check reads public
GitHub Releases.

## Security

- API keys and provider admin keys (OpenRouter provisioning, OpenAI Admin) are handled main-process-only — encrypted at rest via the OS keychain (Electron `safeStorage`) — and are never sent back to the renderer/UI process after being saved.
- Keys are never included in profile import or export; exporting a profile shares its settings, never its credentials.
- Secrets are scoped to one profile and one provider at a time — switching profiles switches the whole connected set, and neither another profile nor another provider can read a key it did not store.
- A freshly created profile has no provider connected — nothing is auto-selected or auto-populated from another profile.
- Requests are sent only to the providers you connect (OpenAI, OpenRouter, Ollama, or LM Studio), and each request carries only that provider's key. Structured logs redact keys, tokens, and clipboard content before writing to disk.

## License

MIT
