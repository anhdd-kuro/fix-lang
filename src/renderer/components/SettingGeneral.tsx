import React, { useCallback, useEffect, useState } from "react";
import { LanguageSelect } from "./LanguageSelect";
import { useI18n } from "../i18n/useI18n";
import type { TranslationKey } from "~/shared/i18n/keys";
import type { CorrectionOutputMode } from "~/shared/outputMode";
import type { Model, ProviderId } from "~/stores/apiStore";

/** Keep value import out of apiStore — that module loads electron-store and breaks the renderer. */
const PROVIDER_IDS: readonly ProviderId[] = ["openai", "openrouter", "ollama"];

/** Provider brand names are proper nouns (unchanged across locales) but are
 * still routed through `t()` so this file has zero hardcoded UI strings —
 * the reference conversion for later migration waves. */
const PROVIDER_LABEL_KEYS: Record<ProviderId, TranslationKey> = {
  openai: "settings.general.provider.openai",
  openrouter: "settings.general.provider.openrouter",
  ollama: "settings.general.provider.ollama",
};

/**
 * General settings tab: interface language, correction output mode, plus
 * staged provider setup (select provider, supply credentials, fetch models,
 * choose a default, then Apply). The previously active provider stays in
 * effect until Apply succeeds — nothing commits on every keystroke or on
 * Fetch.
 */
