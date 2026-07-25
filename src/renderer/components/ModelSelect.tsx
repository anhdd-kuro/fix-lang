import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Select from "react-select";
import { twJoin } from "tailwind-merge";
import {
  DEFAULT_OPENAI_MODEL,
  normalizeForSearch,
  resolveDefaultOpenAIModel,
} from "~/const";
import { messageLabel, textLabel, type Label } from "~/shared/i18n/message";
import { buildModelOptionLabel } from "./modelOptionLabel";
import SettingsButton from "./SettingsIcon";
import { useI18n } from "../i18n/useI18n";
import type { TranslationKey } from "~/shared/i18n/keys";
import type { Model, ProviderId } from "~/stores/apiStore";

// Define the extended option type for the select component
type ModelSelectOption = {
  value: string;
  label: string;
  isLocal: boolean;
  modelSize?: number;
};

/** Provider brand names are proper nouns (unchanged across locales) but are
 * still routed through `t()`, matching the reference conversion in
 * `SettingGeneral.tsx`. */
const PROVIDER_LABEL_KEYS: Record<ProviderId, TranslationKey> = {
  openai: "models.select.provider.openai",
  openrouter: "models.select.provider.openrouter",
  ollama: "models.select.provider.ollama",
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
  const { t, tl, formatCurrency, dateFnsLocale } = useI18n();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  // Store the currently saved feature-specific model to detect changes and enable reset
  const [savedFeatureModel, setSavedFeatureModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  // Holds a locale-free descriptor (never rendered prose) so `fetchModels`
  // does not need to close over `t` — see the `fetchModels` comment below.
  const [modelsError, setModelsError] = useState<Label | null>(null);

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

  // Stores a `Label` descriptor (never resolved prose) so this callback does
  // NOT close over `t` — `t` changes identity on every locale switch (see
  // `useI18n`/`I18nProvider`), and this callback is itself a dependency of
  // the mount effect and the `onSettingsUpdated` subscription effect below.
  // Closing over `t` would force switching languages to re-run
  // `fetchAIModels()` for every mounted `<ModelSelect>` (including the
  // always-mounted tray instance) and to tear down/re-register that IPC
  // listener on every switch — see spec.i18n-dashboard.md and the review
  // finding this fixes. `result.error` is raw text from the main process
  // (not translatable) and is wrapped as a `textLabel`; the two `t()`-backed
  // fallbacks are wrapped as `messageLabel`s and resolved via `tl()` at
  // render time instead.
  const fetchModels = useCallback(async (refetch = false) => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      if (!window.electronAPI?.fetchAIModels) {
        setModelsError(messageLabel("models.select.error.apiUnavailable"));
        setModelsLoading(false);
        return;
      }
      const result = await window.electronAPI.fetchAIModels(refetch);
      if (result.success && result.models) {
        setModels(result.models);
      } else {
        setModelsError(
          result.error
            ? textLabel(result.error)
            : messageLabel("models.select.error.fetchFailed"),
        );
      }
    } catch (err) {
      setModelsError(
        err instanceof Error
          ? textLabel(err.message)
          : messageLabel("models.select.error.unknown"),
      );
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
        }
      } else if (window.electronAPI?.getSelectedModel) {
        // Otherwise get the default model
        const defaultModel = await window.electronAPI.getSelectedModel();
        if (defaultModel) {
          setSelectedModel(defaultModel);
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
        }
      } else if (window.electronAPI?.setSelectedModel) {
        // Otherwise save as the default model
        await window.electronAPI.setSelectedModel(value);
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
        const isLocalModel = model.local !== undefined;
        if (!showAdditionalInfo) {
          return {
            value: model.id,
            isLocal: isLocalModel,
            label: model.id,
            modelSize: model.local?.size,
          };
        }

        return {
          value: model.id,
          label: buildModelOptionLabel(model, { t, formatCurrency, dateFnsLocale }),
          isLocal: isLocalModel,
          modelSize: model.local?.size,
        };
      }),
    // `t`, `formatCurrency`, and `dateFnsLocale` are all recreated when the
    // interface locale changes (see `useI18n`/`I18nProvider`) — omitting them
    // here would leave already-fetched option labels in the old language
    // after a locale switch.
    [models, showAdditionalInfo, t, formatCurrency, dateFnsLocale],
  );

  return (
    <div className={compact ? "mb-0" : "mb-4"}>
      {!compact && (
      <label
        htmlFor="model-select"
        className="mb-1 flex items-center gap-2 text-sm font-medium text-card-foreground"
      >
        {t("models.select.label")}
        {activeProvider && (
          <span
            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-secondary-foreground"
            title={t("models.select.activeProviderTitle")}
          >
            {t(PROVIDER_LABEL_KEYS[activeProvider])}
          </span>
        )}
      </label>
      )}
      <div ref={containerRef} className="flex gap-2 items-center">
        <Select
          id="model-select"
          inputId="model-input"
          className="w-full"
          aria-label={t("models.select.ariaLabel")}
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
          placeholder={modelsLoading ? t("models.select.loading") : t("models.select.placeholder")}
          noOptionsMessage={() => t("models.select.noOptions")}
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
                            title={t("models.select.localModelTitle")}
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
          aria-label={t("models.select.refetch")}
          title={t("models.select.refetch")}
          className="px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => fetchModels(true)}
          disabled={modelsLoading}
        >
          &#x21bb;
        </button>

        {/* Add button to manage local models if any exist */}
        {models.find((model) => model.local !== undefined) && (
          <SettingsButton
            title={t("models.select.manageLocal")}
            iconClassName="stroke-success"
            onClick={() => {
              if (window.electronAPI?.openModelManager) {
                window.electronAPI.openModelManager();
              } else {
                alert(t("models.select.managerUnavailable"));
              }
            }}
          />
        )}

        {/* Add reset button for feature-specific models */}
        {useFeatureModel && featureId && (
          <button
            type="button"
            aria-label={t("models.select.resetToDefault")}
            title={t("models.select.resetToDefault")}
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

                  // Notify parent of change
                  if (onChange) onChange(defaultModel || DEFAULT_OPENAI_MODEL);
                } catch (err) {
                  console.error("Error resetting to default model:", err);
                }
              }
            }}
            disabled={!savedFeatureModel} // Only enable if a feature-specific model is set
          >
            {t("models.select.resetButton")}
          </button>
        )}
      </div>
      {modelsError && (
        <p className="text-xs text-destructive mt-1" role="alert">
          {tl(modelsError)}
        </p>
      )}
      {!compact && (
      <p className="text-xs text-muted-foreground mt-1">
        {useFeatureModel
          ? t("models.select.description.feature")
          : t("models.select.description.default")}
      </p>
      )}
    </div>
  );
};
