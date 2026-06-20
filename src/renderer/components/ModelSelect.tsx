import { format } from "date-fns";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { twJoin } from "tailwind-merge";
import { DEFAULT_OPENAI_MODEL } from "~/const";
import { Select } from "./Select";
import SettingsButton from "./SettingsIcon";
import type { Model } from "~/stores/apiStore";

// Define the extended option type for the select component
type ModelSelectOption = {
  value: string;
  label: string;
  isLocal: boolean;
  modelSize?: number;
};

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
  showAdditionalInfo?: boolean;
  selectedModelId?: string;
  persistSelection?: boolean;
}> = ({
  onChange,
  featureId,
  useFeatureModel = false,
  saveOnChange = false,
  showAdditionalInfo = true,
  selectedModelId,
  persistSelection = true,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  console.log(`🚀 \n - selectedModel:`, selectedModel);
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

    if (!persistSelection) {
      return;
    }

    try {
      if (useFeatureModel && featureId && window.electronAPI?.setFeatureModel) {
        // If this is a feature-specific model selector, save to that feature
        if (saveOnChange) {
          await window.electronAPI.setFeatureModel(featureId, value);
          console.log(
            `Feature-specific model for ${featureId} set to: ${value}`,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchModels();
    if (selectedModelId) {
      setSelectedModel(selectedModelId);
      return;
    }

    loadModelSetting();
  }, [
    featureId,
    useFeatureModel,
    fetchModels,
    loadModelSetting,
    selectedModelId,
  ]);

  useEffect(() => {
    if (selectedModelId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedModel(selectedModelId);
    }
  }, [selectedModelId]);

  const modelOptions = useMemo<ModelSelectOption[]>(
    () =>
      models.map((model) => {
        // Handle both Unix seconds and milliseconds timestamps
        const normalizeTimestamp = (timestamp: number) => {
          // Check if this is likely seconds (10 digits) vs milliseconds (13 digits)
          // Unix timestamps in seconds typically have 10 digits (until around year 2286)
          const isLikelySeconds = Math.floor(Math.log10(timestamp) + 1) <= 10;
          return isLikelySeconds ? timestamp * 1000 : timestamp;
        };
        const createdAt = format(
          new Date(normalizeTimestamp(model.created)),
          "yyyy-MM-dd",
        );
        const modelId = model.id;

        // Check if this is a local model
        const isLocalModel = model.local !== undefined;
        if (!showAdditionalInfo) {
          return {
            value: modelId,
            isLocal: isLocalModel,
            label: modelId,
            modelSize: model.local?.size,
          };
        }

        let label: string;

        if (isLocalModel) {
          // Format for local models - show size if available
          const modelSize = model.local?.size ? `${model.local.size}B` : "";
          label = `${modelId}, ${createdAt}, ${modelSize || "Local LLM"}`;
        } else {
          // Format for cloud models - show pricing
          const pricingPerMillionToken = (
            +(model.pricing?.prompt || 0) * 1_000_000
          ).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
          });
          label = `${modelId}, ${createdAt}, ${pricingPerMillionToken} / 1M tokens`;
        }
        return {
          value: model.id,
          label,
          isLocal: isLocalModel,
          modelSize: model.local?.size,
        };
      }),
    [models, showAdditionalInfo],
  );

  return (
    <div className="mb-4">
      <label
        htmlFor="model-select"
        className="block text-sm font-medium text-label-secondary mb-1"
      >
        AI Model
      </label>
      <div className="flex gap-2 items-center">
        <Select<ModelSelectOption>
          id="model-select"
          inputId="model-input"
          className="w-full"
          aria-label="Select OpenAI Model"
          value={
            models.length > 0 && selectedModel
              ? modelOptions.find((option) => option.value === selectedModel) ||
                null
              : null
          }
          onChange={(option) => option && handleModelChange(option.value)}
          options={modelOptions}
          isDisabled={modelsLoading || !!modelsError}
          placeholder={modelsLoading ? "Loading models..." : "Select model"}
          noOptionsMessage={() => "No models found"}
          components={{
            Option: ({ data, isFocused, isSelected, innerProps }) => {
              const { label, isLocal } = data;
              const [modelId, createdAt, thirdPart] = label.trim().split(",");

              return (
                <p
                  className={twJoin(
                    "flex gap-2 px-[0.615rem] py-[0.307rem] text-label-primary cursor-default",
                    isSelected
                      ? "bg-accent"
                      : isFocused
                        ? "bg-control-hover"
                        : "",
                  )}
                  title={label}
                  {...innerProps}
                >
                  <span className="truncate">{modelId}</span>
                  <span
                    className={twJoin(
                      "text-xs text-label-secondary rounded px-[0.461rem] py-[0.307rem]",
                      isFocused || isSelected
                        ? "bg-black/20"
                        : "bg-black/10",
                    )}
                  >
                    {createdAt}
                  </span>
                  {/* Display different third part based on model type */}
                  <span
                    className={twJoin(
                      "text-xs rounded px-[0.461rem] py-[0.307rem]",
                      isLocal
                        ? "text-green-400 bg-green-900/40"
                        : twJoin(
                            "text-label-secondary",
                            isFocused || isSelected
                              ? "bg-black/20"
                              : "bg-black/10",
                          ),
                    )}
                  >
                    {isLocal ? (
                      <>
                        <span
                          className="inline-block w-[0.615rem] h-[0.615rem] rounded-full bg-green-400 mr-[0.307rem]"
                          title="Local model"
                        />
                        {thirdPart}
                      </>
                    ) : (
                      thirdPart
                    )}
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
          className="px-[0.615rem] py-[0.307rem] bg-accent text-label-primary rounded hover:bg-accent-hover focus:outline-none"
          onClick={() => fetchModels(true)}
          disabled={modelsLoading}
        >
          &#x21bb;
        </button>

        {/* Add button to manage local models if any exist */}
        {models.find((model) => model.local !== undefined) && (
          <SettingsButton
            title="Manage local models"
            iconClassName="stroke-green-500"
            onClick={() => {
              if (window.electronAPI?.openModelManager) {
                window.electronAPI.openModelManager();
              } else {
                alert("Model management is not available yet");
              }
            }}
          />
        )}

        {/* Add reset button for feature-specific models */}
        {useFeatureModel && featureId && (
          <button
            type="button"
            aria-label="Reset to default model"
            title="Reset to default model"
            className="px-[0.615rem] py-[0.307rem] bg-control text-label-secondary rounded border border-separator hover:bg-control-hover focus:outline-none"
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
      <p className="text-xs text-label-tertiary mt-1">
        {useFeatureModel
          ? "Feature-specific model that overrides the default. Leave unchanged to use the default model."
          : "Default model used for all OpenAI requests unless overridden by feature settings."}
      </p>
    </div>
  );
};
