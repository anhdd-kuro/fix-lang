---
name: fixlang-profile-state
description: "Use when editing profile switching, multi-profile state, history, or settings sync. Examples: \"switching profiles shows stale settings\", \"history doesn't reload on profile change\". Covers profile switch state sync across hotkeys, settings UI, and history."
---

# FixLang — Profile Switch State Sync Gotcha

Code: profile switch in `src/main/keybindings/profileSwitch.ts` + `src/main/ipc/features/profiles.ts`; state in `src/stores/` (`apiStore.ts`, `historyStore.ts`, `keybindingStore.ts`).

## Switching a profile triggers three updates — keep them atomic

A profile switch must propagate to all of:

1. **Hotkey reload** — for preset-specific bindings (see [[fixlang-hotkeys]])
2. **Settings UI refresh** — show the new profile's settings
3. **History clear or reload** — depending on the per-profile history setting

If any one lags or fails, users see stale state (old hotkeys, wrong settings, or another profile's history). Treat the three as one transaction — do not ship a switch path that updates only some of them.

## Connecting a provider does NOT touch preset models

When a user connects a provider in Settings → General, the app adds it to the profile's enabled providers and fetches its models. **Presets are unaffected** — their model references and feature settings stay byte-identical. This is by design: a preset can use any enabled provider, not just the one that was most recently connected.

Same with disconnecting: only refs that point to the disconnected provider are reset to inherit. A preset using a different provider stays intact.

## Admin-key slots are per-provider AND per-profile — never defaulted

`PROVIDER_SUPPORTS_PROVISIONING_KEY` covers **two** providers now (OpenAI Admin key, OpenRouter provisioning key), and `secretKindsForProvider` derives each profile's secret files from it — so the settings field, profile-delete cleanup, and the disconnect warning all follow the table with no per-provider branch.

Consequence: every accessor in `provisioningKeyStore` and every one of the three IPC channels (`set/clear/has-provisioning-key`) takes an **explicit** `ProviderId`. Do not add a default. A defaulted or omitted provider writes OpenAI's admin key into OpenRouter's slot, or reads OpenRouter's when asked about OpenAI — no error, no log, just one account's key querying another's billing. The preload and main handlers both gate on `supportsAdminKey()`, which narrows through `isProviderId` so an inherited key like `"constructor"` cannot read truthy off the lookup map.

The legacy global file (`openrouter-provisioning.enc`) predates both profiles and multi-provider admin keys, so it is consulted for `openrouter` only.

## Checklist

- [ ] Profile switch reloads hotkeys
- [ ] Profile switch refreshes settings UI
- [ ] Profile switch clears/reloads history per the per-profile setting
- [ ] All three complete together, no partial state
- [ ] Every admin-key read/write names its provider explicitly (no default, no `"openrouter"` literal)
