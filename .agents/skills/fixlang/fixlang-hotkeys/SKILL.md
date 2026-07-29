---
name: fixlang-hotkeys
description: "Use when editing transform presets, hotkey bindings, or the keybinding system. Examples: \"add a transform preset\", \"why did transforms stop firing after switching profiles\", \"validate hotkey conflicts\". Covers src/main/keybindings/ and src/stores/keybindingStore.ts."
---

# FixLang — Hotkey & Preset Gotchas

Code: `src/main/keybindings/` (`correction.ts`, `profileSwitch.ts`, `translation.ts`, `promptGen.ts`, `index.ts`, `utils.ts`), `src/stores/keybindingStore.ts`.

## Preset hotkey reload (silent-failure trap)

When a user **saves transform preset settings** and then **switches profiles**, the app MUST reload hotkeys immediately to reflect preset changes. Stale bindings do not error — transforms just fail silently. Any change to preset save flow or profile switch flow must re-trigger hotkey registration.

## Preset hotkey conflict validation

Transform preset hotkeys must not collide with:

- Other transform presets
- Static app hotkeys: `translate`, `promptGen`, `profileSwitch`

Validation MUST run **before saving** in the Transform settings UI — never register a conflicting binding and resolve it later.

## New built-in preset hotkey-steal trap

Defaults array order is registration order — `registerCorrectionShortcut` register first-wins. Built-in defaults sit BEFORE custom presets in that array. So: add a new built-in preset with the same hotkey as a hotkey a user's stored custom preset already holds, and the new built-in wins the registration silently — user's preset just stop firing, nothing but a `logger.warn` nobody read.

Fix already in `normalizeCorrectionSettings` (`src/stores/apiStore.ts`): when a built-in's hotkey came from the const default rather than from the user, and a STORED preset already claims that accelerator, the built-in's hotkey gets blanked to `""` instead. TWO shapes count as came-from-the-default, not one — (a) the whole preset absent from stored config, and (b) the preset present in stored config but its `hotkey` missing or not a string, so the value was injected by the `?? fallback?.hotkey` at read time. `hotkeyWasStored` (`src/stores/apiStore.ts:391`) is what tells them apart. A STORED string hotkey is NEVER rewritten — not `""`, not `"   "`, not stored-vs-stored collisions; that stays `validateHotkeys`'s pre-save job, not this guard's.

Second trap, same guard, opposite direction: `promptGen` and `profileSwitch` are user-REMAPPABLE, and `registerCorrectionShortcut` treats both as reserved — a preset sitting on one gets skipped with a warn nobody read. So a default materialized onto a remapped app binding shows in Settings as assigned but can never fire. Guard covers this too: `normalizeCorrectionSettings` takes `reservedAppAccelerators` as a third param, defaulted to `keybindingStore.getKeyBindings()`, and a DEFAULT-sourced hotkey equal to one is blanked. Defaulted param, not a required one, so no call site can forget it and lose the guard silently. All three materialization paths apply it (non-object stored value, no-`presets`-array legacy, main path). A STORED hotkey on a reserved accelerator is still never rewritten — `validateHotkeys` pre-save owns that.

Blind spot on purpose: the claim-set only collects STORED presets. Two DEFAULTS sharing one hotkey is invisible to this guard — earlier one in the array just wins, silently, same as before the fix. So every new built-in default hotkey must stay pairwise-distinct from: every other built-in default, `DEFAULT_KEY_BINDINGS` in `src/const.ts` (`promptGen` = `Control+Shift+G`, `profileSwitch` = `Control+Shift+P`), and the hardcoded devtools `F12` in `src/main/keybindings/index.ts`. Check this BEFORE picking a hotkey for preset #7. Distinctness from the DEFAULT app bindings still matters even with the reserved-accelerator guard: that guard blanks the preset's hotkey, so a colliding default would ship dead-on-arrival for every user rather than firing.

## Active-app context read order (silent-degradation trap)

Transform **and PromptGen** system prompts carry the frontmost app name (`getActiveApp()` in `src/main/accessibility/activeApp.ts`, block built by `src/main/ai.request/transform-context.ts`) so the model knows Slack from Mail. `getActiveApp` asks System Events for the frontmost **process**, so it must run at the very top of every hotkey handler — before `showOverlaySpinner()`, the PromptGen window, or any result window. Put a FixLang window on screen first and the read returns FixLang, `parseActiveApp` drops it as own-app, and every request silently loses its context with no error anywhere.

The block goes on the **system prompt**, never the user prompt: the user prompt carries the text to transform, and metadata sitting next to it gets mistaken for content. It is *appended* after the preset/PromptGen prompt so a null read leaves the string byte-identical — which also keeps the provider prompt cache (`src/main/ai.request/cache-strategy.ts`) hitting for the no-context case.

Own-app filtering covers the packaged bundle id (`com.fixlang.app`) **and** `com.github.Electron` — dev runs report the bare Electron shell, which would otherwise inject "Electron" into every dev prompt.

Debugging a missing context: filter the Logs tab on scope `accessibility.activeApp`. Every read logs — `debug` "Frontmost app read" with app + bundle id, `debug` "Frontmost app not usable as context" with the capped raw System Events line (shows own-app vs empty vs over-long), `warn` on an osascript failure. No log line at all means the handler never called `getActiveApp`.

## Checklist before finishing hotkey work

- [ ] Preset save path re-registers hotkeys
- [ ] Profile switch path re-registers hotkeys
- [ ] Conflict check runs pre-save against presets + static hotkeys
- [ ] `getActiveApp()` still runs before any FixLang window is shown
- [ ] A new built-in preset's default hotkey is distinct from every other built-in default, `DEFAULT_KEY_BINDINGS`, and `F12`
