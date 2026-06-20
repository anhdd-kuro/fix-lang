import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { ModelSelect } from "./ModelSelect";

// Define a type and default settings for translation settings
type TranslateSettings = {
  destinationLang: string;
  includeExplanation: boolean;
  model: string;
};

const defaultSettings: TranslateSettings = {
  destinationLang: "",
  includeExplanation: false,
  model: DEFAULT_OPENAI_MODEL,
};

export const SettingTranslate: React.FC = () => {
  const [translateSettings, setTranslateSettings] = useState<TranslateSettings>(defaultSettings);
  const [status, setStatus] = useState("");
  const [_isLoading, setIsLoading] = useState(false);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const settings = await window.electronAPI.getTranslationSettings();
      // Ensure all required properties exist in the settings
      const completeSettings: TranslateSettings = {
        destinationLang: settings.destinationLang || "",
        includeExplanation: settings.includeExplanation || false,
        model: settings.model || DEFAULT_OPENAI_MODEL,
      };
      setTranslateSettings(completeSettings);
    } catch (err) {
      console.error("Failed to load Translation settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Load initial settings
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const result = await window.electronAPI.setTranslationSettings(translateSettings);
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
        featureId="settingsTranslate"
        useFeatureModel={true}
        onChange={(modelId) => 
          setTranslateSettings({
            ...translateSettings,
            model: modelId
          })
        }
      />
      <div>
        <label
          htmlFor="translate-destination-lang"
          className="block text-label-primary text-sm mb-2"
        >
          Destination Language
        </label>
        <input
          id="translate-destination-lang"
          title="Destination language for translation"
          placeholder="Enter target language"
          type="text"
          value={translateSettings.destinationLang}
          onChange={(e) => setTranslateSettings({
            ...translateSettings,
            destinationLang: e.target.value
          })}
          className="w-full p-2 bg-control border border-separator/60 rounded text-label-primary"
        />
      </div>
      <label className="inline-flex items-center text-label-primary">
        <input
          type="checkbox"
          checked={translateSettings.includeExplanation}
          onChange={() => setTranslateSettings({
            ...translateSettings,
            includeExplanation: !translateSettings.includeExplanation
          })}
          className="form-checkbox"
        />
        <span className="ml-2">Include Explanation</span>
      </label>
      <button
        type="button"
        onClick={handleSave}
        className="px-3 py-2 bg-accent text-label-primary rounded hover:bg-accent-hover"
      >
        {status || "Save"}
      </button>
    </section>
  );
};
