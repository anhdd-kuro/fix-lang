/**
 * @file HotkeyInput.tsx
 * @description Reusable hotkey capture widget used by SettingPromptGen and ProfileManager.
 * Pauses global hotkeys only while the capture field is focused (not for the whole
 * settings tab lifetime), resuming on blur. Validates against correction preset
 * hotkeys and the sibling app keybinding before saving.
 */
import React, { useState, useEffect } from "react";
import { COMBO_CANCEL_ACCELERATOR } from "~/features/correction/shared/comboValidation";
import { messageLabel, msg, type Message } from "~/features/i18n/shared/message";
import { Button } from "./Button";
import { plainStatus, wrappedError, resolveStatus, type StatusDescriptor } from "./statusDescriptor";
import { validateHotkeys } from "./validateHotkeys";
import { useI18n } from "../i18n/useI18n";
import type { KeyBindings } from "~/features/providers/store/apiStore";

type HotkeyKey = keyof KeyBindings; // "promptGen" | "profileSwitch"

export type HotkeyInputProps = {
  /** The keybinding field this widget edits. */
  hotkeyKey: HotkeyKey;
  /** Human-readable label shown above the input. */
  label: string;
};

/**
 * A self-contained hotkey capture widget.
 * - Pauses global hotkeys while the field is focused; resumes on blur.
 * - Reads current binding from electron store.
 * - Validates against correction presets + sibling keybinding on Apply.
 * - Writes updated bindings atomically (full KeyBindings object) to avoid
 *   zeroing out the sibling field.
 */
