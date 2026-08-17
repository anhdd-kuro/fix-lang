---
name: fixlang-presets
description: "Use when editing transform presets, preset-scoped options (extraOptions), reasoning effort, per-preset output mode, the Ask AI flow, the Caveman intensity levels, or the source-app context block. Examples: \"add a preset field\", \"give a preset its own setting\", \"why does this preset ignore the popup setting\", \"retire a reasoning effort value\", \"change the Metadata context prompt\". Covers src/features/providers/store/apiStore.ts, src/features/correction/shared/presetOptions.ts, src/features/correction/shared/reasoningEffort.ts, src/prompts/caveman.md, src/main/ai.request/transform-context.ts, src/main/keybindings/askFlow.ts, src/renderer/components/MarkdownView.tsx."
---

# FixLang — Preset, Reasoning, Ask AI Gotchas

Code: `src/features/providers/store/apiStore.ts` (`CorrectionPreset`), `src/features/correction/shared/reasoningEffort.ts`, `src/main/ai.request/transform-context.ts`, `src/main/keybindings/{correction,askFlow}.ts`, `src/main/webViewWindows/{askInputWindow,askResultWindow}.ts`, `src/main/profileChange.ts`, `src/renderer/components/MarkdownView.tsx`.

## Retired reasoning efforts must MAP, never disappear

Preset reasoning effort is generic: `none` / `low` / `medium` / `high`. Retiring a value is NOT deleting it from `REASONING_EFFORT_STEPS`. `RETIRED_EFFORTS` (`src/features/correction/shared/reasoningEffort.ts`) maps stored `minimal` → `low` and stored `xhigh` ("Maximum") → `high`, and `sanitizeReasoningEffort`, `reasoningEffortToStepIndex`, `reasoningForAiSdk` all route through it.

Drop a retired value instead and two silent breakages follow: downstream reads it as `provider-default`, which CHANGES a stored preset's behaviour with no error, and `reasoningEffortToStepIndex` lands on -1 → slider snaps to None.

## Per-preset output mode has TWO delivery paths

`CorrectionPreset.outputMode` is `"inherit" | "paste" | "popup"` and overrides the global Transform output mode at request time; `"inherit"` (and unset) defers to `outputModeStore`. Settings shows it as a Select for EVERY preset.

So **both** delivery paths must resolve it — `correction.ts`'s ordinary hotkey branch AND `askFlow.ts`. Never read `outputModeStore` directly in either. Reading the store in one of them leaves that Select visible, writable, persisted, and inert for the six polish presets.

## `requiresInput` + `markdownOutput` are a pair, and Ask-AI-only

`Ask AI` (`Control+Shift+A`) is the one built-in with `requiresInput: true`: its hotkey opens `askInputWindow.ts` instead of aborting on an empty selection, sends one shot through `askFlow.ts`, and renders the answer as GFM markdown in a capped cascading multi-instance popup (`askResultWindow.ts`, cap 5). `markdownOutput: true` is only meaningful — and only surfaced as a Settings control — on a `requiresInput` preset. Hotkey-path details: see [Hotkeys](../fixlang-hotkeys/SKILL.md).

The result popup renders **selection → question → answer**. Selection and question are plain text clamped to 3 lines behind a fold control; the answer is never clamped. The selection block is gated on `input?.trim()`, not plain truthiness — `"   "` rendered an empty box. Ask entries store `sessionJson` exactly like Transform (`recordAskHistory` used to drop what `fixGrammar` already returned, and the History eye control then did nothing for Ask rows).

## Ask AI's selection read and its answer are BOTH untrusted

Four guards that each look optional and are not.

1. **Stale clipboard is not a selection.** `getHighlightedTextForOptionalContext()` reports `""` when the Cmd-C keystroke did not change the clipboard, because with nothing selected that keystroke is a no-op and the clipboard still holds whatever was there before (a password, say), indistinguishable from a real selection. The guard polls the clipboard for a raw CHANGE (`waitForClipboardChange`, `src/utils.ts`); AppleScript no longer returns clipboard text at all, so the old `stdout.trim()`-vs-raw-snapshot asymmetry — which silently disabled this guard for exactly the trailing-newline values it protects — no longer exists to reintroduce.

   **The strict variant is deliberately asymmetric.** `getHighlightedText()` returns the polled clipboard value whether or not it changed. A poll cannot tell "nothing selected" from "selection is byte-identical to the clipboard", and treating unchanged as empty aborts a REAL selection in the copy → paste → select-same → transform workflow. That is safe only because every strict caller already aborts on an empty read, so a stale clipboard costs a wasted transform; Ask AI has no such abort, which is why only the optional variant reports `""`. Do not "fix" the asymmetry.

