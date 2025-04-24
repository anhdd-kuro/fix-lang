import React, { useState, useEffect } from "react";
import type { GlobalSettings } from "~/stores/apiStore";

/**
 * Global prompt settings tab for managing centralized AI request parameters.
 */
const SettingGlobalPrompt: React.FC = () => {
  const [settings, setSettings] = useState<GlobalSettings>({
    customSystemPrompt: "",
    customUserPrompt: "",
    tone: "",
    temperature: 1,
    top_p: 1.0,
    maxTokens: 10000,
  });
  const [saveStatus, setSaveStatus] = useState<string>("");

  // Load saved settings
  useEffect(() => {
    window.electronAPI?.getPromptSettings().then((loadedSettings) => {
      setSettings(loadedSettings);
    });
  }, []);

  // Update a single field in the settings object
  const updateSetting = <K extends keyof GlobalSettings>(
    key: K,
    value: GlobalSettings[K]
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    const result = await window.electronAPI?.setPromptSettings({
      ...settings,
    });
    if (result?.success) {
      setSaveStatus("Saved!");
      setTimeout(() => setSaveStatus(""), 2000);
    } else {
      setSaveStatus(`Error: ${result?.error || "Unknown"}`);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="system-prompt" className="text-gray-300 text-sm">
          System Prompt
        </label>
        <textarea
          id="system-prompt"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={settings.customSystemPrompt}
          onChange={(e) => updateSetting("customSystemPrompt", e.target.value)}
          placeholder="Enter custom system prompt. Leave blank for default."
          aria-label="System prompt"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="user-prompt" className="text-gray-300 text-sm">
          User Prompt Prefix
        </label>
        <textarea
          id="user-prompt"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={settings.customUserPrompt}
          onChange={(e) => updateSetting("customUserPrompt", e.target.value)}
          placeholder="Enter custom user prompt. Leave blank for default."
          aria-label="User prompt prefix"
        />
      </div>

      <fieldset className="flex gap-8 *:w-content flex-wrap">
        {/* Temperature input */}
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center text-gray-300">
            <span className="mr-2">Temperature</span>
            <input
              id="temperature-input"
              type="number"
              min="0"
              max="2"
              step="0.05"
              value={settings.temperature}
              onChange={(e) =>
                updateSetting("temperature", parseFloat(e.target.value) || 0)
              }
              className="w-16 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Temperature"
            />
          </label>
          <div className="text-xs text-gray-400">(0-1)</div>
        </div>

        {/* Top_p input */}
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center text-gray-300">
            <span className="mr-2">Top P</span>
            <input
              id="top-p-input"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={settings.top_p}
              onChange={(e) =>
                updateSetting("top_p", parseFloat(e.target.value) || 0)
              }
              className="w-16 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Top P"
            />
          </label>
          <div className="text-xs text-gray-400">(0-1)</div>
        </div>

        {/* Max tokens input */}
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center text-gray-300">
            <span className="mr-2">Max Tokens</span>
            <input
              id="max-tokens-input"
              type="number"
              min="100"
              max="32000"
              step="500"
              value={settings.maxTokens}
              onChange={(e) =>
                updateSetting("maxTokens", parseInt(e.target.value) || 10000)
              }
              className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Max Tokens"
            />
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="tone-input" className="text-gray-300 text-sm">
          Tone
        </label>
        <textarea
          id="tone-input"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={settings.tone}
          onChange={(e) => updateSetting("tone", e.target.value)}
          placeholder="'formal', 'casual', 'friendly' or leave blank for default."
          aria-label="Tone"
        />
      </div>

      <div className="flex items-center gap-2 mt-4">
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 w-full"
        >
          {saveStatus || "Save"}
        </button>
      </div>
    </section>
  );
};

export { SettingGlobalPrompt };
