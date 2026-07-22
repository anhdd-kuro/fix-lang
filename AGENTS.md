# FixLang — Instructions

## Overview

Local macOS menu-bar app: fixes grammar and improves writing on selected text via AI (OpenAI, OpenRouter, Ollama). Electron + React + TypeScript, runs on **bun**.

## Main Features

- **Correction** — fix grammar/style on selected text via per-preset global hotkeys.
- **Presets** — built-in Correction, Summarize, Translate, Prompt optimization; each preset has its own hotkey, model, and system prompt.
- **Prompt generation** — build AI prompts from selected text (PromptGen window).
- **Profiles** — switch correction presets; switch reloads hotkeys + settings + history.
- **Multi-provider** — OpenAI, OpenRouter, Ollama; model discovery/compat/monitor.
- **History** — SQLite-backed correction + PromptGen history with cost tracking.
- **Analytics** — Overview dashboard: stat cards, preset donut/time-series charts (`PresetWeightChart`), token activity calendar, benchmark sentence; shared All/30d/7d range with Models tab.
- **Logs** — structured, redacted JSONL persistence (`userData/logs/{YYYY-MM-DD}/fixlang.jsonl`); Logs tab with level filter, search, copy/export, virtual infinite scroll.
- **Hotkeys** — customizable global shortcuts (promptGen, profileSwitch) plus per-preset correction hotkeys.

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
  - Electron 43.1, electron-vite 5.0, Vite 8.1, bun
- Frontend
  - React 19.2, TypeScript 6.0 (stay on 6.x until typescript-eslint supports 7), Tailwind 4.3
- AI
  - openai 6.48, @openrouter/ai-sdk-provider 3.0, ai 7.0, ollama 0.6
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
```

## How to Work

- **Use bun** — not npm/pnpm; lockfile is `bun.lock`.
- **Explore with gitnexus first** — use MCP over grep/find; fallback only if unavailable.
- **Verify before finishing** — run `bun run test`; for UI changes, also check in `bun run dev` before packaging.
- **Ask through tools** — use structured question tools, not plain-prose questions.
- **Update docs when behavior changes** — spawn sub-agents or update instruction files at task end.
- **Commits** — Conventional Commits on `feature/*` or `fix/*` branches from `main`.

## Boundaries

✅ Always:

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

## References

- [README](README.md) — features, dashboard tabs, hotkeys, build/install.

## Known Gotchas

Project-specific traps under `.claude/skills/fixlang/`:

- [Hotkeys](.claude/skills/fixlang/fixlang-hotkeys/SKILL.md) — preset hotkey reload on profile switch (silent failures) + pre-save conflict validation.
- [Prompt bundling](.claude/skills/fixlang/fixlang-prompt-bundling/SKILL.md) — prompts bundle at build time from `src/prompts/`, not `~/.agents/`; rebuild + reinstall to apply.
- [Profile state](.claude/skills/fixlang/fixlang-profile-state/SKILL.md) — profile switch must atomically reload hotkeys + settings UI + history.
- [Theme mapping](.claude/skills/fixlang/fixlang-theme-mapping/SKILL.md) — derive-ladder + composite-alpha strategy; run `bun run themes:generate` after theme .ts edits, then `bun run test` to validate all 149 themes.
- [Package upgrade](.claude/skills/fixlang/fixlang-pkg-upgrade/SKILL.md) — wave-based bun upgrades; pin TypeScript to 6.x; Electron 43+ requires main/preload CommonJS (`.cjs`) or app shows white screen; unset `ELECTRON_RUN_AS_NODE` when launching Electron from Cursor's terminal.
