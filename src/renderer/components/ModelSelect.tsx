import { format as formatDateFns } from "date-fns";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { components as reactSelectComponents } from "react-select";
import { twJoin } from "tailwind-merge";
import { messageLabel, textLabel, type Label } from "~/shared/i18n/message";
// A VALUE import, and deliberately from `~/shared/providers` — importing it
// from `~/stores/apiStore`'s re-export shim would pull `electron-store` into
// the renderer bundle (finding F9). `bun run test` would not catch that;
// `bun run build` would.
import { isProviderId } from "~/shared/providers";
import {
  buildModelOptionGroups,
  findOption,
  modelOptionText,
  resolveModelSelectCopy,
  withInheritOption,
  withUnavailableOption,
  type ModelOption,
  type ModelOptionGroup,
} from "./modelSelectOptions";
import { SearchableSelect } from "./SearchableSelect";
import SettingsButton from "./SettingsIcon";
import { useI18n } from "../i18n/useI18n";
import type { GroupBase, GroupHeadingProps } from "react-select";
import type { TranslationKey } from "~/shared/i18n/keys";
// Types only — provider *values* are imported from `~/shared/providers`
// (see `modelSelectOptions.ts`); `~/stores/apiStore` builds an
// `electron-store` at import and must never enter the renderer bundle (F9).
import type { Model, ProviderId } from "~/stores/apiStore";

/** Stable identity so an errorless fetch does not invalidate the option memo. */
const NO_PROVIDER_ERRORS: Partial<Record<ProviderId, string>> = Object.freeze({});

