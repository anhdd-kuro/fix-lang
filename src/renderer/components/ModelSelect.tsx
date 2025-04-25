import React, { useState, useEffect } from "react";
import { DEFAULT_OPENAI_MODEL } from "~/const";

/**
 * Shared component for OpenAI model selection with refresh.
 *
 * @param onChange - Callback when model changes
 * @param featureId - Optional feature ID for feature-specific model settings
 * @param useFeatureModel - Whether to use feature-specific model selection
 */
export const ModelSelect: React.FC<{
  onChange?: (modelId: string) => void;
  featureId?: string;
  useFeatureModel?: boolean;
  saveOnChange?: boolean;
}> = ({
  onChange,
  featureId,
  useFeatureModel = false,
  saveOnChange = false,
}) => {
  const [models, setModels] = useState<
    {
      id: string;
      object: string;
      created: number;
      owned_by: string;
    }[]
  >([]);
  const [selectedModel, setSelectedModel] =
    useState<string>(DEFAULT_OPENAI_MODEL);
  // Store the currently saved feature-specific model to detect changes and enable reset
  const [savedFeatureModel, setSavedFeatureModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string>("");

  const fetchModels = async (refetch = false) => {
    setModelsLoading(true);
    setModelsError("");
    try {
      if (!window.electronAPI?.fetchOpenAIModels) {
        setModelsError("electronAPI.fetchOpenAIModels not available");
        setModelsLoading(false);
        return;
      }
      const result = await window.electronAPI.fetchOpenAIModels(refetch);
      if (result.success) {
        setModels(result.models ?? []);
      } else {
        setModelsError(result.error || "Failed to fetch models");
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setModelsLoading(false);
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const modelId = e.target.value;
    setSelectedModel(modelId);

    // Notify parent component of the change if a callback is provided
    if (onChange) {
      onChange(modelId);
    }

    try {
      if (useFeatureModel && featureId && window.electronAPI?.setFeatureModel) {
        // If this is a feature-specific model selector, save to that feature
        if (saveOnChange) {
          await window.electronAPI.setFeatureModel(featureId, modelId);
          console.log(
            `Feature-specific model for ${featureId} set to: ${modelId}`
          );
        }
      } else if (window.electronAPI?.setSelectedModel) {
        // Otherwise save as the default model
        await window.electronAPI.setSelectedModel(modelId);
        console.log(`Default model set to: ${modelId}`);
      }
    } catch (err) {
      console.error("ModelSelect: Failed to persist model setting", err);
    }
  };

  useEffect(() => {
    fetchModels();

    const loadModelSetting = async () => {
      try {
        if (
          useFeatureModel &&
          featureId &&
          window.electronAPI?.getFeatureModel
        ) {
          // Get feature-specific model if this is a feature model selector
          const featureModel =
            await window.electronAPI.getFeatureModel(featureId);
          if (featureModel) {
            setSelectedModel(featureModel);
            setSavedFeatureModel(featureModel);
            console.log(
              `Loaded feature model for ${featureId}: ${featureModel}`
            );
          }
        } else if (window.electronAPI?.getSelectedModel) {
          // Otherwise get the default model
          const defaultModel = await window.electronAPI.getSelectedModel();
          if (defaultModel) {
            setSelectedModel(defaultModel);
            console.log(`Loaded default model: ${defaultModel}`);
          }
        }
      } catch (err) {
        console.error("Error loading model settings:", err);
      }
    };

    loadModelSetting();
  }, [featureId, useFeatureModel]);

  return (
    <div className="mb-4">
      <label
        htmlFor="model-select"
        className="block text-sm font-medium text-gray-300 mb-1"
      >
        OpenAI Model
      </label>
      <div className="flex gap-2 items-center">
        <select
          id="model-select"
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="Select OpenAI Model"
          value={models.length > 0 ? selectedModel : ""}
          onChange={handleModelChange}
          disabled={modelsLoading || !!modelsError}
        >
          {modelsLoading && <option>Loading models...</option>}
          {!modelsLoading && models.length === 0 && (
            <option>No models found</option>
          )}
          {!modelsLoading &&
            models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}{" "}
                {model.owned_by !== "openai" ? `(${model.owned_by})` : ""}
              </option>
            ))}
        </select>
        <button
          type="button"
          aria-label="Refetch models"
          title="Refetch models"
          className="px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={() => fetchModels(true)}
          disabled={modelsLoading}
        >
          &#x21bb;
        </button>

        {/* Add reset button for feature-specific models */}
        {useFeatureModel && featureId && (
          <button
            type="button"
            aria-label="Reset to default model"
            title="Reset to default model"
            className="px-2 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
            onClick={async () => {
              if (window.electronAPI?.setFeatureModel) {
                try {
                  // Set to empty string to use default model
                  await window.electronAPI.setFeatureModel(featureId, "");
                  setSavedFeatureModel("");
                  // Get the default model to display
                  const defaultModel =
                    await window.electronAPI.getSelectedModel();
                  setSelectedModel(defaultModel || DEFAULT_OPENAI_MODEL);
                  console.log(`Reset ${featureId} to use default model`);

                  // Notify parent of change
                  if (onChange) onChange(defaultModel || DEFAULT_OPENAI_MODEL);
                } catch (err) {
                  console.error("Error resetting to default model:", err);
                }
              }
            }}
            disabled={!savedFeatureModel} // Only enable if a feature-specific model is set
          >
            Reset
          </button>
        )}
      </div>
      {modelsError && (
        <p className="text-xs text-red-400 mt-1" role="alert">
          {modelsError}
        </p>
      )}
      <p className="text-xs text-gray-500 mt-1">
        {useFeatureModel
          ? "Feature-specific model that overrides the default. Leave unchanged to use the default model."
          : "Default model used for all OpenAI requests unless overridden by feature settings."}
      </p>
    </div>
  );
};
