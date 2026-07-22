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
- Errors use a native macOS notification when available; if macOS rejects it, FixLang shows a brief in-app popup near the cursor instead.

### Appearance

- 149 terminal-inspired themes with derive-ladder color mapping

### Provider setup (General settings)

The **General** tab is the only place a provider is selected — no other tab or window offers a provider control. Setup is staged, so the previously active provider stays in effect until you explicitly apply the new one:

1. Pick a provider: **OpenAI**, **OpenRouter**, or **Ollama**
2. Supply credentials for that provider — an API key for OpenAI/OpenRouter (Ollama needs none), plus an optional OpenRouter provisioning key
3. **Fetch models** — pulls the model list for the provider you just staged, without touching the active provider or profile
4. Choose a default model from the fetched list
5. **Apply** — validates the credentials and model together, then atomically switches the profile's active provider, default model, and cached model list. If Apply fails, nothing changes — the old provider, model, and keys remain in effect
6. Every open window (tray popover, dashboard tabs, PromptGen) picks up the switch immediately

Model selectors elsewhere (Tray, Models tab, Correction presets, PromptGen) show a small provider badge next to "AI Model" so it's always clear which provider a selection belongs to.

**Cost**: Direct OpenAI requests report cost as N/A (no per-token pricing available). OpenRouter cost is estimated from OpenRouter's published pricing. Ollama (local) is always zero cost.

## Installation

### From release

1. Download the latest `.dmg` from the releases page
2. Open the `.dmg` and drag FixLang to Applications
3. Open the app, go to Settings → General to select a provider and apply your setup (see [Provider setup](#provider-setup-general-settings)), and grant Accessibility permission when prompted

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

- API keys and the OpenRouter provisioning key are handled main-process-only — encrypted at rest via the OS keychain (Electron `safeStorage`) — and are never sent back to the renderer/UI process after being saved.
- Keys are never included in profile import or export; exporting a profile shares its settings, never its credentials.
- Each profile has its own provider and its own set of keys — switching profiles switches providers, and secrets from one profile are never visible to another.
- A freshly created profile starts as an unconfigured OpenRouter provider — no provider is auto-selected or auto-populated from another profile.
- Requests are sent only to the provider you configure (OpenAI, OpenRouter, or your local Ollama instance). Structured logs redact keys, tokens, and clipboard content before writing to disk.

## License

MIT