2. **A pending Ask input must not outlive its profile.** `runAskFlow` captured profile A's preset, but `fixGrammar(message, preset.id)` re-resolves that id at SUBMIT time, so a mid-typing profile switch would send A's context through B's model, provider, and key. Every profile activation therefore goes through `notifyActiveProfileChanged()` (`src/main/profileChange.ts`), which dismisses the input BEFORE broadcasting `ACTIVE_PROFILE_CHANGED`. Broadcasting that channel directly is forbidden; a `profileChange.test.ts` source guard fails on it.

3. **The selection is never markdown.** Only the answer goes through `MarkdownView`; the popup's selection and question blocks render as plain text on purpose. Routing the selection through the markdown renderer would let copied content drive the renderer. Same boundary in the preload: `isAskResultPayload` must gain a branch for every field the shared `AskResultPayload` type grows — widening the type and leaving the guard behind sent a non-string `input` into a string-typed prop as a render crash instead of a boundary rejection.

4. **The answer is model-controlled markdown.** `MarkdownView.tsx` sets `img: () => null` — an `<img>` fetches its URL on mount with no click, i.e. a read receipt, or exfiltration once an injected answer encodes the selection into the path. Links route through `openExternalLink`, never `target="_blank"`: that would get Electron's default window-open behaviour — an unmanaged app-owned window outside the result-window cap, with a preload attached.

## Preset-scoped options live in a registry, not in the UI

A preset declares its own settings through `src/features/correction/shared/presetOptions.ts`. `presetOptionDefinitions(presetId)` returns what that preset declares (`[]` for the seven that declare nothing), values persist on `CorrectionPreset.extraOptions` (`Record<string, string>`), and `withPresetOptions(systemPrompt, preset)` appends the chosen choice's `promptFragment`. Caveman uses it for lite/full/ultra.

Settings renders whatever the registry returns — `presetOptionDefinitions(activePreset.id).length > 0` gates the block and the JSX maps over definitions. **No preset id appears in that JSX.** A new option is a registry entry plus its catalog keys — `labelKey`, `hintKey`, and one `labelKey` per choice, in every locale, so two choices costs four keys per locale and Caveman's three costs five. Touching `SettingCorrection.tsx` means the abstraction leaked.

The generality is pinned by a source guard in `SettingCorrection.test.ts`, not by behaviour: with exactly one preset id in the registry, reading the registry and hardcoding `activePreset.id === "caveman"` are indistinguishable to every behavioural test — the substitution was made and the whole suite stayed green.

**Ask AI was deliberately NOT migrated onto this.** `requiresInput` and `markdownOutput` look like the registry's first customers and are not: they stay first-class `CorrectionPreset` fields. `extraOptions` values are opaque strings that only ever reach a `promptFragment` appended to the system prompt — they change what the model is told. `requiresInput` changes CONTROL FLOW: it routes the hotkey to `showAskInputWindow()` instead of the selection grab, and `markdownOutput` picks the renderer. Pushing behavioural switches through a bag of strings means every reader must know which keys are inert text and which reroute the app, which is exactly the interface rewrite this registry exists to avoid. Rule: if it changes what the model is TOLD, it is an option; if it changes what the app DOES, it is a field.

Five traps:

