# FixLang

A local macOS menu-bar app that fixes grammar, improves writing, and runs other text transformations on selected text via AI. Supports **OpenAI**, **OpenRouter**, and **Ollama**. Runs entirely on your machine; API keys stay in local storage.

## Features

### Correction & presets

- Select text in any app, press a preset hotkey, then either paste the correction back automatically or show it in a result-only popup
- Built-in presets (each with its own hotkey): **Correction** (`Ctrl+Shift+F`), **Summarize** (`Ctrl+Shift+S`), **Translate**, **Prompt optimization** (`Ctrl+Shift+D`)
- **Profiles** — multiple named configurations; switch with `Ctrl+Shift+P` (profile switch reloads hotkeys, settings, and history)
- Custom presets with per-preset model, system prompt, and hotkey

### Prompt generation

- **PromptGen** (`Ctrl+Shift+G`) — build AI prompts from selected text in a dedicated window

### Dashboard (MainWindow)

Five tabs, opened from the menu-bar tray or after a correction:

| Tab | What it shows |
| --- | --- |
| **Overview** | Token stats, preset usage charts, Codex-style token activity calendar, benchmark sentence |
| **History** | Correction + PromptGen history with cost tracking; last-action preview |
| **Models** | Provider model discovery, compatibility, and monitoring |
| **OpenRouter** | OpenRouter-specific model and routing controls |
| **Logs** | Structured, redacted app events — filter by level, search, copy/export as `.txt` |

Overview and Models share a time-range filter (All / 30d / 7d).

### Logging

- `src/shared/logging.ts` + `src/main/logging/logService.ts` — structured logs with API-key and clipboard redaction
- Persisted to `userData/logs/{YYYY-MM-DD}/fixlang.jsonl` (one folder per local day)
- Logs tab reloads from disk with virtual infinite scroll (`@tanstack/react-virtual`)
- Errors use a native macOS notification when available; if macOS rejects it, FixLang shows a brief in-app popup near the cursor instead.

### Appearance

- 149 terminal-inspired themes with derive-ladder color mapping

### App updates

- **Settings → General → App updates** compares the installed version with the
  latest stable GitHub Release.
- When a newer version is available, choose **View release** to open that exact
  release in your browser. FixLang does not download or install updates itself.
- Download the DMG and replace the app manually. Source and development builds
  are not updated by this flow.

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
4. Open the app, enter your API key(s) in Settings, and grant Accessibility
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
app's **Settings → General → App updates** check remains a manual GitHub
Release download flow, not an automatic installer.

### Build from source

Requires [bun](https://bun.sh).

```bash
git clone <repo-url>
cd fix-lang
bun install
bun run pack:mac      # → release/mac-arm64/FixLang.app (or release/mac/)
bun run pack:install  # build + copy to /Applications/FixLang.app
```

## Usage

1. Select text in any application (or copy to clipboard)
2. Press a preset hotkey (default: `Ctrl+Shift+F` for Correction)
3. FixLang delivers the result using the mode selected in **Settings → General → Correction output**: **Direct paste** or **Show popup**
4. Open the tray popover → dashboard icon for Overview, History, Models, OpenRouter, or Logs
5. `Ctrl+Shift+G` opens PromptGen on the current selection
6. `Ctrl+Shift+P` cycles to the next profile

Hotkeys are customizable per preset and for global actions (PromptGen, profile switch) in Settings. Correction output mode is global and defaults to **Direct paste**.

## Development

```bash
bun run dev            # hot reload (predev runs build first)
bun run build          # production build
bun run start          # preview production build
bun run test           # Vitest once — use `bun run test`, NOT `bun test`
bun run test:w         # Vitest watch
bun run lint           # ESLint (cached)
bun run themes:generate  # after editing theme .ts files
```

> `bun test` invokes bun's own runner and ignores the Vitest config.

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
git add package.json bun.lock
git commit -m "chore(release): bump version to 0.3.0"
git push origin main
```

The release workflow creates `v<version>` at the pushed commit when that version
does not already have a tag. It runs the project checks, publishes the validated
`FixLang-<version>-arm64.dmg` and `SHA256SUMS.txt` from a draft release, then
makes the release public. Later pushes with a version that already has a public
release skip publication.

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

API keys are stored locally via electron-store and sent only to the provider you configure (OpenAI, OpenRouter, or your local Ollama instance). Structured logs redact keys, tokens, and clipboard content before writing to disk.

## License

MIT