export const HotkeyInput: React.FC<HotkeyInputProps> = ({
  hotkeyKey,
  label,
}) => {
  const { t, tm, tl } = useI18n();
  const [keyBindings, setKeyBindings] = useState<KeyBindings | null>(null);
  const [pendingCombo, setPendingCombo] = useState<string>("");
  // Locale-free descriptor — was `useState<string>` filled by `t()` in
  // `handleKeyDown` (a synchronous key handler), which froze the message
  // into whatever locale was active at the keystroke and never re-translated
  // on a later locale switch.
  const [fieldError, setFieldError] = useState<Message | null>(null);
  // Same fix as `fieldError` — was `useState<string>` filled by `t()` in
  // `handleApply`.
  const [status, setStatus] = useState<StatusDescriptor | null>(null);
  // Separate from `status` text so styling never depends on matching an
  // English prefix — `status` itself is always already localized.
  const [statusKind, setStatusKind] = useState<"idle" | "error" | "applying" | "success">(
    "idle",
  );
  // Locale-free descriptor for the ONE error the mount effect below can
  // produce (`getKeyBindings()` rejecting). Kept separate from `status` (set
  // by `handleApply` below, an event handler — safe to resolve via `t()`
  // directly, since it is not a memoized/effect closure) so this effect never
  // needs to call `t()` itself, and therefore never needs `t` in its
  // dependency array. `handleApply` clears it so a later action's status
  // always supersedes a stale load-error banner.
  const [loadError, setLoadError] = useState<Message | null>(null);

  useEffect(() => {
    window.electronAPI
      ?.getKeyBindings()
      .then((bindings) => {
        setKeyBindings(bindings);
        setPendingCombo(bindings[hotkeyKey]);
      })
      .catch((err) => {
        console.error("HotkeyInput: failed to load key bindings", err);
        setStatusKind("error");
        setLoadError(msg("settings.hotkeys.loadError"));
      });

    // Safety net: if the widget unmounts while the field is still focused
    // (e.g. settings window closes mid-capture), make sure hotkeys resume.
    return () => {
      window.electronAPI?.resumeHotkeys();
    };
  }, [hotkeyKey]);

  // Pause global hotkeys only while the field is focused for capture — not for
  // the whole lifetime of the settings tab. Resume as soon as focus leaves.
  const handleFocus = (): void => {
    window.electronAPI?.pauseHotkeys();
  };

  const handleBlur = (): void => {
    window.electronAPI?.resumeHotkeys();
  };

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
      setFieldError(msg("settings.hotkeys.needsKey"));
      return;
    }

    // Refused at capture rather than left to Apply: binding it would make an
    // in-flight combo silently uncancellable, since the run's own
    // `globalShortcut.register` just returns false and the run continues.
    if (newCombo === COMBO_CANCEL_ACCELERATOR) {
      setFieldError(
        msg("settings.hotkeys.reservedComboCancel", { hotkey: newCombo }),
      );
      return;
    }

    // Check intra-app duplicate (against sibling keybinding).
    if (keyBindings) {
      const siblingKeys = (Object.keys(keyBindings) as HotkeyKey[]).filter(
        (k) => k !== hotkeyKey,
      );
      const sibling = siblingKeys.find((k) => keyBindings[k] === newCombo);
      if (sibling) {
        setFieldError(msg("settings.hotkeys.duplicateWith", { sibling }));
        return;
      }
    }

    setFieldError(null);
    setPendingCombo(newCombo);
  };

  const handleApply = async (): Promise<void> => {
    // Any user-triggered apply supersedes a stale mount-time load-error banner.
    setLoadError(null);
    if (fieldError) {
      setStatusKind("error");
      setStatus(wrappedError({ kind: "message", message: fieldError }));
      return;
    }
    if (!keyBindings || !pendingCombo) return;

    // Build updated bindings — preserve sibling field.
    const updated: KeyBindings = { ...keyBindings, [hotkeyKey]: pendingCombo };

    // Validate against every other keybinding — presets, combos, the sibling
    // app binding and the reserved combo cancel chord. Both colliding parties
    // are named because either one of them can be the field being edited.
    const correctionSettings = await window.electronAPI.getCorrectSettings();
    const conflict = validateHotkeys(
      correctionSettings.presets,
      updated,
      correctionSettings.combos,
    );
    if (conflict) {
      setStatusKind("error");
      setStatus(
        wrappedError(
          messageLabel("settings.hotkeys.conflict", {
            hotkey: conflict.hotkey,
            presetOrKey: conflict.presetOrKey,
            conflictsWith: conflict.conflictsWith,
          }),
        ),
      );
      return;
    }

    setStatusKind("applying");
    setStatus(plainStatus("settings.hotkeys.applying"));
    await window.electronAPI.pauseHotkeys();
    try {
      const result = await window.electronAPI.setKeyBindings(updated);
      if (result.success) {
        setKeyBindings(updated);
        setStatusKind("success");
        setStatus(plainStatus("settings.hotkeys.applied"));
      } else {
        setStatusKind("error");
        setStatus(
          wrappedError(
            result.error ?? messageLabel("settings.hotkeys.applyErrorUnknown"),
          ),
        );
      }
    } catch {
      setStatusKind("error");
      setStatus(plainStatus("settings.hotkeys.applyError"));
    } finally {
      await window.electronAPI.resumeHotkeys();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={`hotkey-${hotkeyKey}`}
        className="block text-sm font-medium text-card-foreground"
      >
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={`hotkey-${hotkeyKey}`}
          type="text"
          value={pendingCombo}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          readOnly
          placeholder={t("settings.hotkeys.pressShortcut")}
          aria-label={t("settings.hotkeys.ariaLabel", { hotkeyKey })}
          className={`flex-1 rounded px-2 py-1 bg-secondary text-secondary-foreground ${
            fieldError
              ? "border border-destructive"
              : "border border-control-border"
          }`}
        />
        <Button
          type="button"
          onClick={handleApply}
          disabled={!pendingCombo || !!fieldError}
          className="px-3 py-1.5 text-xs font-semibold rounded"
        >
          {t("settings.hotkeys.applyButton")}
        </Button>
      </div>
      {fieldError && (
        <p className="text-xs text-destructive" role="alert">
          {tm(fieldError)}
        </p>
      )}
      {(loadError || status) && (
        <p
          role="status"
          className={`text-xs ${
            statusKind === "error"
              ? "text-destructive"
              : statusKind === "applying"
                ? "text-warning"
                : "text-success"
          }`}
        >
          {loadError ? tm(loadError) : resolveStatus(status, t, tm, tl)}
        </p>
      )}
    </div>
  );
};
