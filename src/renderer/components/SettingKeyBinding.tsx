import React, { useState, useEffect } from "react";
import { KeyBinding } from "./KeyBinding";

/**
 * Key bindings tab for setting shortcut keys.
 */
type KeyBindings = {
  fix: string;
  undo: string;
  retry: string;
};

export const SettingKeyBinding: React.FC = () => {
  const [keyBindings, setKeyBindings] = useState<KeyBindings | null>(null);
  const [keyBindingsStatus, setKeyBindingsStatus] = useState<string>("");

  // Fetch Key Bindings when component mounts
  useEffect(() => {
    setKeyBindingsStatus(""); // Clear key binding status
    console.log("SettingKeyBinding: Fetching Key Bindings...");

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
  }, []);

  // Handle saving key bindings
  const handleKeyBindingBlur = async () => {
    if (!keyBindings) {
      console.error("Cannot save null key bindings");
      setKeyBindingsStatus("Error: No bindings loaded");
      return;
    }
    if (!window.electronAPI?.setKeyBindings) {
      console.error("setKeyBindings function not available on electronAPI");
      setKeyBindingsStatus("Error: Cannot save bindings");
      return;
    }

    // TODO: Add validation for Electron Accelerator format before saving
    console.log("SettingKeyBinding: Attempting to save key bindings:", keyBindings);
    setKeyBindingsStatus("Saving...");
    try {
      const result = await window.electronAPI.setKeyBindings(keyBindings);
      if (result.success) {
        console.log("SettingKeyBinding: Key bindings saved successfully.");
        setKeyBindingsStatus("Saved! Restart required.");
      } else {
        console.error(
          "SettingKeyBinding: Failed to save key bindings:",
          result.error
        );
        setKeyBindingsStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingKeyBinding: Error calling setKeyBindings:", error);
      setKeyBindingsStatus("Error saving bindings");
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-medium text-gray-300 mb-2">Key Bindings</h3>
      <KeyBinding
        label="Fix"
        keysBinding={["Control", "Shift", "F"]}
        onChange={(keysBinding) => {
          const newKeyBindings = keysBinding.join("+");
          setKeyBindings((prev) =>
            prev
              ? { ...prev, fix: newKeyBindings }
              : { fix: newKeyBindings, undo: "", retry: "" }
          );
          setKeyBindingsStatus("");
        }}
      />
      <KeyBinding
        label="Undo"
        keysBinding={["Control", "Shift", "Z"]}
        onChange={(keysBinding) => {
          const newKeyBindings = keysBinding.join("+");
          setKeyBindings((prev) =>
            prev
              ? { ...prev, undo: newKeyBindings }
              : { undo: newKeyBindings, fix: "", retry: "" }
          );
          setKeyBindingsStatus("");
        }}
      />
      <KeyBinding
        label="Retry"
        keysBinding={["Control", "Shift", "A"]}
        onChange={(keysBinding) => {
          const newKeyBindings = keysBinding.join("+");
          setKeyBindings((prev) =>
            prev
              ? { ...prev, retry: newKeyBindings }
              : { retry: newKeyBindings, fix: "", undo: "" }
          );
          setKeyBindingsStatus("");
        }}
      />
      {keyBindingsStatus && (
        <p
          className={`text-xs mt-1 ${
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
      <div className="mt-4">
        <button
          type="button"
          onClick={handleKeyBindingBlur}
          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Save Key Bindings
        </button>
      </div>
    </section>
  );
};
