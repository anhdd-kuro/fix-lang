import React, { useState, useEffect } from "react";
import { ModelSelect } from "./ModelSelect";

/**
 * General settings tab for API key and model selection.
 */
export const SettingGeneral: React.FC = () => {
  // State for the API Key input field
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [resetStatus, setResetStatus] = useState<string>("");

  // Bumped after a reset to force ModelSelect to remount and reload its default
  const [modelSelectKey, setModelSelectKey] = useState(0);

  // Track unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  // OpenRouter provisioning (admin) key — never round-tripped to the renderer.
  // The input is write-only; we only track whether a key is set (masked state).
  const [provisioningInput, setProvisioningInput] = useState<string>("");
  const [provisioningStatus, setProvisioningStatus] = useState<string>("");
  const [provisioningKeySet, setProvisioningKeySet] = useState<boolean>(false);

  // Initialize component
  useEffect(() => {
    // Fetch API Key
    window.electronAPI
      ?.getApiKey()
      .then((key) => {
        console.log(
          `SettingGeneral: Received key (length: ${key?.length ?? 0})`
        );
        setApiKeyInput(key || ""); // Set input value, default to empty string
      })
      .catch((error) => {
        console.error("SettingGeneral: Error fetching API key:", error);
        setSaveStatus("Error fetching key");
      });

    // Masked provisioning-key state (never fetch the plaintext key).
    window.electronAPI
      ?.hasProvisioningKey?.()
      .then((isSet) => setProvisioningKeySet(Boolean(isSet)))
      .catch((error) => {
        console.error(
          "SettingGeneral: Error checking provisioning key state:",
          error
        );
      });
  }, []);

  // Handle changes to the input field
  const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(event.target.value);
    setSaveStatus(""); // Clear status on change
    setHasChanges(true);
  };

  // Handle saving the API Key when the input loses focus
  const handleApiKeyBlur = async () => {
    if (!window.electronAPI?.setApiKey) {
      console.error("setApiKey function not available on electronAPI");
      setSaveStatus("Error: Cannot save key");
      return;
    }

    // Basic validation
    if (
      apiKeyInput &&
      !apiKeyInput.startsWith("sk-") &&
      apiKeyInput.length > 0
    ) {
      console.warn("API key doesn't start with 'sk-', might not be valid");
      // We'll still try to save it, but warn the user
      setSaveStatus("Warning: Key format may be invalid, but saving anyway...");
    } else {
      setSaveStatus("Saving...");
    }

    console.log(
      `SettingGeneral: Attempting to save API key (length: ${apiKeyInput.length})`
    );

    try {
      // Add a small delay to ensure UI updates before the potentially blocking IPC call
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await window.electronAPI.setApiKey(apiKeyInput);

      if (result.success) {
        console.log("SettingGeneral: API Key saved successfully.");
        setSaveStatus("Saved!");

        // Verify the key was saved by retrieving it again
        const verifiedKey = await window.electronAPI.getApiKey();
        if (verifiedKey !== apiKeyInput) {
          console.error("SettingGeneral: API Key verification failed");
          setSaveStatus("Warning: Key saved but verification failed");
        }
      } else {
        console.error("SettingGeneral: Failed to save API Key:", result.error);
        setSaveStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error calling setApiKey:", error);
      setSaveStatus("Error saving key");
    }
  };

  // Save settings
  const handleSaveAll = async () => {
    await handleApiKeyBlur();
    setHasChanges(false);
  };

  // Reset the current profile's settings to defaults (keeps the API key).
  const handleResetDefaults = async () => {
    const confirmed = window.confirm(
      "Reset all settings for the current profile to defaults?\n\n" +
        "Your API key is kept. Correction presets, summarize, prompt-gen, " +
        "model settings and global hotkeys will be restored to defaults. " +
        "This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    if (!window.electronAPI?.resetProfileSettings) {
      setResetStatus("Error: Reset is not available");
      return;
    }

    setResetStatus("Resetting...");
    try {
      const result = await window.electronAPI.resetProfileSettings();
      if (result.success) {
        setResetStatus("Settings reset to defaults.");
        setHasChanges(false);
        // Remount ModelSelect so it reloads the (now default) model.
        setModelSelectKey((key) => key + 1);
        setTimeout(() => setResetStatus(""), 2500);
      } else {
        setResetStatus(`Error: ${result.error || "Failed to reset"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error resetting settings:", error);
      setResetStatus("Error resetting settings");
    }
  };

  // Save the OpenRouter provisioning key (encrypted via safeStorage in main).
  const handleSaveProvisioningKey = async () => {
    if (!window.electronAPI?.setProvisioningKey) {
      setProvisioningStatus("Error: Cannot save provisioning key");
      return;
    }
    if (provisioningInput.trim().length === 0) {
      setProvisioningStatus("Error: Provisioning key must not be empty");
      return;
    }
    // Soft prefix check, mirroring the API key 'sk-' warning.
    if (!provisioningInput.trim().startsWith("sk-or-")) {
      setProvisioningStatus(
        "Warning: Key format may be invalid, but saving anyway..."
      );
    } else {
      setProvisioningStatus("Saving...");
    }

    try {
      const result =
        await window.electronAPI.setProvisioningKey(provisioningInput);
      if (result.success) {
        setProvisioningStatus("Saved!");
        setProvisioningKeySet(true);
        // Clear the input so the secret does not linger in renderer state/DOM.
        setProvisioningInput("");
      } else {
        setProvisioningStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error saving provisioning key:", error);
      setProvisioningStatus("Error saving provisioning key");
    }
  };

  // Clear the stored provisioning key.
  const handleClearProvisioningKey = async () => {
    if (!window.electronAPI?.clearProvisioningKey) {
      setProvisioningStatus("Error: Cannot clear provisioning key");
      return;
    }
    try {
      const result = await window.electronAPI.clearProvisioningKey();
      if (result.success) {
        setProvisioningInput("");
        setProvisioningKeySet(false);
        setProvisioningStatus("Cleared.");
      } else {
        setProvisioningStatus(`Error: ${result.error || "Failed to clear"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error clearing provisioning key:", error);
      setProvisioningStatus("Error clearing provisioning key");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-4">
        <label
          htmlFor="api-key-input"
          className="block text-sm font-medium text-gray-300 mb-1"
        >
          API Key
        </label>
        <input
          id="api-key-input"
          type="password"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={apiKeyInput}
          onChange={handleApiKeyChange}
          placeholder="Enter your API key"
          aria-label="API Key"
        />
        {saveStatus && (
          <p
            className={`text-xs mt-1 ${saveStatus.startsWith("Error") ? "text-red-400" : saveStatus.startsWith("Warning") ? "text-yellow-400" : "text-green-400"}`}
            role="status"
          >
            {saveStatus}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Your API key is stored locally and never sent to our servers.
        </p>
      </div>

      {/* OpenRouter Provisioning (admin) Key */}
      <div className="mb-4 border-t border-gray-700 pt-4">
        <label
          htmlFor="provisioning-key-input"
          className="block text-sm font-medium text-gray-300 mb-1"
        >
          OpenRouter Provisioning Key
        </label>
        <p
          className={`text-xs mb-1 ${provisioningKeySet ? "text-green-400" : "text-gray-400"}`}
          role="status"
        >
          {provisioningKeySet ? "Key is set" : "No key set"}
        </p>
        <input
          id="provisioning-key-input"
          type="password"
          autoComplete="off"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={provisioningInput}
          onChange={(event) => {
            setProvisioningInput(event.target.value);
            setProvisioningStatus("");
          }}
          placeholder={
            provisioningKeySet
              ? "Enter a new key to replace the stored one"
              : "Enter your OpenRouter provisioning key"
          }
          aria-label="OpenRouter Provisioning Key"
        />
        {provisioningStatus && (
          <p
            className={`text-xs mt-1 ${provisioningStatus.startsWith("Error") ? "text-red-400" : provisioningStatus.startsWith("Warning") ? "text-yellow-400" : "text-green-400"}`}
            role="status"
          >
            {provisioningStatus}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleSaveProvisioningKey}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500"
          >
            Save key
          </button>
          <button
            type="button"
            disabled={!provisioningKeySet}
            onClick={handleClearProvisioningKey}
            className="rounded border border-red-500/50 px-3 py-1.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Stored encrypted by your OS (Keychain on macOS). High-privilege key —
          keep it secret. It is never shown again after saving.
        </p>
      </div>

      {/* Model Selection */}
      <ModelSelect key={modelSelectKey} onChange={() => setHasChanges(true)} />

      {/* Save Button */}
      <div className="mt-4">
        <button
          type="button"
          disabled={!hasChanges}
          onClick={handleSaveAll}
          className={`px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50 w-full`}
        >
          Save
        </button>
      </div>

      {/* Reset to defaults */}
      <div className="mt-2 border-t border-gray-700 pt-4">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="w-full rounded border border-red-500/50 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          Reset all settings to default
        </button>
        {resetStatus && (
          <p
            className={`text-xs mt-1 ${resetStatus.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
            role="status"
          >
            {resetStatus}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Restores correction presets, summarize, prompt-gen, model settings
          and global hotkeys for the current profile. Your API key is kept.
        </p>
      </div>
    </div>
  );
};
