import { format } from "date-fns";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Select from "react-select";
import { twJoin } from "tailwind-merge";
import {
  DEFAULT_OPENAI_MODEL,
  normalizeForSearch,
  resolveDefaultOpenAIModel,
} from "~/const";
import SettingsButton from "./SettingsIcon";
import type { Model, ProviderId } from "~/stores/apiStore";

// Define the extended option type for the select component
type ModelSelectOption = {
  value: string;
  label: string;
  isLocal: boolean;
  modelSize?: number;
};

const PROVIDER_BADGE_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
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
  menuPortal?: boolean;
  compact?: boolean;
  menuMaxHeight?: number;
}> = ({
  onChange,
  featureId,
  useFeatureModel = false,
  saveOnChange = false,
  showAdditionalInfo = true,
  selectedModelId,
  persistSelection = true,
  menuPortal = false,
  compact = false,
  menuMaxHeight,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  // Store the currently saved feature-specific model to detect changes and enable reset
  const [savedFeatureModel, setSavedFeatureModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  const [modelsError, setModelsError] = useState<string>("");

  const containerRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);


  useEffect(() => {
    if (!menuPortal || !containerRef.current) {
      return;
    }
    const node = containerRef.current;
    const updateWidth = (): void => {
      setMenuWidth(node.offsetWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [menuPortal]);

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

  const loadActiveProvider = useCallback(async () => {
    try {
      const provider = await window.electronAPI?.getActiveProvider?.();
      if (provider) setActiveProvider(provider);
    } catch (err) {
      console.error("ModelSelect: Error loading active provider:", err);
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
    loadActiveProvider();
    if (selectedModelId) {
      setSelectedModel(selectedModelId);
      return;
    }

    loadModelSetting();
  }, [
    featureId,
    useFeatureModel,
    fetchModels,
    loadActiveProvider,
    loadModelSetting,
    selectedModelId,
  ]);

  // Cross-window sync: a provider/model change applied from any window (Main,
  // Tray, PromptGen, …) broadcasts 'settings-updated'. Refetch models and the
  // active-provider label here so every ModelSelect instance reflects the
  // switch immediately, without a manual remount.
  useEffect(() => {
    const off = window.electronAPI?.onSettingsUpdated?.(() => {
      fetchModels(true);
      loadActiveProvider();
    });
    return () => off?.();
  }, [fetchModels, loadActiveProvider]);

  useEffect(() => {
    // Controlled by the parent when provided (including the empty "inherit"
    // sentinel). Empty is then resolved to the dynamic default by the effect
    // below, so an inheriting preset shows the global model.
    if (selectedModelId !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedModel(selectedModelId);
    }
  }, [selectedModelId]);

  // Keep the displayed model valid. When the parent does not pin a model
  // (e.g. the General selector) and the current selection is empty or absent
  // from the fetched list (stale/unknown id, different provider), fall back to
  // the dynamic default (latest GPT mini) from the actual fetched list. This
  // prevents the selector rendering empty while presets still show a model.
  useEffect(() => {
    if (selectedModelId || models.length === 0) {
      return;
    }
    const isValid =
      !!selectedModel && models.some((model) => model.id === selectedModel);
    if (!isValid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedModel(resolveDefaultOpenAIModel(models));
    }
  }, [models, selectedModel, selectedModelId]);

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
    <div className={compact ? "mb-0" : "mb-4"}>
      {!compact && (
      <label
        htmlFor="model-select"
        className="mb-1 flex items-center gap-2 text-sm font-medium text-card-foreground"
      >
        AI Model
        {activeProvider && (
          <span
            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground"
            title="Active provider"
          >
            {PROVIDER_BADGE_LABELS[activeProvider]}
          </span>
        )}
      </label>
      )}
      <div ref={containerRef} className="flex gap-2 items-center">
        <Select
          id="model-select"
          inputId="model-input"
          className="w-full"
          aria-label="Select AI Model"
          value={
            models.length > 0 && selectedModel
              ? modelOptions.find((option) => option.value === selectedModel) ||
                null
              : null
          }
          onChange={(option) => option && handleModelChange(option.value)}
          options={modelOptions}
          filterOption={(option, rawInput) => {
            // Flexible match: normalize both sides (lowercase + strip every
            // non-alphanumeric char) so "gpt 5" matches "openai/gpt-5".
            const query = normalizeForSearch(rawInput);
            if (!query) return true;
            const haystack = normalizeForSearch(
              `${option.value} ${option.label}`,
            );
            return haystack.includes(query);
          }}
          isDisabled={modelsLoading || !!modelsError}
          placeholder={modelsLoading ? "Loading models..." : "Select model"}
          noOptionsMessage={() => "No models found"}
          menuPortalTarget={menuPortal ? document.body : undefined}
          menuPosition={menuPortal ? "fixed" : "absolute"}
          menuShouldScrollIntoView={false}
          maxMenuHeight={menuPortal ? menuMaxHeight ?? 200 : undefined}
          styles={{
            control: (base) => ({
              ...base,
              backgroundColor: "var(--input)",
              borderColor: "var(--border)",
              "&:hover": {
                borderColor: "var(--ring)",
              },
              boxShadow: "none",
            }),
            menu: (base) => ({
              ...base,
              backgroundColor: "var(--popover)",
              zIndex: menuPortal ? 9999 : 10,
              borderRadius: "8px",
              ...(menuPortal && menuWidth
                ? { width: menuWidth, minWidth: menuWidth }
                : {}),
            }),
            menuList: (base) => ({
              ...base,
              maxHeight: menuPortal ? menuMaxHeight ?? 200 : base.maxHeight,
              overflowY: "auto",
            }),
            singleValue: (base) => ({
              ...base,
              color: "var(--foreground)",
            }),
            input: (base) => ({
              ...base,
              color: "var(--foreground)",
            }),
          }}
          components={{
            Option: ({ data, isFocused, isSelected, innerProps }) => {
              const typedData = data as ModelSelectOption;
              const { label, isLocal } = typedData;
              const parts = label.split(",").map((part) => part.trim());
              const modelId = parts[0] ?? label;
              const createdAt = parts[1];
              const thirdPart = parts[2];

              if (!showAdditionalInfo || parts.length === 1) {
                return (
                  <p
                    className={twJoin(
                      "px-4 py-1.5 text-foreground cursor-pointer truncate",
                      isSelected
                        ? "bg-primary"
                        : isFocused
                          ? "bg-secondary"
                          : "",
                    )}
                    title={label}
                    {...innerProps}
                  >
                    {modelId}
                  </p>
                );
              }

              return (
                <p
                  className={twJoin(
                    "flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-foreground cursor-pointer",
                    isSelected ? "bg-primary" : isFocused ? "bg-secondary" : "",
                  )}
                  title={label}
                  {...innerProps}
                >
                  <span className={twJoin(compact ? "min-w-0 break-all" : "truncate min-w-0")}>
                    {modelId}
                  </span>
                  {createdAt ? (
                    <span
                      className={twJoin(
                        "shrink-0 text-xs text-foreground rounded px-2 py-1",
                        isFocused || isSelected ? "bg-card" : "bg-secondary",
                      )}
                    >
                      {createdAt}
                    </span>
                  ) : null}
                  {thirdPart ? (
                    <span
                      className={twJoin(
                        "shrink-0 text-xs text-foreground rounded px-2 py-1",
                        isLocal
                          ? isFocused || isSelected
                            ? "bg-success"
                            : "bg-success"
                          : isFocused || isSelected
                            ? "bg-card"
                            : "bg-secondary",
                      )}
                    >
                      {isLocal ? (
                        <>
                          <span
                            className="inline-block w-2 h-2 rounded-full bg-success mr-1"
                            title="Local model"
                          />
                          {thirdPart}
                        </>
                      ) : (
                        thirdPart
                      )}
                    </span>
                  ) : null}
                </p>
              );
            },
          }}
        />
        <button
          type="button"
          aria-label="Refetch models"
          title="Refetch models"
          className="px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => fetchModels(true)}
          disabled={modelsLoading}
        >
          &#x21bb;
        </button>

        {/* Add button to manage local models if any exist */}
        {models.find((model) => model.local !== undefined) && (
          <SettingsButton
            title="Manage local models"
            iconClassName="stroke-success"
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
            className="px-2 py-1 bg-secondary text-secondary-foreground rounded hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
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
        <p className="text-xs text-destructive mt-1" role="alert">
          {modelsError}
        </p>
      )}
      {!compact && (
      <p className="text-xs text-muted-foreground mt-1">
        {useFeatureModel
          ? "Feature-specific model that overrides the default. Leave unchanged to use the default model."
          : "Default model used for all requests to the active provider, unless overridden by feature settings."}
      </p>
      )}
    </div>
  );
};
