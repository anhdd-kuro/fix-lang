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
