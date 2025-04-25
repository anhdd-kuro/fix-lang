import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { ModelSelect } from "./ModelSelect";
import Tooltip from "./Tooltip";
import {
  DEFAULT_CUSTOM_PROMPT,
  DEFAULT_PARAPHRASE_SAME_LENGTH_PROMPT,
  DEFAULT_PARAPHRASE_SHORTEN_PROMPT,
  DEFAULT_PARAPHRASE_EXPAND_PROMPT,
} from "../../prompts/correction";

type ParaphraseMode = "same-length" | "shorten" | "expand" | "custom";

type CorrectSettings = {
  paraphrase: boolean;
  withShorten: boolean;
  paraphrasePrompt: string;
  userInput: string;
  model: string;
};

const defaultSettings: CorrectSettings = {
  paraphrase: false,
  withShorten: false,
  paraphrasePrompt: "",
  userInput: "",
  model: DEFAULT_OPENAI_MODEL,
};

export const SettingCorrection: React.FC = () => {
  const [correctSettings, setCorrectSettings] =
    useState<CorrectSettings>(defaultSettings);
  const [paraphraseMode, setParaphraseMode] =
    useState<ParaphraseMode>("same-length");
  const [status, setStatus] = useState<string>("");
  const [_isLoading, setIsLoading] = useState<boolean>(true);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const settings = await window.electronAPI.getCorrectSettings();
      // Ensure all required properties exist in the settings
      const completeSettings: CorrectSettings = {
        paraphrase: settings.paraphrase ?? false,
        withShorten: settings.withShorten ?? false,
        paraphrasePrompt: settings.paraphrasePrompt ?? "",
        userInput: settings.userInput ?? "",
        model: settings.model ?? DEFAULT_OPENAI_MODEL,
      };
      setCorrectSettings(completeSettings);

      // Set paraphrase mode based on loaded settings
      if (settings.withShorten) {
        setParaphraseMode("shorten");
      } else if (settings.paraphrase && settings.paraphrasePrompt) {
        setParaphraseMode("custom");
      }
    } catch (err) {
      console.error("Failed to load Correction settings:", err);
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
    // Set withShorten based on paraphrase mode
    const withShortenValue = paraphraseMode === "shorten";

    // Set appropriate paraphrasePrompt based on selected mode
    let promptToSave = "";
    if (correctSettings.paraphrase) {
      switch (paraphraseMode) {
        case "same-length":
          promptToSave = DEFAULT_PARAPHRASE_SAME_LENGTH_PROMPT.trim();
          break;
        case "shorten":
          promptToSave = DEFAULT_PARAPHRASE_SHORTEN_PROMPT.trim();
          break;
        case "expand":
          promptToSave = DEFAULT_PARAPHRASE_EXPAND_PROMPT.trim();
          break;
        case "custom":
          promptToSave = correctSettings.paraphrasePrompt;
          break;
      }
    }

    // Create updated settings object
    const updatedSettings: CorrectSettings = {
      ...correctSettings,
      withShorten: withShortenValue,
      paraphrasePrompt: promptToSave,
      model: correctSettings.model,
    };

    const result = await window.electronAPI.setCorrectSettings(updatedSettings);

    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else {
      setStatus("Error saving settings");
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="flex flex-col gap-4"
    >
      <fieldset className="flex flex-col gap-4">
        <legend className="sr-only">Correction Settings</legend>

        {/* Model Selection */}
        <ModelSelect
          featureId="settingsCorrect"
          useFeatureModel={true}
          onChange={(modelId) =>
            setCorrectSettings({
              ...correctSettings,
              model: modelId,
            })
          }
        />

        <div className="flex flex-col gap-4 my-4">
          <label htmlFor="user-input" className="text-gray-300 text-sm">
            Custom System Prompt
            <span className="text-xs text-gray-400 ml-2">
              (Override default system prompt)
            </span>
          </label>

          <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
            <span>Default System Prompt</span>
            <Tooltip
              tooltipText={DEFAULT_CUSTOM_PROMPT}
              width="w-96"
              maxHeight="max-h-80"
            />
            <button
              type="button"
              className="text-blue-400 hover:text-blue-300"
              onClick={() =>
                setCorrectSettings({
                  ...correctSettings,
                  userInput: DEFAULT_CUSTOM_PROMPT.trim(),
                })
              }
              title="Use default system prompt as template"
            >
              Use as Template
            </button>
          </div>

          <textarea
            id="user-input"
            value={correctSettings.userInput}
            onChange={(e) =>
              setCorrectSettings({
                ...correctSettings,
                userInput: e.target.value,
              })
            }
            className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 min-h-20 text-sm"
            placeholder="Enter custom system prompt to override the default one"
            rows={4}
            aria-label="Custom system prompt"
          />
        </div>

        <div className="flex items-center gap-2 mt-2">
          <label className="inline-flex items-center text-gray-300">
            <input
              type="checkbox"
              checked={correctSettings.paraphrase}
              onChange={() =>
                setCorrectSettings({
                  ...correctSettings,
                  paraphrase: !correctSettings.paraphrase,
                })
              }
              className="form-checkbox h-4 w-4 text-blue-500"
            />
            <span className="mx-2">
              Paraphrase
              <span className="text-xs text-gray-400 ml-1">
                (Try to rewrite the text in a different way)
              </span>
            </span>
          </label>
        </div>

        {correctSettings.paraphrase && (
          <fieldset className="ml-6 flex flex-col gap-4 border border-gray-700 p-4">
            <legend>Paraphrase Options</legend>

            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2">
                <label className="inline-flex items-center text-gray-300">
                  <input
                    type="radio"
                    name="paraphraseMode"
                    checked={paraphraseMode === "same-length"}
                    onChange={() => setParaphraseMode("same-length")}
                    className="form-radio h-4 w-4 text-blue-500"
                  />
                  <span className="mx-2">Same Length</span>
                  <Tooltip
                    tooltipText={DEFAULT_PARAPHRASE_SAME_LENGTH_PROMPT}
                  />
                </label>

                <label className="inline-flex items-center text-gray-300">
                  <input
                    type="radio"
                    name="paraphraseMode"
                    checked={paraphraseMode === "shorten"}
                    onChange={() => setParaphraseMode("shorten")}
                    className="form-radio h-4 w-4 text-blue-500"
                  />
                  <span className="mx-2">Shorten</span>
                  <Tooltip tooltipText={DEFAULT_PARAPHRASE_SHORTEN_PROMPT} />
                </label>

                <label className="inline-flex items-center text-gray-300">
                  <input
                    type="radio"
                    name="paraphraseMode"
                    checked={paraphraseMode === "expand"}
                    onChange={() => setParaphraseMode("expand")}
                    className="form-radio h-4 w-4 text-blue-500"
                  />
                  <span className="mx-2">Expand</span>
                  <Tooltip tooltipText={DEFAULT_PARAPHRASE_EXPAND_PROMPT} />
                </label>

                <label className="inline-flex items-center text-gray-300">
                  <input
                    type="radio"
                    name="paraphraseMode"
                    checked={paraphraseMode === "custom"}
                    onChange={() => setParaphraseMode("custom")}
                    className="form-radio h-4 w-4 text-blue-500"
                  />
                  <span className="mx-2">Custom</span>
                </label>
              </div>
            </div>

            {paraphraseMode === "custom" && (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="custom-prompt"
                  className="text-gray-300 text-sm"
                >
                  Custom Paraphrase Prompt
                  <span className="text-xs text-gray-400 ml-2">
                    (Define how you want your text to be modified)
                  </span>
                </label>

                <div className="flex flex-col gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>Default Prompt Template</span>
                    <Tooltip tooltipText={DEFAULT_CUSTOM_PROMPT} />
                    <button
                      type="button"
                      className="text-blue-400 hover:text-blue-300"
                      onClick={() =>
                        setCorrectSettings({
                          ...correctSettings,
                          paraphrasePrompt: DEFAULT_CUSTOM_PROMPT.trim(),
                        })
                      }
                      title="Use default prompt template"
                    >
                      Use as Template
                    </button>
                  </div>
                </div>

                <textarea
                  id="custom-prompt"
                  value={correctSettings.paraphrasePrompt}
                  onChange={(e) =>
                    setCorrectSettings({
                      ...correctSettings,
                      paraphrasePrompt: e.target.value,
                    })
                  }
                  className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 min-h-20 text-sm"
                  placeholder="Enter your custom instructions for paraphrasing"
                  rows={4}
                  aria-label="Custom paraphrase prompt"
                />
              </div>
            )}
          </fieldset>
        )}
      </fieldset>

      <div className="flex items-center gap-2 mt-4">
        <button
          type="submit"
          className="px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 w-full"
        >
          {status || "Save"}
        </button>
      </div>
    </form>
  );
};
