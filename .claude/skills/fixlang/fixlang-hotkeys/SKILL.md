---
name: fixlang-hotkeys
description: "Use when editing correction presets, hotkey bindings, or the keybinding system. Examples: \"add a correction preset\", \"why did corrections stop firing after switching profiles\", \"validate hotkey conflicts\". Covers src/main/keybindings/ and src/stores/keybindingStore.ts."
---

# FixLang — Hotkey & Preset Gotchas

Code: `src/main/keybindings/` (`correction.ts`, `profileSwitch.ts`, `translation.ts`, `promptGen.ts`, `index.ts`, `utils.ts`), `src/stores/keybindingStore.ts`.

## Preset hotkey reload (silent-failure trap)

When a user **saves correction preset settings** and then **switches profiles**, the app MUST reload hotkeys immediately to reflect preset changes. Stale bindings do not error — corrections just fail silently. Any change to preset save flow or profile switch flow must re-trigger hotkey registration.

## Preset hotkey conflict validation

Correction preset hotkeys must not collide with:

- Other correction presets
- Static app hotkeys: `translate`, `promptGen`, `profileSwitch`

Validation MUST run **before saving** in the Correction settings UI — never register a conflicting binding and resolve it later.

## Checklist before finishing hotkey work

- [ ] Preset save path re-registers hotkeys
- [ ] Profile switch path re-registers hotkeys
- [ ] Conflict check runs pre-save against presets + static hotkeys
