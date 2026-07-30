---
name: fixlang-presets
description: "Use when editing transform presets, reasoning effort, per-preset output mode, the Ask AI flow, or the source-app context block. Examples: \"add a preset field\", \"why does this preset ignore the popup setting\", \"retire a reasoning effort value\", \"change the Metadata context prompt\". Covers src/stores/apiStore.ts, src/shared/reasoningEffort.ts, src/main/ai.request/transform-context.ts, src/main/keybindings/askFlow.ts, src/renderer/components/MarkdownView.tsx."
---

# FixLang — Preset, Reasoning, Ask AI Gotchas

Code: `src/stores/apiStore.ts` (`CorrectionPreset`), `src/shared/reasoningEffort.ts`, `src/main/ai.request/transform-context.ts`, `src/main/keybindings/{correction,askFlow}.ts`, `src/main/webViewWindows/{askInputWindow,askResultWindow}.ts`, `src/main/profileChange.ts`, `src/renderer/components/MarkdownView.tsx`.

## Retired reasoning efforts must MAP, never disappear

Preset reasoning effort is generic: `none` / `low` / `medium` / `high`. Retiring a value is NOT deleting it from `REASONING_EFFORT_STEPS`. `RETIRED_EFFORTS` (`src/shared/reasoningEffort.ts`) maps stored `minimal` → `low` and stored `xhigh` ("Maximum") → `high`, and `sanitizeReasoningEffort`, `reasoningEffortToStepIndex`, `reasoningForAiSdk` all route through it.

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

## Source-app context block

Transform and PromptGen append the frontmost app name ("Slack", "Mail") as a `# Metadata context` block to the **system prompt** (`transform-context.ts`), so the model can match that app's register. It TRAILS rather than leads the preset's own instructions, so the preset text stays a stable, cacheable prefix and a different active app only varies the uncached suffix instead of busting the provider's prompt cache for the whole request (`ai.request/cache-strategy.ts`). The trade-off runs the other way from a leading block: trailing metadata carries less weight against the preset's own instructions. This position was deliberately REVERSED — do not restore the leading form without re-accepting the per-app-change cache bust.

That cache win reaches direct OpenAI and OpenRouter's implicit-cache models (gpt/grok/deepseek) only. OpenRouter's explicit `cache_control` path never touches the system prompt: `buildCachedMessages` annotates only `role === "system"` entries, but `openrouter/request.ts` calls it with `rawMessages.filter((m) => m.role !== "system")`, so Anthropic and Gemini get no system-prompt caching at all. Pre-existing and tracked separately — do not assume a trailing block bought them anything.

Best-effort by design: dropped entirely when the read fails or FixLang itself is frontmost, leaving the system prompt byte-identical. Every read logs under scope `accessibility.activeApp` (debug on read/drop, warn on failure).

The block carries an `AppContextFormattingPolicy` (`"preserve-input-markup" | "adapt-to-app"`), resolved per preset by the pure `appContextPolicyForPreset(presetId)`. Only the `structured-text` built-in gets `adapt-to-app`; every other preset plus PromptGen keep `preserve-input-markup`, whose wording is byte-identical to the pre-policy block. That byte-identity is load-bearing — it is what keeps every other preset's and PromptGen's prompt unchanged — and a literal-string test pins it.
