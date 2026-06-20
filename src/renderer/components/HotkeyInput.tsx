/**
 * @file HotkeyInput.tsx
 * @description Reusable hotkey capture widget used by SettingPromptGen and ProfileManager.
 * Pauses global hotkeys on mount, resumes on unmount. Validates against correction preset
 * hotkeys and the sibling app keybinding before saving.
 */
import React, { useState, useEffect } from "react";
import { validateHotkeys } from "./validateHotkeys";
import type { KeyBindings } from "~/stores/apiStore";

type HotkeyKey = keyof KeyBindings; // "promptGen" | "profileSwitch"

export type HotkeyInputProps = {
  /** The keybinding field this widget edits. */
  hotkeyKey: HotkeyKey;
  /** Human-readable label shown above the input. */
  label: string;
};

/**
 * A self-contained hotkey capture widget.
 * - Pauses global hotkeys on mount; resumes on unmount.
 * - Reads current binding from electron store.
 * - Validates against correction presets + sibling keybinding on Apply.
 * - Writes updated bindings atomically (full KeyBindings object) to avoid
 *   zeroing out the sibling field.
 */
export const HotkeyInput: React.FC<HotkeyInputProps> = ({
  hotkeyKey,
  label,
}) => {
  const [keyBindings, setKeyBindings] = useState<KeyBindings | null>(null);
  const [pendingCombo, setPendingCombo] = useState<string>("");
  const [fieldError, setFieldError] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    // Pause hotkeys while editing so they don't fire while typing shortcuts.
    window.electronAPI?.pauseHotkeys();

    window.electronAPI
      ?.getKeyBindings()
      .then((bindings) => {
        setKeyBindings(bindings);
        setPendingCombo(bindings[hotkeyKey]);
      })
      .catch((err) => {
        console.error("HotkeyInput: failed to load key bindings", err);
        setStatus("Error loading keybindings");
      });

    return () => {
      window.electronAPI?.resumeHotkeys();
    };
  }, [hotkeyKey]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.metaKey) parts.push("Command");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    const modifierOnly = ["Control", "Command", "Alt", "Shift"];
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!modifierOnly.includes(key)) parts.push(key);

    const newCombo = parts.join("+");

    if (!parts.some((p) => !modifierOnly.includes(p))) {
      setFieldError("Include a non-modifier key");
      return;
    }

    // Check intra-app duplicate (against sibling keybinding).
    if (keyBindings) {
      const siblingKeys = (Object.keys(keyBindings) as HotkeyKey[]).filter(
        (k) => k !== hotkeyKey,
      );
      const sibling = siblingKeys.find((k) => keyBindings[k] === newCombo);
      if (sibling) {
        setFieldError(`Duplicate with ${sibling}`);
        return;
      }
    }

    setFieldError("");
    setPendingCombo(newCombo);
  };

  const handleApply = async (): Promise<void> => {
    if (fieldError) {
      setStatus(`Error: ${fieldError}`);
      return;
    }
    if (!keyBindings || !pendingCombo) return;

    // Build updated bindings — preserve sibling field.
    const updated: KeyBindings = { ...keyBindings, [hotkeyKey]: pendingCombo };

    // Validate against correction presets.
    const correctionSettings = await window.electronAPI.getCorrectSettings();
    const conflict = validateHotkeys(correctionSettings.presets, updated);
    if (conflict) {
      setStatus(
        `Error: "${conflict.hotkey}" conflicts with correction preset "${conflict.presetOrKey}".`,
      );
      return;
    }

    setStatus("Applying...");
    await window.electronAPI.pauseHotkeys();
    try {
      const result = await window.electronAPI.setKeyBindings(updated);
      if (result.success) {
        setKeyBindings(updated);
        setStatus("Applied! Shortcut updated.");
      } else {
        setStatus(`Error: ${result.error ?? "Unknown"}`);
      }
    } catch {
      setStatus("Error applying keybinding");
    } finally {
      await window.electronAPI.resumeHotkeys();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={`hotkey-${hotkeyKey}`}
        className="block text-sm font-medium text-gray-300"
      >
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={`hotkey-${hotkeyKey}`}
          type="text"
          value={pendingCombo}
          onKeyDown={handleKeyDown}
          readOnly
          placeholder="Press shortcut…"
          aria-label={`Hotkey for ${hotkeyKey}`}
          className={`flex-1 rounded px-2 py-1 bg-gray-700 text-white ${
            fieldError ? "border border-red-400" : "border border-gray-600"
          }`}
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={!pendingCombo || !!fieldError}
          className="px-3 py-1.5 text-xs font-semibold bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply
        </button>
      </div>
      {fieldError && (
        <p className="text-xs text-red-400" role="alert">
          {fieldError}
        </p>
      )}
      {status && (
        <p
          role="status"
          className={`text-xs ${
            status.startsWith("Error")
              ? "text-red-400"
              : status.startsWith("Applying")
                ? "text-yellow-400"
                : "text-green-400"
          }`}
        >
          {status}
        </p>
      )}
    </div>
  );
};
