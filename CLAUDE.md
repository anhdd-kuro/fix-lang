# FixLang — Claude Context

FixLang is a macOS app that uses OpenAI to fix grammar and improve writing style via text selection corrections. Built with Electron, React, TypeScript, and Vite.

---

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **fix-lang** (396 symbols, 914 relationships, 26 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/fix-lang/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool             | When to use                   | Command                                                                 |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `query`          | Find code by concept          | `gitnexus_query({query: "auth validation"})`                            |
| `context`        | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})`                              |
| `impact`         | Blast radius before editing   | `gitnexus_impact({target: "X", direction: "upstream"})`                 |
| `detect_changes` | Pre-commit scope check        | `gitnexus_detect_changes({scope: "staged"})`                            |
| `rename`         | Safe multi-file rename        | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher`         | Custom graph queries          | `gitnexus_cypher({query: "MATCH ..."})`                                 |

## Impact Risk Levels

| Depth | Meaning                               | Action                |
| ----- | ------------------------------------- | --------------------- |
| d=1   | WILL BREAK — direct callers/importers | MUST update these     |
| d=2   | LIKELY AFFECTED — indirect deps       | Should test           |
| d=3   | MAY NEED TESTING — transitive         | Test if critical path |

## Resources

| Resource                                  | Use for                                  |
| ----------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/fix-lang/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/fix-lang/clusters`       | All functional areas                     |
| `gitnexus://repo/fix-lang/processes`      | All execution flows                      |
| `gitnexus://repo/fix-lang/process/{name}` | Step-by-step execution trace             |

## Self-Check Before Finishing

Before completing any code modification task, verify:

1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

---

## Commands

```bash
pnpm dev                    # Start dev server with hot reload (electron-vite)
pnpm build                  # Build for production (electron-vite)
pnpm pack:mac               # Build and package macOS app (dmg, zip) → release/
pnpm pack:install           # Build, package, and install to /Applications/FixLang.app
pnpm start                  # Preview production build with electron
pnpm test                   # Run vitest suite once (no watch)
pnpm test:w                 # Run vitest in watch mode
pnpm lint                   # Run ESLint with cache
pnpm vitest                 # Vitest CLI (can add flags like --coverage)
```

## Project Structure

```
src/
  main/                     # Electron main process (IPC handlers, window lifecycle)
    ai.request/             # AI service integration (OpenAI, OpenRouter, Ollama)
    settings/               # Settings persistence (electron-store)
    window/                 # Window management (menu, shortcuts, lifecycle)
    index.ts                # Main entry point, window creation
  renderer/                 # React UI (correction UI, settings screens)
    components/             # Reusable components (SettingsForm, ProfileSelector)
    screens/                # Page-level components (CorrectionScreen, SettingsUI)
    hooks/                  # Custom React hooks for state, API calls
    index.tsx               # React root
  preload/                  # Preload script (IPC bridge for renderer ↔ main)
    index.ts                # Exposes safe IPC APIs to renderer
  stores/                   # Zustand state management (correction history, UI state)
  prompts/                  # Bundled prompt assets for AI requests
    correction.ts           # Prompt composition (Prompt Master, Strategic Compact)
    prompt-master-*.md      # Bundled Prompt Master skill content
    strategic-compact-*.md  # Bundled Strategic Compact skill content
  utils.ts                  # Shared utilities (validation, formatting, helpers)
  const.ts                  # Constants (window dimensions, config defaults)
  workflow/                 # Workflow execution layer (not active in current flow)

vitest.config.ts            # Vitest configuration with coverage
tsconfig.json               # TypeScript strict mode (target: es2020, jsx: react)
electron.vite.config.ts     # Electron-vite config (main + renderer build)
eslint.config.js            # ESLint rules (prettier, tailwindcss, import)
package.json                # Dependencies: React 19, Electron 41, Vite 7, TypeScript 5.8
pnpm-lock.yaml              # Locked dependency versions
```

## Tech Stack

