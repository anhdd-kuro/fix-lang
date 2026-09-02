/**
 * @file validateHotkeys.ts
 * @description Pure, shared hotkey conflict validator — the single gate every
 * keybinding passes before it is saved. It checks transform presets, combos,
 * the app-level keybindings (promptGen, profileSwitch) and the statically
 * reserved combo cancel accelerator against each OTHER, not just presets
 * against everything else: a collision anywhere in that set is rejected, never
 * silently relinquished.
 * No Electron or React imports — safe for Vitest without mocks.
 *
 * Extracted and generalised from the file-scoped `getValidationError` in
 * SettingCorrection.tsx (issue #44).
 */

import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import type {
  ComboPreset,
  CorrectionPreset,
  KeyBindings,
} from "~/features/providers/store/apiStore";

/**
 * `conflictsWith` label for the reserved combo cancel accelerator. A raw key
 * string, matching how `promptGen` / `profileSwitch` already surface.
 */
export const COMBO_CANCEL_LABEL = "comboCancel";

/** Describes a single hotkey collision between two named parties. */
export type HotkeyConflict = {
  /** The hotkey string that was duplicated. */
  hotkey: string;
  /** The party that cannot keep the hotkey (preset/combo name, or key label). */
  presetOrKey: string;
  /** The party that already holds it. */
  conflictsWith: string;
};

/** The app-level bindings this validator arbitrates between. */
export type AppKeyBindings = Pick<KeyBindings, "promptGen" | "profileSwitch">;

type HotkeyClaim = {
  hotkey: string;
  label: string;
};

const APP_KEY_ORDER: readonly (keyof AppKeyBindings)[] = [
  "promptGen",
  "profileSwitch",
];

/**
 * Claim order decides two things: which conflict is reported first, and which
 * party is named as already holding the chord. Reserved and app-level bindings
 * claim before presets and combos, so the party told to move is always the one
 * the user can rename or rebind in the editor they are looking at.
 *
 * Blank hotkeys never become claims — they are not registered and cannot clash.
 * Hotkeys are compared exactly: no case folding, matching the accelerator
 * strings Electron itself registers.
 */
const collectClaims = (
  presets: readonly CorrectionPreset[],
  keyBindings: AppKeyBindings,
  combos: readonly ComboPreset[],
): readonly HotkeyClaim[] => {
  // Reserved unconditionally, not "only once a combo exists": conditional
  // reservation would let adding the first combo retroactively invalidate a
  // hotkey the user had already saved.
  const claims: HotkeyClaim[] = [
    { hotkey: COMBO_CANCEL_ACCELERATOR, label: COMBO_CANCEL_LABEL },
  ];

  for (const key of APP_KEY_ORDER) {
    const hotkey = keyBindings[key]?.trim();
    if (hotkey) {
      claims.push({ hotkey, label: key });
    }
  }

  for (const preset of presets) {
    const hotkey = preset.hotkey?.trim();
    if (hotkey) {
      claims.push({ hotkey, label: preset.name });
    }
  }

  for (const combo of combos) {
    const hotkey = combo.hotkey?.trim();
    if (hotkey) {
      claims.push({ hotkey, label: combo.name });
    }
  }

  return claims;
};

/**
 * Every hotkey collision across presets, combos, the app keybindings and the
 * reserved combo cancel accelerator.
 *
 * Returns all of them rather than the first, because a combo editor shows
 * several hotkey fields at once and reporting one at a time turns fixing them
 * into a save-per-field loop.
 *
 * @param presets - Flat list of correction presets to validate.
 * @param keyBindings - App-level keybindings (promptGen + profileSwitch).
 * @param combos - Combo presets to validate; absent reads as none.
 * @returns Conflicts in claim order; empty when every hotkey is distinct.
 */
export const findHotkeyConflicts = (
  presets: readonly CorrectionPreset[],
  keyBindings: AppKeyBindings,
  combos: readonly ComboPreset[] = [],
): readonly HotkeyConflict[] => {
  const holders = new Map<string, string>();
  const conflicts: HotkeyConflict[] = [];

  for (const claim of collectClaims(presets, keyBindings, combos)) {
    const holder = holders.get(claim.hotkey);
    if (holder === undefined) {
      holders.set(claim.hotkey, claim.label);
      continue;
    }

    conflicts.push({
      hotkey: claim.hotkey,
      presetOrKey: claim.label,
      conflictsWith: holder,
    });
  }

  return conflicts;
};

/**
 * First conflict only — for the single-banner surfaces (Settings → Transform,
 * the promptGen/profileSwitch capture widget) that have one error slot to fill.
 * Use `findHotkeyConflicts` where several fields are editable at once.
 *
 * @returns The first HotkeyConflict found, or null if no conflicts.
 */
export const validateHotkeys = (
  presets: readonly CorrectionPreset[],
  keyBindings: AppKeyBindings,
  combos: readonly ComboPreset[] = [],
): HotkeyConflict | null =>
  findHotkeyConflicts(presets, keyBindings, combos)[0] ?? null;
