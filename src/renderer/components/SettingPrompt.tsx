import React, { useState, useEffect } from "react";

/**
 * Prompt settings tab for managing custom global prompts.
 */
const SettingPrompt: React.FC = () => {
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [tone, setTone] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.3);
  const [saveStatus, setSaveStatus] = useState<string>("");

  // Load saved settings
  useEffect(() => {
    window.electronAPI?.getPromptSettings().then((settings) => {
      setSystemPrompt(settings.customSystemPrompt);
      setUserPrompt(settings.customUserPrompt);
      setTone(settings.tone);
      setTemperature(settings.temperature);
    });
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI?.setPromptSettings({
      customSystemPrompt: systemPrompt,
      customUserPrompt: userPrompt,
      withGrammar: true, // No longer configurable in UI, always enabled
      withShorten: false, // Moved to correct settings
      tone,
      temperature,
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
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
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
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder="Enter custom user prompt. Leave blank for default."
          aria-label="User prompt prefix"
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="inline-flex items-center text-gray-300">
          <span className="mr-2">Temperature</span>
          <input
            id="temperature-input"
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
            className="w-16 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Temperature"
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="tone-input" className="text-gray-300 text-sm">
          Tone
        </label>
        <textarea
          id="tone-input"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
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

export { SettingPrompt };
