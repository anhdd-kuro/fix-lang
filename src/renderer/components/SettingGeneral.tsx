import React, { useState, useEffect } from "react";
import { ModelSelect } from "./ModelSelect";
import { SettingUpdates } from "./SettingUpdates";
import type { CorrectionOutputMode } from "~/shared/outputMode";

/**
 * General settings tab for API key and model selection.
 */
export const SettingGeneral: React.FC = () => {
  const [resetStatus, setResetStatus] = useState<string>("");
  const [correctionOutputMode, setCorrectionOutputMode] =
    useState<CorrectionOutputMode>("paste");
  const [outputModeStatus, setOutputModeStatus] = useState<string>("");
  const [savingOutputMode, setSavingOutputMode] = useState(false);

  // Bumped after a reset to force ModelSelect to remount and reload its default
  const [modelSelectKey, setModelSelectKey] = useState(0);

  // API key — write-only; never round-tripped to the renderer.
  // The input is cleared after a successful save.
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [apiKeyStatus, setApiKeyStatus] = useState<string>("");
  const [apiKeySet, setApiKeySet] = useState<boolean>(false);

  // OpenRouter provisioning (admin) key — never round-tripped to the renderer.
  // The input is write-only; we only track whether a key is set (masked state).
  const [provisioningInput, setProvisioningInput] = useState<string>("");
  const [provisioningStatus, setProvisioningStatus] = useState<string>("");
  const [provisioningKeySet, setProvisioningKeySet] = useState<boolean>(false);

  // Initialize component — check set/not-set state; never fetch plaintext keys.
  useEffect(() => {
    window.electronAPI
      ?.hasApiKey?.()
      .then((isSet) => setApiKeySet(Boolean(isSet)))
      .catch((error) => {
        console.error("SettingGeneral: Error checking API key state:", error);
      });

    window.electronAPI
      ?.hasProvisioningKey?.()
      .then((isSet) => setProvisioningKeySet(Boolean(isSet)))
      .catch((error) => {
        console.error(
          "SettingGeneral: Error checking provisioning key state:",
          error
        );
      });

    window.electronAPI
      ?.getCorrectionOutputMode?.()
      .then(setCorrectionOutputMode)
      .catch((error) => {
        console.error("SettingGeneral: Error loading output mode:", error);
        setOutputModeStatus("Error loading correction output setting");
      });
  }, []);

  const handleOutputModeChange = async (mode: CorrectionOutputMode) => {
    if (!window.electronAPI?.setCorrectionOutputMode) {
      setOutputModeStatus("Error: Output setting is not available");
      return;
    }

    const previousMode = correctionOutputMode;
    setCorrectionOutputMode(mode);
    setSavingOutputMode(true);
    setOutputModeStatus("Saving...");

    try {
      const result = await window.electronAPI.setCorrectionOutputMode(mode);
      if (!result.success) {
        setCorrectionOutputMode(previousMode);
        setOutputModeStatus(`Error: ${result.error || "Failed to save"}`);
        return;
      }
      setCorrectionOutputMode(result.mode ?? mode);
      setOutputModeStatus("Saved.");
      setTimeout(() => setOutputModeStatus(""), 2000);
    } catch (error) {
      console.error("SettingGeneral: Error saving output mode:", error);
      setCorrectionOutputMode(previousMode);
      setOutputModeStatus("Error saving correction output setting");
    } finally {
      setSavingOutputMode(false);
    }
  };

  // Save the API key (encrypted via safeStorage in main).
  const handleSaveApiKey = async () => {
    if (!window.electronAPI?.setApiKey) {
      setApiKeyStatus("Error: Cannot save API key");
      return;
    }
    if (apiKeyInput.trim().length === 0) {
      setApiKeyStatus("Error: API key must not be empty");
      return;
    }
    if (!apiKeyInput.trim().startsWith("sk-")) {
      setApiKeyStatus("Warning: Key format may be invalid, but saving anyway...");
    } else {
      setApiKeyStatus("Saving...");
    }

    try {
      const result = await window.electronAPI.setApiKey(apiKeyInput);
      if (result.success) {
        setApiKeyStatus(result.warning ?? "Saved!");
        setApiKeySet(true);
        setApiKeyInput("");
      } else {
        setApiKeyStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error saving API key:", error);
      setApiKeyStatus("Error saving API key");
    }
  };

  // Clear the stored API key.
  const handleClearApiKey = async () => {
    if (!window.electronAPI?.clearApiKey) {
      setApiKeyStatus("Error: Cannot clear API key");
      return;
    }
    try {
      const result = await window.electronAPI.clearApiKey();
      if (result.success) {
        setApiKeyInput("");
        setApiKeySet(false);
        setApiKeyStatus("Cleared.");
      } else {
        setApiKeyStatus(`Error: ${result.error || "Failed to clear"}`);
      }
    } catch (error) {
      console.error("SettingGeneral: Error clearing API key:", error);
      setApiKeyStatus("Error clearing API key");
    }
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
      <section className="mb-4">
        <h2 className="text-sm font-medium text-card-foreground">
          Correction output
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose what FixLang does with the AI result after a correction hotkey
          finishes.
        </p>
        <div
          className="mt-3 grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="Correction output"
        >
          <button
            type="button"
            role="radio"
            aria-checked={correctionOutputMode === "paste"}
            disabled={savingOutputMode}
            onClick={() => void handleOutputModeChange("paste")}
            className={`rounded border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
              correctionOutputMode === "paste"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-secondary"
            }`}
          >
            <span className="block text-sm font-medium">Direct paste</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Replace the selected text.
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={correctionOutputMode === "popup"}
            disabled={savingOutputMode}
            onClick={() => void handleOutputModeChange("popup")}
            className={`rounded border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
              correctionOutputMode === "popup"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-secondary"
            }`}
          >
            <span className="block text-sm font-medium">Show popup</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Show the result without changing the source.
            </span>
          </button>
        </div>
        {outputModeStatus && (
          <p
            className={`mt-1 text-xs ${outputModeStatus.startsWith("Error") ? "text-destructive" : "text-success"}`}
            role="status"
          >
            {outputModeStatus}
          </p>
        )}
      </section>

      <div className="mb-4">
        <label
          htmlFor="api-key-input"
          className="block text-sm font-medium text-card-foreground mb-1"
        >
          API Key
        </label>
        <p
          className={`text-xs mb-1 ${apiKeySet ? "text-success" : "text-muted-foreground"}`}
          role="status"
        >
          {apiKeySet ? "Key is set" : "No key set"}
        </p>
        <input
          id="api-key-input"
          type="password"
          autoComplete="off"
          className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={apiKeyInput}
          onChange={(event) => {
            setApiKeyInput(event.target.value);
            setApiKeyStatus("");
          }}
          placeholder={
            apiKeySet
              ? "Enter a new key to replace the stored one"
              : "Enter your API key"
          }
          aria-label="API Key"
        />
        {apiKeyStatus && (
          <p
            className={`text-xs mt-1 ${apiKeyStatus.startsWith("Error") ? "text-destructive" : apiKeyStatus.startsWith("Warning") ? "text-warning" : "text-success"}`}
            role="status"
          >
            {apiKeyStatus}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleSaveApiKey}
            className="rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary"
          >
            Save key
          </button>
          <button
            type="button"
            disabled={!apiKeySet}
            onClick={handleClearApiKey}
            className="rounded border border-destructive/50 px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Stored encrypted by your OS (Keychain on macOS). Never shown again
          after saving.
        </p>
      </div>

      {/* OpenRouter Provisioning (admin) Key */}
      <div className="mb-4 border-t border-border pt-4">
        <label
          htmlFor="provisioning-key-input"
          className="block text-sm font-medium text-card-foreground mb-1"
        >
          OpenRouter Provisioning Key
        </label>
        <p
          className={`text-xs mb-1 ${provisioningKeySet ? "text-success" : "text-muted-foreground"}`}
          role="status"
        >
          {provisioningKeySet ? "Key is set" : "No key set"}
        </p>
        <input
          id="provisioning-key-input"
          type="password"
          autoComplete="off"
          className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
            className={`text-xs mt-1 ${provisioningStatus.startsWith("Error") ? "text-destructive" : provisioningStatus.startsWith("Warning") ? "text-warning" : "text-success"}`}
            role="status"
          >
            {provisioningStatus}
          </p>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleSaveProvisioningKey}
            className="rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary"
          >
            Save key
          </button>
          <button
            type="button"
            disabled={!provisioningKeySet}
            onClick={handleClearProvisioningKey}
            className="rounded border border-destructive/50 px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Stored encrypted by your OS (Keychain on macOS). High-privilege key —
          keep it secret. It is never shown again after saving.
        </p>
      </div>

      {/* Model Selection */}
      <ModelSelect key={modelSelectKey} />

      <SettingUpdates />

      {/* Reset to defaults */}
      <div className="mt-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="w-full rounded border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-destructive"
        >
          Reset all settings to default
        </button>
        {resetStatus && (
          <p
            className={`text-xs mt-1 ${resetStatus.startsWith("Error") ? "text-destructive" : "text-success"}`}
            role="status"
          >
            {resetStatus}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          Restores correction presets, summarize, prompt-gen, model settings
          and global hotkeys for the current profile. Your API key is kept.
        </p>
      </div>
    </div>
  );
};
