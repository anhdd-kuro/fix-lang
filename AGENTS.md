# FixLang — Agent Context

macOS menu-bar app that fixes grammar / improves writing on selected text via AI (OpenAI, OpenRouter, Ollama). Electron + React + TypeScript. Runs on **bun**.
When you want to ask the user a question, always use "ask user questions," "require user input," or any related tools.

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
    ai.request/          # AI calls per feature (correction, translate, promptGen) + cache-strategy
    ipc/                 # IPC handlers: api, correction, history, profiles, settings, translation, ui
    keybindings/         # Global hotkeys (correction, translation, promptGen, profileSwitch)
    llm/                 # Provider discovery/compat/monitor + ollama, models
    webViewWindows/      # Window lifecycle (mainWindow, translationWindow, promptGenWindow, tray)
    index.ts             # Main entry, app bootstrap
  renderer/              # React UI, one folder per window
    MainWindow/ TranslationWindow/ PromptGenWindow/ SummaryWindow/ TrayWindow/
    components/ hooks/    # Shared UI + hooks
  preload/               # IPC bridge (renderer ↔ main), features/
  stores/                # Persistent state via electron-store (api, history, keybinding)
  prompts/               # Bundled AI prompt assets (Prompt Master, Strategic Compact) — see gotchas
  workflow/              # Workflow layer
  const.ts utils.ts      # Shared constants + helpers
```

## Tech Stack

- **Runtime/build**: Electron 41.3, electron-vite 5.0, Vite 8.0, bun
- **Frontend**: React 19.2, TypeScript 6.0 (strict), Tailwind CSS 4.2, react-select
- **Testing**: Vitest 4.1 + @vitest/coverage-v8, jsdom
- **AI**: openai 6.34, @openrouter/ai-sdk-provider, ai (Vercel) 6.0, ollama 0.6
- **State/persistence**: electron-store 11 (no zustand)
- **Lint/format**: ESLint 10, Prettier 3.8
- **macOS native**: applescript, clipboardy, node-mac-permissions, languagedetect, fuse.js

## Code Style

```typescript
// ✅ DO: named exports, explicit return types, const arrow fns
export const formatPrompt = (text: string): string => text.trim();

// ❌ DON'T: default exports, implicit any
export default function (text) { return text.trim(); }
```

- `strict: true` — no implicit `any`; use `unknown` + type guard (with a why-comment) instead of `any`.
- Naming: PascalCase (components/types), camelCase (fns/vars), SCREAMING_SNAKE_CASE (constants), boolean prefixes `is`/`has`/`should`/`can`.
- Functional components only. Props destructured inline. Stable dep arrays in `useEffect`/`useCallback`.

## Workflow

- Branches: `main` (deployable), feature work on `feature/desc` or `fix/desc`, branched from `main`.
- Commits: Conventional Commits — `feat(correction): ...`, `fix(hotkey): ...`, `chore(deps): ...`.

## GitNexus (code intelligence)

Repo indexed as `fix-lang`. Before editing any symbol, run `gitnexus_impact({target, direction:"upstream"})` and report blast radius; warn on HIGH/CRITICAL. Run `gitnexus_detect_changes()` before committing. Rename via `gitnexus_rename` (never find-and-replace). Explore with `gitnexus_query` / `gitnexus_context` instead of grep. Index goes stale after commits — `npx gitnexus analyze` (add `--embeddings` to preserve them). Deep guidance: `.claude/skills/gitnexus/*`.

## Boundaries

✅ **Always**

- Run `gitnexus_impact` before modifying an exported function/class; `gitnexus_detect_changes()` before commit.
- Test UI changes in `bun run dev` before packaging.
- Keep prompts bundled locally — no external fetch for prompt content.

⚠️ **Ask first**

- Adding npm deps (bundle size), modifying main process (app lifecycle), changing AI provider integration, altering prompt bundling.

🚫 **Never**

- Commit secrets, API keys, or `.env`.
- Commit `node_modules`, `out/`, `release/`, `.DS_Store`.
- Reintroduce pnpm — this repo is bun-only (`bun.lock`); no `pnpm-lock.yaml`/`pnpm-workspace.yaml`.
- Use `any` without a why-comment; add sync I/O in the main process (async only); bypass IPC validation in preload.

## Known Gotchas

Project-specific traps live as skills under `.claude/skills/fixlang/`:

- **[[fixlang-hotkeys]]** — preset hotkey reload on profile switch (silent failures) + pre-save conflict validation.
- **[[fixlang-prompt-bundling]]** — prompts bundle at build time from `src/prompts/`, not `~/.agents/`; rebuild + reinstall to apply.
- **[[fixlang-profile-state]]** — profile switch must atomically reload hotkeys + settings UI + history.
