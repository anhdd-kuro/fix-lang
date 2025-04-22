import React, { useState, useEffect } from "react";
import type { KeyBindings } from "~/preload/preload-api.types";

export const SettingKeyBinding: React.FC = () => {
  const [keyBindings, setKeyBindings] = useState<KeyBindings | null>(null);
  const [keyBindingsStatus, setKeyBindingsStatus] = useState<string>("");
  const [errors, setErrors] = useState<Record<keyof KeyBindings, string>>({
    correction: "",
    translate: "",
    summarize: "",
    promptGen: "",
  });

  // Fetch Key Bindings when component mounts
  useEffect(() => {
    setKeyBindingsStatus(""); // Clear key binding status
    console.log("SettingKeyBinding: Fetching Key Bindings...");

    window.electronAPI?.pauseHotkeys();

    // Fetch Key Bindings
    window.electronAPI
      ?.getKeyBindings()
      .then((bindings) => {
        console.log("SettingKeyBinding: Received key bindings:", bindings);
        setKeyBindings(bindings);
      })
      .catch((error) => {
        console.error("SettingKeyBinding: Error fetching key bindings:", error);
        // Handle error appropriately, maybe show a message
      });

    return () => {
      window.electronAPI?.resumeHotkeys();
    };
  }, []);

  // Handle capturing hotkey input
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    cmd: keyof KeyBindings
  ) => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.metaKey) parts.push("Meta");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!["Control", "Meta", "Alt", "Shift"].includes(key)) parts.push(key);
    const newCombo = parts.join("+");
    let errorMsg = "";
    if (
      parts.length === 0 ||
      !parts.some((p) => !["Control", "Meta", "Alt", "Shift"].includes(p))
    ) {
      errorMsg = "Include a non-modifier key";
    } else {
      const duplicate = (
        Object.keys(keyBindings || {}) as (keyof KeyBindings)[]
      ).find((k) => k !== cmd && keyBindings && keyBindings[k] === newCombo);
      if (duplicate) errorMsg = `Duplicate with ${duplicate}`;
    }
    setErrors((prev) => ({ ...prev, [cmd]: errorMsg }));
    if (!errorMsg)
      setKeyBindings((prev) => (prev ? { ...prev, [cmd]: newCombo } : null));
  };

  // Apply new keybindings: validate, persist, and re-register shortcuts
  const handleApply = async () => {
    // Validate
    const firstError = (
      Object.entries(errors) as [keyof KeyBindings, string][]
    ).find(([_, msg]) => msg);
    if (firstError) {
      setKeyBindingsStatus(`Error: ${firstError[1]}`);
      return;
    }
    if (!keyBindings) return;
    setKeyBindingsStatus("Applying...");
    // Pause existing shortcuts during update
    await window.electronAPI.pauseHotkeys();
    try {
      const result = await window.electronAPI.setKeyBindings(keyBindings);
      if (result.success) {
        setKeyBindingsStatus("Applied! Shortcuts updated.");
      } else {
        setKeyBindingsStatus(`Error: ${result.error || "Unknown"}`);
      }
    } catch {
      setKeyBindingsStatus("Error applying keybindings");
    } finally {
      await window.electronAPI.resumeHotkeys();
    }
  };

  // Handle reset to defaults: pause shortcuts, reset store, resume shortcuts
  const handleReset = async () => {
    setKeyBindingsStatus("Resetting...");
    await window.electronAPI.pauseHotkeys();
    try {
      const defaults = await window.electronAPI.resetKeyBindings();
      setKeyBindings(defaults);
      setErrors({
        correction: "",
        translate: "",
        summarize: "",
        promptGen: "",
      });
      setKeyBindingsStatus("Reset! Shortcuts restored.");
    } catch {
      setKeyBindingsStatus("Error resetting");
    } finally {
      await window.electronAPI.resumeHotkeys();
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <ul className="flex flex-col gap-6">
        {keyBindings &&
          (
            [
              "correction",
              "translate",
              "summarize",
              "promptGen",
            ] as (keyof KeyBindings)[]
          ).map((cmd) => (
            <li key={cmd} className="flex items-center gap-6">
              <label
                htmlFor={`hotkey-${cmd}`}
                className="w-20 text-gray-300 capitalize"
              >
                {cmd}
              </label>
              <input
                id={`hotkey-${cmd}`}
                type="text"
                value={keyBindings[cmd]}
                onKeyDown={(e) => handleKeyDown(e, cmd)}
                placeholder="Press shortcut"
                className={`flex-1 px-2 py-1 bg-gray-700 text-white rounded ${
                  errors[cmd]
                    ? "border border-red-400"
                    : "border border-gray-600"
                }`}
                aria-label={`Hotkey for ${cmd}`}
              />
            </li>
          ))}
      </ul>
      <div className="flex flex-col gap-4 mt-4">
        <button
          type="button"
          onClick={handleApply}
          className="px-3 py-2 text-xs font-semibold bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="px-3 py-2 text-xs font-semibold bg-neutral-500 text-white rounded hover:bg-neutral-400"
        >
          Reset to defaults
        </button>
      </div>
      {keyBindingsStatus && (
        <p
          className={`text-xs mt-1 text-center ${
            keyBindingsStatus.startsWith("Error")
              ? "text-red-400"
              : keyBindingsStatus.startsWith("Warning")
                ? "text-yellow-400"
                : "text-green-400"
          }`}
          role="status"
        >
          {keyBindingsStatus}
        </p>
      )}
    </section>
  );
};