export const SettingGeneral: React.FC = () => {
  const { t } = useI18n();

  const [resetStatus, setResetStatus] = useState<string>("");
  const [resetIsError, setResetIsError] = useState<boolean>(false);
  const [correctionOutputMode, setCorrectionOutputMode] =
    useState<CorrectionOutputMode>("paste");
  const [outputModeStatus, setOutputModeStatus] = useState<string>("");
  const [outputModeIsError, setOutputModeIsError] = useState<boolean>(false);
  const [savingOutputMode, setSavingOutputMode] = useState(false);

  // The provider currently staged for setup. Starts as the active provider so
  // opening General shows what is really in effect, not a stale default.
  const [stagedProvider, setStagedProvider] = useState<ProviderId>("openrouter");

  // Staged credentials — write-only; never round-tripped from main. Cleared
  // whenever the staged provider changes so one provider's typed key can never
  // be submitted for a different provider.
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [provisioningInput, setProvisioningInput] = useState<string>("");
  const [apiKeySet, setApiKeySet] = useState<boolean>(false);
  const [provisioningKeySet, setProvisioningKeySet] = useState<boolean>(false);

  const [stagedModels, setStagedModels] = useState<Model[]>([]);
  const [stagedModelId, setStagedModelId] = useState<string>("");

  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [fetchStatus, setFetchStatus] = useState<string>("");
  const [fetchError, setFetchError] = useState<string>("");

  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyStatus, setApplyStatus] = useState<string>("");
  const [applyError, setApplyError] = useState<string>("");

  const clearStagedSetupState = useCallback(() => {
    setStagedModels([]);
    setStagedModelId("");
    setFetchStatus("");
    setFetchError("");
    setApplyStatus("");
    setApplyError("");
    setApiKeyInput("");
    setProvisioningInput("");
  }, []);

  const refreshSecretStatus = useCallback((provider: ProviderId) => {
    window.electronAPI
      ?.getProviderSecretStatus?.(provider)
      .then((status) => {
        setApiKeySet(Boolean(status?.apiKeySet));
        setProvisioningKeySet(Boolean(status?.provisioningKeySet));
      })
      .catch((error) => {
        console.error(
          "SettingGeneral: Error checking provider secret status:",
          error,
        );
      });
  }, []);

  const reloadActiveProvider = useCallback(() => {
    window.electronAPI
      ?.getActiveProvider?.()
      .then((provider) => {
        if (provider) {
          setStagedProvider(provider);
        }
      })
      .catch((error) => {
        console.error("SettingGeneral: Error reading active provider:", error);
      });
  }, []);

  // Load active provider on mount; reload when the active profile changes so
  // Apply never commits a previous profile's staged setup into the new one.
  useEffect(() => {
    reloadActiveProvider();
    const offProfile = window.electronAPI?.onProfileUpdated?.(() => {
      clearStagedSetupState();
      reloadActiveProvider();
    });
    return () => {
      offProfile?.();
    };
  }, [clearStagedSetupState, reloadActiveProvider]);

  // Correction output mode is global — load once on mount.
  useEffect(() => {
    window.electronAPI
      ?.getCorrectionOutputMode?.()
      .then(setCorrectionOutputMode)
      .catch((error) => {
        console.error("SettingGeneral: Error loading output mode:", error);
        setOutputModeIsError(true);
        setOutputModeStatus(
          t("settings.general.error", {
            message: t("settings.general.outputMode.unavailable"),
          }),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load-once on mount; `t` is locale-stable (see I18nProvider), re-running per render would refetch for no reason.
  }, []);

  // On mount and on every provider change: refresh masked secret state and
  // reset the staged model list — a model fetched for one provider must never
  // be offered as the default for another.
  useEffect(() => {
    refreshSecretStatus(stagedProvider);
    // Reset staged setup state for the newly selected provider — a
    // derived-state reset on a state change, not an external-system sync.
    // Staged credential inputs are cleared too so one provider's typed key
    // can never be submitted for a different provider.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    clearStagedSetupState();
  }, [stagedProvider, refreshSecretStatus, clearStagedSetupState]);

  const handleOutputModeChange = async (mode: CorrectionOutputMode) => {
    if (!window.electronAPI?.setCorrectionOutputMode) {
      setOutputModeIsError(true);
      setOutputModeStatus(
        t("settings.general.error", {
          message: t("settings.general.outputMode.unavailable"),
        }),
      );
      return;
    }

    const previousMode = correctionOutputMode;
    setCorrectionOutputMode(mode);
    setSavingOutputMode(true);
    setOutputModeIsError(false);
    setOutputModeStatus(t("settings.general.outputMode.saving"));

    try {
      const result = await window.electronAPI.setCorrectionOutputMode(mode);
      if (!result.success) {
        setCorrectionOutputMode(previousMode);
        setOutputModeIsError(true);
        setOutputModeStatus(
          t("settings.general.error", {
            message: result.error || t("settings.general.outputMode.saveFailed"),
          }),
        );
        return;
      }
      setCorrectionOutputMode(result.mode ?? mode);
      setOutputModeIsError(false);
      setOutputModeStatus(t("settings.general.outputMode.saved"));
      setTimeout(() => setOutputModeStatus(""), 2000);
    } catch (error) {
      console.error("SettingGeneral: Error saving output mode:", error);
      setCorrectionOutputMode(previousMode);
      setOutputModeIsError(true);
      setOutputModeStatus(t("settings.general.outputMode.saveError"));
    } finally {
      setSavingOutputMode(false);
    }
  };

  const handleFetchModels = async () => {
    if (!window.electronAPI?.fetchProviderModels) {
      setFetchError(t("settings.general.models.fetchError"));
      return;
    }
    setIsFetching(true);
    setFetchError("");
    setFetchStatus(t("settings.general.models.fetching"));
    try {
      const result = await window.electronAPI.fetchProviderModels({
        provider: stagedProvider,
        modelId: "",
        apiKey: apiKeyInput || undefined,
        provisioningKey:
          stagedProvider === "openrouter" ? provisioningInput || undefined : undefined,
      });
      if (result.success && result.models) {
        setStagedModels(result.models);
        setStagedModelId(result.models[0]?.id ?? "");
        setFetchStatus(
          result.models.length > 0
            ? t("settings.general.models.loaded", { count: result.models.length })
            : t("settings.general.models.none"),
        );
      } else {
        setStagedModels([]);
        setStagedModelId("");
        setFetchStatus("");
        setFetchError(result.error || t("settings.general.models.fetchError"));
      }
    } catch (error) {
      setFetchStatus("");
      setFetchError(
        error instanceof Error ? error.message : t("settings.general.models.fetchError"),
      );
    } finally {
      setIsFetching(false);
    }
  };

  const handleApply = async () => {
    if (!stagedModelId || !window.electronAPI?.applyProviderSetup) {
      return;
    }
    setIsApplying(true);
    setApplyError("");
    setApplyStatus(t("settings.general.apply.applying"));
    try {
      const result = await window.electronAPI.applyProviderSetup({
        provider: stagedProvider,
        modelId: stagedModelId,
        apiKey: apiKeyInput || undefined,
        provisioningKey:
          stagedProvider === "openrouter" ? provisioningInput || undefined : undefined,
      });
      if (result.success) {
        setApiKeyInput("");
        setProvisioningInput("");
        refreshSecretStatus(stagedProvider);
        setApplyStatus(t("settings.general.apply.applied"));
      } else {
        setApplyStatus("");
        setApplyError(result.error || t("settings.general.apply.error"));
      }
    } catch (error) {
      setApplyStatus("");
      setApplyError(
        error instanceof Error ? error.message : t("settings.general.apply.error"),
      );
    } finally {
      setIsApplying(false);
    }
  };

  // Reset the current profile's settings to defaults (keeps the API key).
  const handleResetDefaults = async () => {
    const confirmed = window.confirm(t("settings.general.reset.confirm"));
    if (!confirmed) {
      return;
    }

    if (!window.electronAPI?.resetProfileSettings) {
      setResetIsError(true);
      setResetStatus(
        t("settings.general.error", {
          message: t("settings.general.reset.unavailable"),
        }),
      );
      return;
    }

    setResetIsError(false);
    setResetStatus(t("settings.general.reset.inProgress"));
    try {
      const result = await window.electronAPI.resetProfileSettings();
      if (result.success) {
        setResetIsError(false);
        setResetStatus(t("settings.general.reset.success"));
        clearStagedSetupState();
        reloadActiveProvider();
        setTimeout(() => setResetStatus(""), 2500);
      } else {
        setResetIsError(true);
        setResetStatus(
          t("settings.general.error", {
            message: result.error || t("settings.general.reset.failed"),
          }),
        );
      }
    } catch (error) {
      console.error("SettingGeneral: Error resetting settings:", error);
      setResetIsError(true);
      setResetStatus(t("settings.general.reset.error"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Interface language — global, applies to every window instantly. */}
      <section className="mb-4">
        <h2 className="text-sm font-medium text-card-foreground">
          {t("settings.general.language.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.general.language.description")}
        </p>
        <div className="mt-3">
          <LanguageSelect />
        </div>
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-medium text-card-foreground">
          {t("settings.general.correctionOutput.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.general.correctionOutput.description")}
        </p>
        <div
          className="mt-3 grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label={t("settings.general.correctionOutput.title")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={correctionOutputMode === "paste"}
            disabled={savingOutputMode}
            onClick={() => void handleOutputModeChange("paste")}
            className={`rounded border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
              correctionOutputMode === "paste"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-secondary"
            }`}
          >
            <span className="block text-sm font-medium">
              {t("settings.general.correctionOutput.paste.label")}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("settings.general.correctionOutput.paste.description")}
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={correctionOutputMode === "popup"}
            disabled={savingOutputMode}
            onClick={() => void handleOutputModeChange("popup")}
            className={`rounded border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
              correctionOutputMode === "popup"
                ? "border-primary bg-primary/10"
                : "border-border hover:bg-secondary"
            }`}
          >
            <span className="block text-sm font-medium">
              {t("settings.general.correctionOutput.popup.label")}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {t("settings.general.correctionOutput.popup.description")}
            </span>
          </button>
        </div>
        {outputModeStatus && (
          <p
            className={`mt-1 text-xs ${outputModeIsError ? "text-destructive" : "text-success"}`}
            role="status"
          >
            {outputModeStatus}
          </p>
        )}
      </section>

      {/* Provider selection — the only provider control in the whole app. */}
      <div className="mb-2">
        <label
          htmlFor="provider-select"
          className="block text-sm font-medium text-card-foreground mb-1"
        >
          {t("settings.general.provider.label")}
        </label>
        <select
          id="provider-select"
          className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={stagedProvider}
          onChange={(event) => setStagedProvider(event.target.value as ProviderId)}
        >
          {PROVIDER_IDS.map((provider) => (
            <option key={provider} value={provider}>
              {t(PROVIDER_LABEL_KEYS[provider])}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.general.provider.hint")}
        </p>
      </div>

      {/* Credentials — conditional on the staged provider. */}
      {stagedProvider !== "ollama" ? (
        <div className="mb-2">
          <label
            htmlFor="staged-api-key-input"
            className="block text-sm font-medium text-card-foreground mb-1"
          >
            {t("settings.general.apiKey.label", {
              provider: t(PROVIDER_LABEL_KEYS[stagedProvider]),
            })}
          </label>
          <p
            className={`text-xs mb-1 ${apiKeySet ? "text-success" : "text-muted-foreground"}`}
            role="status"
          >
            {apiKeySet ? t("settings.general.secret.set") : t("settings.general.secret.unset")}
          </p>
          <input
            id="staged-api-key-input"
            type="password"
            autoComplete="off"
            className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder={
              apiKeySet
                ? t("settings.general.secret.placeholderReplace")
                : t("settings.general.apiKey.placeholderNew", {
                    provider: t(PROVIDER_LABEL_KEYS[stagedProvider]),
                  })
            }
            aria-label={t("settings.general.apiKey.label", {
              provider: t(PROVIDER_LABEL_KEYS[stagedProvider]),
            })}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-2">
          {t("settings.general.apiKey.notRequired")}
        </p>
      )}

      {stagedProvider === "openrouter" && (
        <div className="mb-2">
          <label
            htmlFor="staged-provisioning-key-input"
            className="block text-sm font-medium text-card-foreground mb-1"
          >
            {t("settings.general.provisioningKey.label")}
          </label>
          <p
            className={`text-xs mb-1 ${provisioningKeySet ? "text-success" : "text-muted-foreground"}`}
            role="status"
          >
            {provisioningKeySet
              ? t("settings.general.secret.set")
              : t("settings.general.secret.unset")}
          </p>
          <input
            id="staged-provisioning-key-input"
            type="password"
            autoComplete="off"
            className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            value={provisioningInput}
            onChange={(event) => setProvisioningInput(event.target.value)}
            placeholder={
              provisioningKeySet
                ? t("settings.general.secret.placeholderReplace")
                : t("settings.general.provisioningKey.placeholderNew")
            }
            aria-label={t("settings.general.provisioningKey.label")}
          />
        </div>
      )}

      {/* Fetch models for the staged provider. */}
      <div>
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={isFetching}
          className="rounded bg-primary px-3 py-1.5 text-sm text-foreground hover:bg-primary disabled:opacity-50"
        >
          {isFetching
            ? t("settings.general.models.fetching")
            : t("settings.general.models.fetchButton")}
        </button>
        {fetchStatus && (
          <p className="text-xs mt-1 text-success" role="status">
            {fetchStatus}
          </p>
        )}
        {fetchError && (
          <p className="text-xs mt-1 text-destructive" role="alert">
            {fetchError}
          </p>
        )}
      </div>

      {/* Staged default model — required before Apply is enabled. */}
      <div>
        <label
          htmlFor="staged-model-select"
          className="block text-sm font-medium text-card-foreground mb-1"
        >
          {t("settings.general.models.defaultLabel")}
        </label>
        <select
          id="staged-model-select"
          required
          className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          value={stagedModelId}
          onChange={(event) => setStagedModelId(event.target.value)}
          disabled={stagedModels.length === 0}
        >
          <option value="" disabled>
            {stagedModels.length > 0
              ? t("settings.general.models.selectPlaceholder")
              : t("settings.general.models.fetchFirst")}
          </option>
          {stagedModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name || model.id}
            </option>
          ))}
        </select>
      </div>

      {/* Apply — commits provider, model, cache, and any typed credentials together. */}
      <div>
        <button
          type="button"
          onClick={handleApply}
          disabled={!stagedModelId || isApplying}
          className="w-full rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isApplying
            ? t("settings.general.apply.applying")
            : t("settings.general.apply.button")}
        </button>
        {applyStatus && (
          <p className="text-xs mt-1 text-success" role="status">
            {applyStatus}
          </p>
        )}
        {applyError && (
          <p className="text-xs mt-1 text-destructive" role="alert">
            {applyError}
          </p>
        )}
      </div>

      {/* Reset to defaults */}
      <div className="mt-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleResetDefaults}
          className="w-full rounded border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-destructive"
        >
          {t("settings.general.reset.button")}
        </button>
        {resetStatus && (
          <p
            className={`text-xs mt-1 ${resetIsError ? "text-destructive" : "text-success"}`}
            role="status"
          >
            {resetStatus}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.general.reset.description")}
        </p>
      </div>
    </div>
  );
};
