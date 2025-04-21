import React, { useState, useEffect } from "react";
import { ModelSelect } from "./ModelSelect";

/**
 * General settings tab for API key and model selection.
 */
export const SettingGeneral: React.FC = () => {
  // State for the API Key input field
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<string>("");

  // State for the Translation Language input field
  const [translationLang, setTranslationLang] = useState<string>("");
  const [langStatus, setLangStatus] = useState<string>("");

  // Track unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

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

    // Fetch Translation Settings
    window.electronAPI
      ?.getTranslateSettings()
      .then(({ destinationLang }) => {
        console.log(
          `SettingGeneral: Received translation language: ${destinationLang}`
        );
        setTranslationLang(destinationLang || "");
      })
      .catch((error) => {
        console.error(
          "SettingGeneral: Error fetching translation settings:",
          error
        );
        setLangStatus("Error fetching settings");
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

  // Handle changes to the Translation Language input field
  const handleLangChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setTranslationLang(event.target.value);
    setLangStatus(""); // Clear status on change
    setHasChanges(true);
  };

  // Handle saving the Translation Language when the input loses focus
  const handleLangBlur = async () => {
    if (!window.electronAPI?.setTranslateSettings) {
      console.error(
        "setTranslateSettings function not available on electronAPI"
      );
      setLangStatus("Error: Cannot save language");
      return;
    }

    console.log(
      `SettingGeneral: Attempting to save translation language: ${translationLang}`
    );

    try {
      // Add a small delay to ensure UI updates before the potentially blocking IPC call
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await window.electronAPI.setTranslateSettings({
        destinationLang: translationLang,
        includeExplanation: false,
      });

      if (result.success) {
        console.log("SettingGeneral: Translation language saved successfully.");
        setLangStatus("Saved!");
      } else {
        console.error(
          "SettingGeneral: Failed to save translation language:",
          result.error
        );
        setLangStatus(`Error: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error(
        "SettingGeneral: Error calling setTranslateSettings:",
        error
      );
      setLangStatus("Error saving language");
    }
  };

  // Save both settings
  const handleSaveAll = async () => {
    await handleApiKeyBlur();
    await handleLangBlur();
    setHasChanges(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-4">
        <label
          htmlFor="api-key-input"
          className="block text-sm font-medium text-gray-300 mb-1"
        >
          OpenAI API Key
        </label>
        <input
          id="api-key-input"
          type="password"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={apiKeyInput}
          onChange={handleApiKeyChange}
          placeholder="Enter your OpenAI API key"
          aria-label="OpenAI API Key"
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
      <ModelSelect />
      {/* Translation Target Language */}
      <div className="mt-4">
        <label
          htmlFor="translation-lang"
          className="block text-sm font-medium text-gray-300 mb-1"
        >
          Translation Target Language
        </label>
        <input
          id="translation-lang"
          type="text"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={translationLang}
          onChange={handleLangChange}
          placeholder={navigator.language || "en"}
          aria-label="Translation Target Language"
        />
        {langStatus && (
          <p
            className={`text-xs mt-1 ${langStatus.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
            role="status"
          >
            {langStatus}
          </p>
        )}
      </div>
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
    </div>
  );
};
