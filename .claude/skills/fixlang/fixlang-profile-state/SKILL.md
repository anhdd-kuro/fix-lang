---
name: fixlang-profile-state
description: "Use when editing profile switching, multi-profile state, history, or settings sync. Examples: \"switching profiles shows stale settings\", \"history doesn't reload on profile change\". Covers profile switch state sync across hotkeys, settings UI, and history."
---

# FixLang — Profile Switch State Sync Gotcha

Code: profile switch in `src/main/keybindings/profileSwitch.ts` + `src/main/ipc/profiles.ts`; state in `src/stores/` (`apiStore.ts`, `historyStore.ts`, `keybindingStore.ts`).

## Switching a profile triggers three updates — keep them atomic

A profile switch must propagate to all of:

1. **Hotkey reload** — for preset-specific bindings (see [[fixlang-hotkeys]])
2. **Settings UI refresh** — show the new profile's settings
3. **History clear or reload** — depending on the per-profile history setting

If any one lags or fails, users see stale state (old hotkeys, wrong settings, or another profile's history). Treat the three as one transaction — do not ship a switch path that updates only some of them.

## Checklist

- [ ] Profile switch reloads hotkeys
- [ ] Profile switch refreshes settings UI
- [ ] Profile switch clears/reloads history per the per-profile setting
- [ ] All three complete together, no partial state