/**
 * Shared model picker. Options are grouped by provider, with the provider
 * name in the group heading and nowhere else.
 *
 * Every model picker in the app is this component — the tray, the Models
 * dashboard, the correction presets, PromptGen and Settings → General. That
 * is deliberate: grouping, the "no longer available" option and the inherit
 * option have to reach every picker at once, or two implementations drift.
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
  /**
   * Override the field label. Settings → General is the profile's "Default
   * model" section rather than a generic "AI Model" picker; every other call
   * site leaves this alone. The default is pinned by
   * `resolveModelSelectCopy`'s test.
   */
  labelKey?: TranslationKey;
  /** Override the helper text below the control. Same rationale as `labelKey`. */
  descriptionKey?: TranslationKey;
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
  labelKey,
  descriptionKey,
}) => {
  const { t, tl, formatCurrency, dateFnsLocale } = useI18n();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  /**
   * The profile-wide default, used only to show *which* model the inherit row
   * currently resolves to. Never the control's own value.
   */
  const [globalDefaultModel, setGlobalDefaultModel] = useState<string>("");
  /**
   * Providers in `enabledProviders`. `undefined` means "not known yet" (or no
   * bridge), which renders every provider rather than an empty picker.
   */
  const [connectedProviders, setConnectedProviders] = useState<
    ProviderId[] | undefined
  >(undefined);
  const [providerErrors, setProviderErrors] =
    useState<Partial<Record<ProviderId, string>>>(NO_PROVIDER_ERRORS);
  // Store the currently saved feature-specific model to detect changes and enable reset
  const [savedFeatureModel, setSavedFeatureModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState<boolean>(false);
  // Holds a locale-free descriptor (never rendered prose) so `fetchModels`
  // does not need to close over `t` — see the `fetchModels` comment below.
  const [modelsError, setModelsError] = useState<Label | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number | undefined>(undefined);

  const copy = resolveModelSelectCopy({ labelKey, descriptionKey, useFeatureModel });

  /**
   * Only a picker that can *inherit* gets the inherit row. The global default
   * picker cannot inherit from itself, so offering it there would let a user
   * store "use the default" as the default.
   */
  const offersInherit = selectedModelId !== undefined || useFeatureModel;

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
  // finding this fixes. `result.error` is already a `Label` built by main
  // (raw `textLabel` passthrough for provider/exception text, `messageLabel`
  // for app-authored validation copy) — the catalog fallback below only
  // covers a missing/malformed `error` field.
  //
  // `result.errors` is per provider and must be read separately: a successful
  // call with a populated `errors` map means SOME group is stale, not that
  // everything refreshed.
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
        setProviderErrors(result.errors ?? NO_PROVIDER_ERRORS);
      } else {
        setModelsError(result.error ?? messageLabel("models.select.error.fetchFailed"));
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

  /**
   * Which providers are connected, in one round-trip. Replaces the old
   * single-active-provider badge: there is no single active provider now,
   * every connected one serves models at once.
   */
  const loadProviderStates = useCallback(async () => {
    try {
      const states = await window.electronAPI?.getProviderStates?.();
      if (!states) return;
      // Filtered through the real guard rather than cast: these keys come
      // from main's response, and an unrecognized one would otherwise be
      // handed to `PROVIDER_LABEL_KEYS` as if it were a provider id.
      setConnectedProviders(
        Object.keys(states)
          .filter(isProviderId)
          .filter((provider) => states[provider].connected),
      );
    } catch (err) {
      console.error("ModelSelect: Error loading provider states:", err);
    }
  }, []);

  const loadModelSetting = useCallback(async () => {
    try {
      const globalDefault =
        (await window.electronAPI?.getSelectedModel?.()) || "";
      setGlobalDefaultModel(globalDefault);

      // Parent-controlled (a preset): the parent owns the value, we only
      // needed the global default above to describe what inherit means.
      if (selectedModelId !== undefined) return;

      if (useFeatureModel && featureId && window.electronAPI?.getFeatureModel) {
        const featureModel = await window.electronAPI.getFeatureModel(featureId);
        setSelectedModel(featureModel || "");
        setSavedFeatureModel(featureModel || "");
        return;
      }
      setSelectedModel(globalDefault);
    } catch (err) {
      console.error("Error loading model settings:", err);
    }
  }, [featureId, useFeatureModel, selectedModelId]);

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
    loadProviderStates();
    loadModelSetting();
  }, [fetchModels, loadProviderStates, loadModelSetting]);

  // Cross-window sync: a connect/disconnect/model change applied from any
  // window (Main, Tray, PromptGen, …) broadcasts 'settings-updated'. Refetch
  // models and provider states here so every ModelSelect instance reflects
  // the change immediately, without a manual remount.
  useEffect(() => {
    const off = window.electronAPI?.onSettingsUpdated?.(() => {
      fetchModels(true);
      loadProviderStates();
      loadModelSetting();
    });
    return () => off?.();
  }, [fetchModels, loadProviderStates, loadModelSetting]);

  useEffect(() => {
    // Controlled by the parent when provided, INCLUDING the empty "inherit"
    // sentinel — which `withInheritOption` gives a real `value: ""` option, so
    // it renders as "Use global default" instead of a blank control.
    if (selectedModelId !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedModel(selectedModelId);
    }
  }, [selectedModelId]);

  const optionGroups = useMemo<ModelOptionGroup[]>(() => {
    const grouped = buildModelOptionGroups(models, {
      showAdditionalInfo,
      errors: providerErrors,
      enabledProviders: connectedProviders,
      t,
      formatCurrency,
    });
    // Unavailable first, then inherit: the unavailable probe must not see the
    // inherit row (a stored `""` is inherit, never "no longer available").
    const withUnavailable = withUnavailableOption(grouped, selectedModel, t);
    return offersInherit
      ? withInheritOption(withUnavailable, globalDefaultModel)
      : withUnavailable;
    // `t` and `formatCurrency` are recreated when the interface locale changes
    // (see `useI18n`/`I18nProvider`) — omitting them would leave already-built
    // group headings and price badges in the old language after a switch.
  }, [
    models,
    showAdditionalInfo,
    providerErrors,
    connectedProviders,
    selectedModel,
    offersInherit,
    globalDefaultModel,
    t,
    formatCurrency,
  ]);

  const selectedOption = findOption(optionGroups, selectedModel);
  const hasNoConnectedProviders =
    connectedProviders !== undefined && connectedProviders.length === 0;

  return (
    <div className={compact ? "mb-0" : "mb-4"}>
      {!compact && (
      <label
        htmlFor="model-select"
        className="mb-1 flex items-center gap-2 text-sm font-medium text-card-foreground"
      >
        {t(copy.labelKey)}
      </label>
      )}
      <div ref={containerRef} className="flex gap-2 items-center">
        <SearchableSelect<ModelOption>
          id="model-select"
          inputId="model-input"
          className="w-full"
          ariaLabel={t("models.select.ariaLabel")}
          value={selectedOption}
          onChange={(option) => option && handleModelChange(option.value)}
          options={optionGroups}
          isDisabled={modelsLoading || !!modelsError}
          placeholder={
            modelsLoading
              ? t("models.select.loading")
              : hasNoConnectedProviders
                ? t("models.select.placeholder.noProviders")
                : t("models.select.placeholder")
          }
          noOptionsMessage={t("models.select.noOptions")}
          menuPortal={menuPortal}
          menuMaxHeight={menuMaxHeight}
          menuWidth={menuWidth}
          components={{
            // The provider name lives HERE and only here (D31). An option row
            // never names its provider — that is what made the old
            // comma-joined label unreadable once groups existed.
            GroupHeading: (
              props: GroupHeadingProps<ModelOption, false, GroupBase<ModelOption>>,
            ) => {
              // `GroupBase` only declares `label`/`options`; the per-provider
              // `error` is ours. Narrowing to the group type we actually build
              // is safe because `options` is always a `ModelOptionGroup[]`.
              const group = props.data as ModelOptionGroup;
              if (!group.label && !group.error) return null;
              return (
                <div className="px-3 pt-2 pb-1">
                  {group.label ? (
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </span>
                  ) : null}
                  {group.error ? (
                    <span className="block text-[11px] text-destructive" role="alert">
                      {group.error}
                    </span>
                  ) : null}
                </div>
              );
            },
            // Wraps react-select's own SingleValue so the control keeps its
            // grid placement and `styles.singleValue`, while the TEXT comes
            // from `modelOptionText`. Without this, an inherit selection
            // (`label: ""`) renders as a blank control and an unavailable one
            // renders as a bare id with no hint that it is gone.
            SingleValue: (props) => (
              <reactSelectComponents.SingleValue {...props}>
                {modelOptionText(props.data, t)}
              </reactSelectComponents.SingleValue>
            ),
            Option: ({ data, isFocused, isSelected, innerProps }) => {
              const text = modelOptionText(data, t);

              if (data.isDisabled) {
                return (
                  <p
                    className="px-4 py-1.5 text-xs italic text-muted-foreground"
                    title={text}
                    {...innerProps}
                  >
                    {text}
                  </p>
                );
              }

              if (!showAdditionalInfo || data.kind !== "model") {
                return (
                  <p
                    className={twJoin(
                      "px-4 py-1.5 text-foreground cursor-pointer truncate",
                      isSelected ? "bg-primary" : isFocused ? "bg-secondary" : "",
                    )}
                    title={text}
                    {...innerProps}
                  >
                    {text}
                  </p>
                );
              }

              // `date-fns` needs the locale passed explicitly — it does not
              // read one from the i18n context (see the fixlang-i18n skill).
              const createdAt =
                data.createdAt === null
                  ? null
                  : formatDateFns(new Date(data.createdAt), "yyyy-MM-dd", {
                      locale: dateFnsLocale,
                    });

              return (
                <p
                  className={twJoin(
                    "flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-foreground cursor-pointer",
                    isSelected ? "bg-primary" : isFocused ? "bg-secondary" : "",
                  )}
                  title={text}
                  {...innerProps}
                >
                  <span className={twJoin(compact ? "min-w-0 break-all" : "truncate min-w-0")}>
                    {text}
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
                  {data.detail ? (
                    <span
                      className={twJoin(
                        "shrink-0 text-xs text-foreground rounded px-2 py-1",
                        data.isLocal
                          ? "bg-success"
                          : isFocused || isSelected
                            ? "bg-card"
                            : "bg-secondary",
                      )}
                    >
                      {data.isLocal ? (
                        <>
                          <span
                            className="inline-block w-2 h-2 rounded-full bg-success mr-1"
                            title={t("models.select.localModelTitle")}
                          />
                          {data.detail}
                        </>
                      ) : (
                        data.detail
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
                  // Empty string is the inherit sentinel — the feature falls
                  // back to the profile default. It is NOT a model id, so
                  // there is no hardcoded fallback id to substitute here.
                  await window.electronAPI.setFeatureModel(featureId, "");
                  setSavedFeatureModel("");
                  setSelectedModel("");
                  if (onChange) onChange("");
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
        {t(copy.descriptionKey)}
      </p>
      )}
    </div>
  );
};
