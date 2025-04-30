import { format } from "date-fns";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import Select from "react-select";
import { twJoin } from "tailwind-merge";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import type { Model } from "~/main/ai.request";

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
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] =
    useState<string>(DEFAULT_OPENAI_MODEL);
  // Store the currently saved feature-specific model to detect changes and enable reset
  const [savedFeatureModel, setSavedFeatureModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string>("");

  const fetchModels = useCallback(async (refetch = false) => {
    setModelsLoading(true);
    setModelsError("");
    try {
      if (!window.electronAPI?.fetchAIModels) {
        setModelsError("electronAPI.fetchAIModels not available");
        setModelsLoading(false);
        return;
      }
      const result = await window.electronAPI.fetchAIModels(refetch);
      if (result.success && result.models) {
        setModels(result.models);
      } else {
        setModelsError(result.error || "Failed to fetch models");
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadModelSetting = useCallback(async () => {
    try {
      if (useFeatureModel && featureId && window.electronAPI?.getFeatureModel) {
        // Get feature-specific model if this is a feature model selector
        const featureModel =
          await window.electronAPI.getFeatureModel(featureId);
        if (featureModel) {
          setSelectedModel(featureModel);
          setSavedFeatureModel(featureModel);
          console.log(`Loaded feature model for ${featureId}: ${featureModel}`);
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
  }, [featureId, useFeatureModel]);

  const handleModelChange = async (value: string) => {
    setSelectedModel(value);

    // Notify parent component of the change if a callback is provided
    if (onChange) {
      onChange(value);
    }

    try {
      if (useFeatureModel && featureId && window.electronAPI?.setFeatureModel) {
        // If this is a feature-specific model selector, save to that feature
        if (saveOnChange) {
          await window.electronAPI.setFeatureModel(featureId, value);
          console.log(
            `Feature-specific model for ${featureId} set to: ${value}`
          );
        }
      } else if (window.electronAPI?.setSelectedModel) {
        // Otherwise save as the default model
        await window.electronAPI.setSelectedModel(value);
        console.log(`Default model set to: ${value}`);
      }
    } catch (err) {
      console.error("ModelSelect: Failed to persist model setting", err);
    }
  };

  useEffect(() => {
    fetchModels();
    loadModelSetting();
  }, [featureId, useFeatureModel, fetchModels, loadModelSetting]);

  const options = useMemo(
    () =>
      models.map((model) => {
        const createdAt = format(new Date(model.created * 1000), "yyyy-MM-dd");
        const modelId = model.id;
        const pricingPerMillionToken = (
          +model.pricing.prompt * 1_000_000
        ).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
        });
        return {
          value: model.id,
          label: `${modelId}, ${createdAt}, ${pricingPerMillionToken} / 1M tokens`,
        };
      }),
    [models]
  );

  return (
    <div className="mb-4">
      <label
        htmlFor="model-select"
        className="block text-sm font-medium text-gray-300 mb-1"
      >
        AI Model
      </label>
      <div className="flex gap-2 items-center">
        <Select
          id="model-select"
          inputId="model-input"
          className="w-full"
          aria-label="Select OpenAI Model"
          value={
            models.length > 0
              ? { value: selectedModel, label: selectedModel }
              : null
          }
          onChange={(option) => option && handleModelChange(option.value)}
          options={options}
          isDisabled={modelsLoading || !!modelsError}
          placeholder={modelsLoading ? "Loading models..." : "Select model"}
          noOptionsMessage={() => "No models found"}
          styles={{
            control: (base) => ({
              ...base,
              backgroundColor: "rgb(55, 65, 81)", // bg-gray-700
              borderColor: "rgb(75, 85, 99)", // border-gray-600
              "&:hover": {
                borderColor: "rgb(107, 114, 128)", // border-gray-500
              },
              boxShadow: "none",
            }),
            menu: (base) => ({
              ...base,
              backgroundColor: "rgb(55, 65, 81)", // bg-gray-700
              zIndex: 10,
              borderRadius: "8px",
            }),
            singleValue: (base) => ({
              ...base,
              color: "rgb(243, 244, 246)", // text-gray-100
            }),
            input: (base) => ({
              ...base,
              color: "rgb(243, 244, 246)", // text-gray-100
            }),
          }}
          components={{
            Option: ({ data, isFocused, isSelected, innerProps }) => {
              const { label } = data;
              const [modelId, createdAt, pricingPerMillionToken] = label
                .trim()
                .split(",");

              return (
                <p
                  className={twJoin(
                    "flex gap-2 px-4 py-1 text-white cursor-pointer",
                    isSelected ? "bg-blue-500" : isFocused ? "bg-gray-600" : ""
                  )}
                  title={label}
                  {...innerProps}
                >
                  <span className="truncate">{modelId}</span>
                  <span
                    className={twJoin(
                      "text-xs text-white rounded px-2 py-1",
                      isFocused || isSelected ? "bg-gray-800" : "bg-gray-600"
                    )}
                  >
                    {createdAt}
                  </span>
                  <span
                    className={twJoin(
                      "text-xs text-white rounded px-2 py-1",
                      isFocused || isSelected ? "bg-gray-800" : "bg-gray-600"
                    )}
                  >
                    {pricingPerMillionToken}
                  </span>
                </p>
              );
            },
          }}
        />
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
