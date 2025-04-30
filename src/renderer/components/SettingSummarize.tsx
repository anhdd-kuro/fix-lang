import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL, DEFAULT_LANGUAGE } from "~/const";
import { ModelSelect } from "./ModelSelect";

// Define a type and default settings for summarize settings
type SummarizeSettings = {
  minLength: number;
  maxLength: number;
  model: string;
  targetLanguage: string;
};

const defaultSettings: SummarizeSettings = {
  minLength: 0,
  maxLength: 0,
  model: DEFAULT_OPENAI_MODEL,
  targetLanguage: DEFAULT_LANGUAGE,
};

export const SettingSummarize: React.FC = () => {
  const [summarizeSettings, setSummarizeSettings] = useState<SummarizeSettings>(defaultSettings);
  const [status, setStatus] = useState<string>("");
  const [_isLoading, setIsLoading] = useState(false);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const settings = await window.electronAPI.getSummarizeSettings();
      // Ensure all required properties exist in the settings
      const completeSettings: SummarizeSettings = {
        minLength: settings.minLength || 0,
        maxLength: settings.maxLength || 0,
        model: settings.model || DEFAULT_OPENAI_MODEL,
        targetLanguage: settings.targetLanguage || DEFAULT_LANGUAGE,
      };
      setSummarizeSettings(completeSettings);
    } catch (err) {
      console.error("Failed to load Summarize settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Load initial settings
  useEffect(() => {
    loadSettings();
  }, []);

  // Sync settings on updates
  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      loadSettings();
    });
    return () => off?.();
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setSummarizeSettings(summarizeSettings);
    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else {
      setStatus("Error");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      {/* Model Selection */}
      <ModelSelect
        featureId="settingsSummarize"
        useFeatureModel={true}
        onChange={(modelId) => 
          setSummarizeSettings({
            ...summarizeSettings,
            model: modelId
          })
        }
      />
      <div>
        <label
          htmlFor="summarize-target-language"
          className="block text-gray-300 text-sm mb-1"
        >
          Target Language
        </label>
        <input
          id="summarize-target-language"
          title="Target language for summary"
          placeholder="Enter target language"
          type="text"
          value={summarizeSettings.targetLanguage}
          onChange={(e) => setSummarizeSettings({
            ...summarizeSettings,
            targetLanguage: e.target.value
          })}
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100"
        />
      </div>
      <div className="flex gap-2">
        <div>
          <label
            htmlFor="summarize-min-length"
            className="block text-gray-300 text-sm"
          >
            Min Length
          </label>
          <input
            id="summarize-min-length"
            title="Minimum summary length"
            placeholder="Enter min length"
            type="number"
            value={summarizeSettings.minLength}
            onChange={(e) => setSummarizeSettings({
              ...summarizeSettings,
              minLength: parseInt(e.target.value) || 0
            })}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
          />
        </div>
        <div>
          <label
            htmlFor="summarize-max-length"
            className="block text-gray-300 text-sm"
          >
            Max Length
          </label>
          <input
            id="summarize-max-length"
            title="Maximum summary length"
            placeholder="Enter max length"
            type="number"
            value={summarizeSettings.maxLength}
            onChange={(e) => setSummarizeSettings({
              ...summarizeSettings,
              maxLength: parseInt(e.target.value) || 0
            })}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {status || "Save"}
      </button>
    </section>
  );
};
