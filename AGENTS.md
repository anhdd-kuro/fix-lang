# FixLang — Agent Context

Local macOS menu-bar app: fixes grammar / improves writing on selected text via AI (OpenAI, OpenRouter, Ollama). Electron + React + TypeScript. Runs on **bun**.

When you need to ask the user something, use the "ask user question" / "require user input" or any relevant tools that are available.

## Main Features

- **Correction** — fix grammar/style on clipboard text via global hotkey.
- **Prompt generation** — build AI prompts from selected text (PromptGen window).
- **Profiles** — switch correction presets; switch reloads hotkeys + settings + history.
- **Multi-provider** — OpenAI, OpenRouter, Ollama; model discovery/compat/monitor.
- **History** — SQLite-backed correction history with cost tracking.
- **Analytics** — overview dashboard (token activity heatmap).
- **Hotkeys** — customizable global shortcuts (correction, promptGen, profile switch).

## Commands

```bash
bun run dev            # Dev with hot reload (electron-vite); predev runs build first
bun run build          # Production build (electron-vite)
bun run start          # Preview the production build
bun run pack:mac       # Build + package macOS app (dmg, zip) → release/
bun run pack:install   # Package + install to /Applications/FixLang.app
bun run test           # Vitest once, no watch  ⚠️ use `bun run test`, NOT `bun test`
bun run test:w         # Vitest watch mode
bun run lint           # ESLint (cached)
```

> `bun test` invokes bun's own runner and ignores vitest config — always `bun run test`.

## Project Structure

```
src/
  main/                  # Electron main process
    ai.request/          # AI calls + cost.ts, cache-strategy, resolve-model
    ipc/features/        # IPC handlers: api, correction, history, profiles, promptgen, settings, ui, openrouter
    keybindings/         # Global hotkeys (correction, promptGen, profileSwitch)
    llm/                 # Provider models (discover/compat/monitor), openrouter client, ollama
    webViewWindows/      # Window lifecycle (mainWindow, promptGenWindow, overlay, tray)
    index.ts             # Main entry, app bootstrap
  renderer/              # React UI, one folder per window
    MainWindow/ PromptGenWindow/ TrayWindow/ analytics/
    components/ hooks/    # Shared UI + hooks
  preload/features/      # IPC bridge (renderer ↔ main)
  stores/                # Persistence: historyDb (node:sqlite), apiStore, keybindingStore, provisioningKeyStore (electron-store)
  prompts/               # Bundled AI prompt assets — see gotchas
  const.ts utils.ts      # Shared constants + helpers
```

## Tech Stack

- **Runtime/build**: Electron 41.8, electron-vite 5.0, Vite 8.0, bun
- **Frontend**: React 19.2, TypeScript 6.0 (strict), Tailwind CSS 4.3, react-select
- **Testing**: Vitest 4.1 + @vitest/coverage-v8, jsdom
- **AI**: openai 6.44, @openrouter/ai-sdk-provider 2.9, ai (Vercel) 6.0, ollama 0.6
- **Persistence**: node:sqlite (history) + electron-store 11 (api/keybinding/provisioning) — no zustand
- **Lint/format**: ESLint 10, Prettier 3.8
- **macOS native**: applescript, clipboardy, node-mac-permissions, languagedetect, fuse.js

## Workflow

- Branches: `main` (deployable); feature work on `feature/desc` or `fix/desc`, branched from `main`.
- Commits: Conventional Commits — `feat(correction): ...`, `fix(hotkey): ...`, `chore(deps): ...`.

## Boundaries

✅ **Always**

- Use gitnexus MCP over grep / find for exploration, only fallback to grep / find if gitnexus is not available
- Test UI changes in `bun run dev` before packaging.
- Keep prompts bundled locally — no external fetch for prompt content.
- SQLite DB lives under `app.getPath("userData")`, never inside the code-signed bundle.

⚠️ **Ask first**

- Whenever you have anything unclear that can't be answered even by exploring the codebase, try using grill-me to clarify it first.

🚫 **Never**

- Commit secrets, API keys, or `.env`.
- Commit `node_modules`, `out/`, `release/`, `.DS_Store`.
- Reintroduce pnpm — this repo is bun-only (`bun.lock`); no `pnpm-lock.yaml`.
- Use `any` without a why-comment; add sync I/O in the main process (async only); bypass IPC validation in preload.

## GitNexus (code intelligence, optional)

Repo indexed as `fix-lang`. Use for blast-radius checks and safe renames when touching exported symbols: `gitnexus_impact({target, direction:"upstream"})`, rename via `gitnexus_rename` (not find-and-replace), explore with `gitnexus_query`/`gitnexus_context`. Index goes stale after commits — re-run `npx gitnexus analyze`. Deep guidance: `.agents/skills/gitnexus/*`.

## Known Gotchas

Project-specific traps live as skills under `.agents/skills/fixlang/`:

- **[[fixlang-hotkeys]]** — preset hotkey reload on profile switch (silent failures) + pre-save conflict validation.
- **[[fixlang-prompt-bundling]]** — prompts bundle at build time from `src/prompts/`, not `~/.agents/`; rebuild + reinstall to apply.
- **[[fixlang-profile-state]]** — profile switch must atomically reload hotkeys + settings UI + history.
