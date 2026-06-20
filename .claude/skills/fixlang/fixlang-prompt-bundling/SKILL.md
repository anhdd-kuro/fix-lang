---
name: fixlang-prompt-bundling
description: "Use when editing AI prompt assets (Prompt Master, Strategic Compact) or wondering why prompt edits don't show up in the running app. Covers src/prompts/*.md bundled at build time. Examples: \"update the prompt master skill\", \"my prompt changes aren't taking effect\"."
---

# FixLang — Prompt Bundling Gotcha

Code: `src/prompts/` (`correction.ts`, `index.ts`, `prompt-master-*.md`, `strategic-compact-skill.md`).

## Bundled at build time — NOT runtime discovery

Prompt Master and Strategic Compact are **bundled into the app at build time** from `src/prompts/*.md`. They are NOT loaded from `~/.agents/skills/` at runtime. Editing files under `~/.agents/...` has **zero effect** on the app.

To change a bundled prompt:

1. Edit `src/prompts/prompt-master-*.md` or `src/prompts/strategic-compact-skill.md`
2. Rebuild: `bun run pack:mac`
3. Reinstall: `bun run pack:install`

## Checklist

- [ ] Prompt edits made in `src/prompts/`, not `~/.agents/`
- [ ] App rebuilt + reinstalled before verifying behavior
