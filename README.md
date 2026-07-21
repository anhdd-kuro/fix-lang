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

### Appearance

- 149 terminal-inspired themes with derive-ladder color mapping

### App updates

- Installed releases can check for signed FixLang updates from **Settings → General → App updates**
- Updates are shown with their version and release notes, then download only after you choose **Download update**
- Once downloaded, choose **Restart to update** to apply it; source and development builds remain unchanged

## Installation

### From release

1. Download the latest `.dmg` from the releases page
2. Open the `.dmg` and drag FixLang to Applications
3. Open the app, enter your API key(s) in Settings, and grant Accessibility permission when prompted
4. Keep the app current from **Settings → General → App updates**

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

FixLang distributes Apple Silicon macOS releases through public GitHub Releases. The app checks the release metadata and verifies the downloaded update before offering a restart.

Before publishing, configure these GitHub Actions secrets from an Apple Developer account:

- `MAC_CSC_LINK` — base64-encoded **Developer ID Application** `.p12` certificate
- `MAC_CSC_KEY_PASSWORD` — certificate password
- `APPLE_API_KEY` — base64-encoded App Store Connect API key (`.p8`)
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, and `APPLE_TEAM_ID`

Release a version by updating `package.json`, running the checks locally, committing the version bump, and pushing it to `main`. For example:

```bash
bun run lint
bun run test
git add package.json bun.lock
git commit -m "chore(release): bump version to 0.3.0"
git push origin main
```

When `main` contains a package version without a matching tag, the workflow verifies the signing secrets, creates `v<version>` at that exact commit, builds and notarizes `FixLang-<version>-arm64.dmg` and `.zip`, uploads them with `latest-mac.yml` to a draft release, validates the signed app, then makes the completed release public. Later pushes with the same published version skip publication. If a previous run created the tag but failed before publishing, rerunning it or pushing `main` again resumes from that protected tag.

As a recovery path, a matching `v<version>` tag may still be pushed manually. The workflow rejects tags whose version differs from `package.json` or whose commit is not on `main`. Existing tags are never moved, and public release assets are never replaced.

The protected `v*` tag ruleset allows new tag creation so the repository `GITHUB_TOKEN` can create releases without a long-lived PAT, but prevents existing release tags from being updated or deleted. The workflow independently validates every release tag against `main` and `package.json`. Keep workflow permissions read-only by default and grant `contents: write` only to the release preparation and publishing jobs. Do not publish a release until the repository itself is public; end-user update checks intentionally require public GitHub Releases.

The workflow decodes `APPLE_API_KEY` only into the runner’s temporary directory immediately before packaging and removes that temporary `.p8` file on every exit path.

## Security

API keys are stored locally via electron-store and sent only to the provider you configure (OpenAI, OpenRouter, or your local Ollama instance). Structured logs redact keys, tokens, and clipboard content before writing to disk.

## License

MIT
