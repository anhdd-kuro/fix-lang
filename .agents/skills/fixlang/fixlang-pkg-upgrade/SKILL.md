---
name: fixlang-pkg-upgrade
description: "Use when upgrading FixLang npm/bun dependencies, bumping Electron/Vite/AI SDK versions, or diagnosing white-screen / blank UI after a deps update. Examples: \"upgrade all packages\", \"bump electron\", \"bun outdated\", \"white screen after update\". Covers package.json, bun.lock, electron.vite.config.ts, and post-upgrade verification."
---

# FixLang — Package Upgrade Playbook

Bun-only repo (`bun.lock`). Never reintroduce pnpm.

## Baseline before any bump

```bash
bun outdated
bun run build
bun run test   # NOT `bun test` — that ignores vitest config
bun run lint
```

Record counts (tests pass, lint errors). Every wave must stay green vs baseline.

## Upgrade in waves

1. **Safe patch/minor** — bump exact versions with `bun add -E` / `bun add -DE`.
2. **Verify** — `build` + `test` + `lint`.
3. **Risky majors one at a time** — Electron, `ai` + `@openrouter/ai-sdk-provider` (pair), TypeScript, etc. Verify after each.
4. **Final** — `bun outdated`, then smoke: `bun run pack:install` and launch `/Applications/FixLang.app`.

Pin versions in `package.json` (no `^` for app deps). Keep `bun.lock` in the same commit.

## Known pin / break traps

### TypeScript — stay on 6.x

`typescript-eslint` peer: `typescript >=4.8.4 <6.1.0`.

TS 7 breaks ESLint (`Cannot read properties of undefined (reading 'Cjs')`). **Do not bump to TypeScript 7** until typescript-eslint supports it. Leave `typescript` at latest 6.x even if `bun outdated` shows 7.

### Electron 43+ — main/preload must be CommonJS

Electron 43 ships Node 24. ESM named imports of lazy-getter APIs fail:

```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

Symptom: **empty white screen** (main crashes before UI). Renderer is fine; main never boots.

**Required config** (`electron.vite.config.ts`):

- `main` + `preload` `rollupOptions.output`: `format: "cjs"`, `entryFileNames: "[name].cjs"`, `chunkFileNames: "chunks/[name].cjs"`
- `package.json` `"main": "./out/main/index.cjs"`
- All `BrowserWindow` preload paths: `out/preload/index.cjs` (mainWindow, tray, promptGenWindow)

Renderer stays ESM. Do **not** switch main/preload back to ESM without verifying Electron named-export support.

### AI SDK majors — bump as a pair

`ai` and `@openrouter/ai-sdk-provider` versions track each other. Bump together. Touch point: `src/main/ai.request/shared.ts` (`generateText`, `createOpenRouter`).

#### ai v7 — no `system` role inside `messages`

AI SDK v7 rejects `system`-role entries in the `messages` array (`standardizePrompt`'s `allowSystemInMessages` defaults to `false`):

```
AI_InvalidPromptError: Invalid prompt: System messages are not allowed in the prompt or messages fields. Use the instructions option instead.
```

Symptom: correction/promptGen **loading spinner flashes then vanishes** — the request throws instantly. App boots fine; only AI calls fail. Not a crash, so check `~/.fixlang/log/runtime-*.log` (grep `ERROR`), not just stdout.

Fix in `makeRemoteAIRequest`: split system-role messages out and pass them via `generateText({ system, messages })`. Only non-system messages go in `messages`.

Caveat: v7 `system` content must be a **string**, so the Anthropic/Gemini `cache_control`-on-content-block annotation (`buildCachedMessages`) can't ride the system prompt. Default model `~openai/gpt-mini-latest` uses implicit caching (no annotation) so it's unaffected; restoring explicit Anthropic/Gemini cache needs `providerOptions`.

### Cursor terminal red herring

Cursor sets `ELECTRON_RUN_AS_NODE=1`. That makes `require("electron").app` undefined → `electron-store` throws `Please specify the projectName option`.

**Not a real app bug.** When launching Electron from the agent terminal:

```bash
env -u ELECTRON_RUN_AS_NODE -u ATOM_SHELL_INTERNAL_RUN_AS_NODE ./node_modules/.bin/electron .
```

Packaged `/Applications/FixLang.app` does not inherit this.

## Post-upgrade checklist

- [ ] `bun run build` green
- [ ] `bun run test` — same or better pass count
- [ ] `bun run lint` — no new errors
- [ ] `bun outdated` — only intentional pins remain (e.g. typescript 6.x)
- [ ] Electron bump → main/preload still `.cjs`; `main` field + preload paths match
- [ ] Electron / vite bump → `bun run pack:install` + launch app (not just unit tests)
- [ ] Update tech-stack lines in `AGENTS.md` / `CLAUDE.md` if versions moved

## Commit style

```
chore(deps): upgrade X and Y

[optional body: majors called out + any Electron/CJS follow-up]
```
