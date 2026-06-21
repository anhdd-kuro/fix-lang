/**
 * @file validateHotkeys.ts
 * @description Pure, shared hotkey conflict validator.
 * No Electron or React imports — safe for Vitest without mocks.
 *
 * Extracted and generalised from the file-scoped `getValidationError` in
 * SettingCorrection.tsx (issue #44).
 */

import type { CorrectionPreset, KeyBindings } from "~/stores/apiStore";

/** Describes a single hotkey collision between two named parties. */
export type HotkeyConflict = {
  /** The hotkey string that was duplicated. */
  hotkey: string;
  /** Name of one colliding party (preset name or "promptGen"/"profileSwitch"). */
  presetOrKey: string;
  /** Name of the other colliding party. */
  conflictsWith: string;
};

/**
 * Validates that no hotkey in the given correction presets conflicts with
 * another preset or with the app-level keybindings (promptGen, profileSwitch).
 *
 * Returns the first conflict found, or null if all hotkeys are distinct.
 * Empty/blank hotkeys are ignored — they are not registered and cannot clash.
 *
 * @param presets - Flat list of correction presets to validate.
 * @param keyBindings - App-level keybindings to check against (promptGen + profileSwitch).
 * @returns The first HotkeyConflict found, or null if no conflicts.
 */
export const validateHotkeys = (
  presets: CorrectionPreset[],
  keyBindings: Pick<KeyBindings, "promptGen" | "profileSwitch">,
): HotkeyConflict | null => {
  // Build a map of hotkey → label for each app-level key binding.
  // Only non-empty values are considered reserved.
  const reservedHotkeys = new Map<string, string>();
  const appKeys: (keyof Pick<KeyBindings, "promptGen" | "profileSwitch">)[] = [
    "promptGen",
    "profileSwitch",
  ];
  for (const key of appKeys) {
    const shortcut = keyBindings[key]?.trim();
    if (shortcut) {
      reservedHotkeys.set(shortcut, key);
    }
  }

  // Walk presets and check each hotkey against reserved app keys and seen presets.
  const seenHotkeys = new Map<string, string>(); // hotkey → preset name

  for (const preset of presets) {
    const hotkey = preset.hotkey.trim();
    if (!hotkey) {
      // Empty / whitespace-only hotkeys are not registered — skip.
      continue;
    }

    const reservedBy = reservedHotkeys.get(hotkey);
    if (reservedBy !== undefined) {
      return {
        hotkey,
        presetOrKey: preset.name,
        conflictsWith: reservedBy,
      };
    }

    const duplicatePreset = seenHotkeys.get(hotkey);
    if (duplicatePreset !== undefined) {
      return {
        hotkey,
        presetOrKey: duplicatePreset,
        conflictsWith: preset.name,
      };
    }

    seenHotkeys.set(hotkey, preset.name);
  }

  return null;
};