1. **The schema node must stay `{}`.** `extraOptions` in `apiStoreSchema` is a bare `{}`, NOT `{ type: "object" }`. Under `clearInvalidConfig: true` a value failing validation wipes the ENTIRE config — every profile, preset, hotkey and encrypted key slot — so any node that can reject is a config-wiper, and a stored `"extraOptions": "ultra"` written by a newer build is exactly that. Validity is enforced in code by `sanitizePresetOptions`, which is total over `unknown`. Relaxing the node is the only safe direction to move it.
2. **Registry lookup is a `Map`, and values read via `Object.getOwnPropertyDescriptor`.** An object literal answers `"__proto__"` / `"constructor"` / `"toString"` with inherited junk; a descriptor read plus `"value" in descriptor` never invokes an accessor, so there is no TOCTOU between the check and the read. `sanitizePresetOptions` returns `undefined`, never `{}`, when nothing survives.
3. **Write the merged blob INSIDE the state updater.** Every `Setting*.tsx` persists the whole settings object (see [Settings writes](../fixlang-settings-writes/SKILL.md)). Building merged `extraOptions` from the render snapshot a handler closed over loses the first edit when a preset declares two options. `updatePresetOption` merges inside `setCorrectionSettings`.
4. **`handleResetBuiltIn` enumerates keys EXPLICITLY** — `extraOptions` must be in that list. Note the obvious test for this is unfalsifiable: Caveman's default HAS `extraOptions`, so the plain `...defaultPreset` spread restores it and the test passes with the key reverted. Pin it with a preset carrying a stray blob the default does not declare.
5. **Duplicating a preset must BAKE its options, not carry the `extraOptions` key forward.** The registry key is the BUILT-IN preset id, so a duplicate's fresh `custom-*` id declares zero options: `presetOptionDefinitions` answers `[]`, Settings renders no control, and `withPresetOptions` becomes a no-op — yet Caveman's own prompt text still says an intensity level "is given... for this request." `handleDuplicatePreset` (`SettingCorrection.tsx`) resolves `withPresetOptions(activePreset.systemPrompt, activePreset)` into the copy's `systemPrompt` and omits `extraOptions` entirely, so the duplicate is a self-contained plain custom preset — same shape every other custom preset already is — instead of a config field (`derivedFrom`) that `clearInvalidConfig: true` would turn into a new way to wipe every profile.

## The Caveman instruction boundary is drawn by MESSAGE ROLE, not position

`src/prompts/caveman.md` must never claim its instructions "end" at some line, or that anything following is text to compress. Three wrappers append after it — `withPresetOptions`, then the source-app `# Metadata context` block, then per-press user metadata — so a positional claim relabels the app's own metadata as content for exactly this preset.

The claim is also unnecessary: `buildCorrectionUserPrompt` sends the text to transform as a SEPARATE USER MESSAGE, so nothing trailing the preset's instructions in the system prompt is ever input, under any nesting. The wrapper stays INNERMOST — a chosen option is part of what the preset instructs, not ambient metadata — which keeps Caveman's `# Metadata context` block trailing like the other seven's. Moving it outermost to "fix" the boundary would make this the only preset whose metadata block is non-trailing, and would not fix anything.

Levels are pinned by a **stance table** (`defaultPresetPrompts.test.ts`), not marker lists: per (compression move, level) it records `instructs` / `withholds`. Marker lists were tried three times and each patch left a new hole — copy-pasting lite's body into full, keeping only the `"Full level:"` label, left all 38 tests green. The stance table makes cumulativity free (ultra restating "drop articles" is same-stance, never compared) while still catching ultra carrying full's disclaimer (opposite stance).

## Source-app context block

Transform and PromptGen append the frontmost app name ("Slack", "Mail") as a `# Metadata context` block to the **system prompt** (`transform-context.ts`), so the model can match that app's register. It TRAILS rather than leads the preset's own instructions, so the preset text stays a stable, cacheable prefix and a different active app only varies the uncached suffix instead of busting the provider's prompt cache for the whole request (`ai.request/cache-strategy.ts`). The trade-off runs the other way from a leading block: trailing metadata carries less weight against the preset's own instructions. This position was deliberately REVERSED — do not restore the leading form without re-accepting the per-app-change cache bust.

That cache win reaches direct OpenAI and OpenRouter's implicit-cache models (gpt/grok/deepseek) only. OpenRouter's explicit `cache_control` path never touches the system prompt: `buildCachedMessages` annotates only `role === "system"` entries, but `openrouter/request.ts` calls it with `rawMessages.filter((m) => m.role !== "system")`, so Anthropic and Gemini get no system-prompt caching at all. Pre-existing and tracked separately — do not assume a trailing block bought them anything.

Best-effort by design: dropped entirely when the read fails or FixLang itself is frontmost, leaving the system prompt byte-identical. Every read logs under scope `accessibility.activeApp` (debug on read/drop, warn on failure).

The block carries an `AppContextFormattingPolicy` (`"preserve-input-markup" | "adapt-to-app"`), resolved per preset by the pure `appContextPolicyForPreset(presetId)`. Only the `structured-text` built-in gets `adapt-to-app`; every other preset plus PromptGen keep `preserve-input-markup`, whose wording is byte-identical to the pre-policy block. That byte-identity is load-bearing — it is what keeps every other preset's and PromptGen's prompt unchanged — and a literal-string test pins it.
