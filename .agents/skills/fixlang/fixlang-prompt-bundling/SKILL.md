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

## Editing ANY prompt moves the apiStoreSchema snapshot sha

`apiStoreSchema`'s two `default` nodes embed each built-in preset's `systemPrompt` **verbatim**, so a one-word prompt edit fails `apiStore.test.ts` > "matches the committed sha256 snapshot". That test is a real guard, not noise: it exists because `apiStore` runs `clearInvalidConfig: true`, where a botched schema wipes every profile, preset and key reference.

Do NOT just paste the new `Received:` value. Prove the prompt text is the only delta first: substitute the OLD prompt string back into the serialised schema and confirm you get the OLD sha, and confirm the prompt occurs exactly twice (once per `default` node). If both hold, nothing structural moved — no constraint, no `enum`, no `required`, no new property — and stored configs are untouched, because `default` nodes are read only when a profile stores nothing. Record that reasoning above the snapshot like the existing comments do.

## The ask prompt's `<priority>` block is load-bearing

`src/prompts/ask.md` states that the user's request outranks every other block in the file, and the locale block states it is a *default*. Delete either and `App locale: <code>` reads as absolute — asking for a translation into another language gets **refused** ("the specified app locale is English") instead of answered.

Two constraints when editing that file:

- `askPrompt.test.ts` asserts the prompt never contains the words "English" or "Japanese", so the override carve-out must be worded generically ("a particular language"), never by example.
- Markers there are literal strings pinned to one sentence each. Reword a sentence and its marker must be updated with it, or the suite stays green while the instruction is gone.

## Checklist

- [ ] Prompt edits made in `src/prompts/`, not `~/.agents/`
- [ ] App rebuilt + reinstalled before verifying behavior
- [ ] `apiStore.test.ts` snapshot re-verified (old-text substitution reproduces the old sha), not blind-pasted
- [ ] `askPrompt.test.ts` markers still match the sentences they claim to pin
