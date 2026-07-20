# FixLang

A local macOS menu-bar app that fixes grammar, improves writing, and runs other text transformations on selected text via AI. Supports **OpenAI**, **OpenRouter**, and **Ollama**. Runs entirely on your machine; API keys stay in local storage.

## Features

### Correction & presets

- Select text in any app, press a preset hotkey — corrected text is pasted back automatically
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

## Installation

### From release

1. Download the latest `.dmg` from the releases page
2. Open the `.dmg` and drag FixLang to Applications
3. Open the app, enter your API key(s) in Settings, and grant Accessibility permission when prompted

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
3. Corrected text is pasted in place; history and cost are recorded in the dashboard
4. Open the tray popover → dashboard icon for Overview, History, Models, OpenRouter, or Logs
5. `Ctrl+Shift+G` opens PromptGen on the current selection
6. `Ctrl+Shift+P` cycles to the next profile

Hotkeys are customizable per preset and for global actions (PromptGen, profile switch) in Settings.

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

## Security

API keys are stored locally via electron-store and sent only to the provider you configure (OpenAI, OpenRouter, or your local Ollama instance). Structured logs redact keys, tokens, and clipboard content before writing to disk.

## License

MIT