- **Runtime**: Electron 41.1, Node.js/Bun
- **Frontend**: React 19.2.4, TypeScript 5.8
- **Styling**: Tailwind CSS 4.2, react-select for dropdowns
- **Build**: Electron-vite 5.0, Vite 7.3
- **Testing**: Vitest 3.2.4, JSDOM, Coverage (v8)
- **AI Integration**: OpenAI SDK 6.33, OpenRouter provider, Ollama SDK
- **State**: Zustand (client-side), electron-store (persistent)
- **Linting**: ESLint 9.39, Prettier 3.8
- **macOS Integration**: applescript, clipboardy, node-mac-permissions

## Code Style

```typescript
// ✅ DO: Named exports, explicit return types, const for functions
export const formatPrompt = (text: string): string => {
  return text.trim();
};

// ❌ DON'T: Default exports, implicit `any` types
export default function (text) {
  return text.trim();
}
```

**Type Safety:**

- `strict: true` in tsconfig.json — no implicit `any`
- Always type function parameters and return values
- Use `unknown` + type guard instead of `any` (with comment explaining why)

**Naming Conventions:**

- PascalCase: Components, types, classes
- camelCase: functions, variables, imports
- SCREAMING_SNAKE_CASE: constants (e.g., `DEFAULT_PROMPT_OPTIMIZATION_PROMPT`)
- Prefixes for booleans: `is`, `has`, `should`, `can`

**React Components:**

- Functional components only (no class components)
- Props destructured inline: `({ prop1, prop2 }: Props)`
- Hooks: use stable dependency arrays in useEffect, useCallback
- Memoization: use React.memo only if prop comparison is expensive

## Workflow

**Branches:**

- Main branch: `main` — always deployable
- Feature work: `feature/description` or `fix/description`
- Create branch from `main` and push to origin before opening PR

**Commits:**

- Conventional Commits format: `type(scope): message`
  - `feat(correction): add summarize preset`
  - `fix(hotkey): reload bindings after profile switch`
  - `chore(deps): upgrade typescript to 5.8`
  - `docs(claude): update context file`

**PRs & Merging:**

- Always squash merge to keep main history clean
- CI must pass before merge (linting, tests, type check)
- Link Linear issues in PR body: `Closes ANH-123`

## Boundaries

✅ **Always:**

- Run `gitnexus_impact` before modifying any exported function or class
- Run `gitnexus_detect_changes()` before committing
- Test UI changes in dev mode (`pnpm dev`) before packaging
- Check CI logs if build fails unexpectedly
- Keep corrections bundled locally (no external network fetches for prompts)

⚠️ **Ask first:**

- Adding new npm dependencies (may bloat bundle)
- Modifying electron main process (affects app lifecycle)
- Changing AI provider integration (affects user configuration)
- Modifying prompt bundling workflow (affects build time)

🚫 **Never:**

- Commit secrets, API keys, or `.env` file contents
- Commit `node_modules`, `out/`, `release/`, or `.DS_Store`
- Use `any` types without a comment explaining unavoidable reason
- Modify Electron version without testing app packaging
- Add synchronous I/O calls in main process (use async/await)
- Bypass IPC security — always validate messages in preload
- Change hotkey system without updating CLAUDE.md hotkey rules

## Known Gotchas

### Correction Preset Hotkey Reload

When a user:

1. Saves correction preset settings
2. Switches profiles

The app **must reload hotkeys immediately** to reflect preset changes. Stale hotkey bindings will cause corrections to fail silently.

### Prompt Bundling vs. Runtime Discovery

Prompt Master and Strategic Compact are **bundled into the app at build time** (not loaded from `~/.agents/skills/`). If you update bundled prompt files:

1. Update `src/prompts/prompt-master-*.md` or `src/prompts/strategic-compact-*.md`
2. Rebuild app: `pnpm pack:mac`
3. Reinstall: `pnpm pack:install`

Runtime changes to `~/.agents/...` files will **NOT** affect the app.

### Preset Hotkey Conflict Validation

Correction preset hotkeys must avoid conflicts with:

- Other correction presets
- Static app hotkeys: `translate`, `promptGen`, `profileSwitch`

Validation must happen **before saving** in the Correction settings UI.

### Profile Switching and State Sync

Profile switching triggers:

- Hotkey reload (for preset-specific bindings)
- Settings UI refresh
- History clear or reload (depending on per-profile history setting)

All three must complete atomically, or users see stale state.
