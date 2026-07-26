import React, { useCallback, useEffect, useMemo, useState } from "react";
import { messageLabel, type Label, type Message } from "~/shared/i18n/message";
import { LanguageTabs } from "./LanguageTabs";
import { ModelSelect } from "./ModelSelect";
import { PROVIDER_LABEL_KEYS } from "./modelSelectOptions";
import {
  buildProviderCards,
  describeDisconnectImpact,
  type ProviderCardState,
  type ProviderConnectionState,
  type TypedProviderKeys,
} from "./providerCards";
import { plainStatus, wrappedError, resolveStatus as resolveStatusDescriptor, type StatusDescriptor } from "./statusDescriptor";
import { useI18n } from "../i18n/useI18n";
import type { CorrectionOutputMode } from "~/shared/outputMode";
import type { ProviderId } from "~/stores/apiStore";

type ProviderStatus = {
  status?: StatusDescriptor;
  /**
   * A success-path advisory (Ollama reachable, nothing pulled), rendered
   * verbatim. Never route it through `wrappedError`, which would announce a
   * successful connect as "Error: …".
   */
  note?: Label;
  isError: boolean;
};

export const SettingGeneral: React.FC = () => {
  const { t, tm, tl } = useI18n();

  // Descriptors, never resolved strings — see `StatusDescriptor` above for why.
  const [resetStatus, setResetStatus] = useState<StatusDescriptor | null>(null);
  const [resetIsError, setResetIsError] = useState<boolean>(false);
  const [correctionOutputMode, setCorrectionOutputMode] =
    useState<CorrectionOutputMode>("paste");
  const [outputModeStatus, setOutputModeStatus] = useState<StatusDescriptor | null>(null);
  const [outputModeIsError, setOutputModeIsError] = useState<boolean>(false);
  const [savingOutputMode, setSavingOutputMode] = useState(false);

  const [providerStates, setProviderStates] = useState<
    Partial<Record<ProviderId, ProviderConnectionState>>
  >({});
  // Write-only, and per provider so one card's key can never be submitted for another.
  const [typedKeys, setTypedKeys] = useState<TypedProviderKeys>({});
  // Per provider, not one slot: concurrent connects would otherwise clear each
  // other's flag and re-enable a button whose request is still running.
  const [busyProviders, setBusyProviders] = useState<
    Partial<Record<ProviderId, boolean>>
  >({});
  const [providerStatus, setProviderStatus] = useState<
    Partial<Record<ProviderId, ProviderStatus>>
  >({});

  const [confirmDisconnect, setConfirmDisconnect] = useState<ProviderId | null>(null);
  const [disconnectReport, setDisconnectReport] = useState<{
    provider: ProviderId;
    lines: Message[];
  } | null>(null);

  // Deliberately not memoized — invoked only during render, so it always
  // sees the current `t`/`tm`/`tl` for the active locale.
  const resolveStatus = (status: StatusDescriptor | null): string =>
    resolveStatusDescriptor(status, t, tm, tl);

  const providerName = (provider: ProviderId): string =>
    t(PROVIDER_LABEL_KEYS[provider]);

  const refreshProviderStates = useCallback(async () => {
    try {
      const states = await window.electronAPI?.getProviderStates?.();
      if (states) setProviderStates(states);
    } catch (error) {
      console.error("SettingGeneral: Error reading provider states:", error);
    }
  }, []);

  // Reload on profile change so the cards never describe another profile's
  // connections.
  useEffect(() => {
    // Reading main's state is the external-system sync the rule carves out.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshProviderStates();
    const offProfile = window.electronAPI?.onProfileUpdated?.(() => {
      setTypedKeys({});
      setProviderStatus({});
      setConfirmDisconnect(null);
      setDisconnectReport(null);
      refreshProviderStates();
    });
    // Another window's connect/disconnect broadcasts `settings-updated`;
    // without this the cards keep showing stale connection state.
    const offSettings = window.electronAPI?.onSettingsUpdated?.(() => {
      refreshProviderStates();
    });
    return () => {
      offProfile?.();
      offSettings?.();
    };
  }, [refreshProviderStates]);

  // Correction output mode is global — load once on mount.
  useEffect(() => {
    window.electronAPI
      ?.getCorrectionOutputMode?.()
      .then(setCorrectionOutputMode)
      .catch((error: unknown) => {
        console.error("SettingGeneral: Error loading output mode:", error);
        setOutputModeIsError(true);
        setOutputModeStatus(wrappedError(messageLabel("settings.general.outputMode.unavailable")));
      });
    // Descriptor-only now — no `t()` call in this effect, so no locale
    // dependency to worry about; load-once on mount is correct as written.
  }, []);

  const cards = useMemo<ProviderCardState[]>(
    () => buildProviderCards(providerStates, typedKeys),
    [providerStates, typedKeys],
  );

  const setTypedKey = (
    provider: ProviderId,
    field: "apiKey" | "provisioningKey",
    value: string,
  ): void => {
    setTypedKeys((current) => ({
      ...current,
      [provider]: { ...current[provider], [field]: value },
    }));
  };

  const handleOutputModeChange = async (mode: CorrectionOutputMode) => {
    if (!window.electronAPI?.setCorrectionOutputMode) {
      setOutputModeIsError(true);
      setOutputModeStatus(wrappedError(messageLabel("settings.general.outputMode.unavailable")));
      return;
    }

    const previousMode = correctionOutputMode;
    setCorrectionOutputMode(mode);
    setSavingOutputMode(true);
    setOutputModeIsError(false);
    setOutputModeStatus(plainStatus("settings.general.outputMode.saving"));

    try {
      const result = await window.electronAPI.setCorrectionOutputMode(mode);
      if (!result.success) {
        setCorrectionOutputMode(previousMode);
        setOutputModeIsError(true);
        setOutputModeStatus(
          wrappedError(
            result.error ?? messageLabel("settings.general.outputMode.saveFailed"),
          ),
        );
        return;
      }
      setCorrectionOutputMode(result.mode ?? mode);
      setOutputModeIsError(false);
      setOutputModeStatus(plainStatus("settings.general.outputMode.saved"));
      setTimeout(() => setOutputModeStatus(null), 2000);
    } catch (error) {
      console.error("SettingGeneral: Error saving output mode:", error);
      setCorrectionOutputMode(previousMode);
      setOutputModeIsError(true);
      setOutputModeStatus(plainStatus("settings.general.outputMode.saveError"));
    } finally {
      setSavingOutputMode(false);
    }
  };

  const reportProvider = (
    provider: ProviderId,
    status: StatusDescriptor,
    isError: boolean,
  ): void => {
    setProviderStatus((current) => ({ ...current, [provider]: { status, isError } }));
  };

  const handleConnect = async (provider: ProviderId) => {
    if (!window.electronAPI?.connectProvider) {
      reportProvider(
        provider,
        wrappedError(messageLabel("models.providerSetup.error.invalidSetup")),
        true,
      );
      return;
    }
    setBusyProviders((current) => ({ ...current, [provider]: true }));
    setDisconnectReport(null);
    setProviderStatus((current) => ({ ...current, [provider]: undefined }));
    try {
      const typed = typedKeys[provider];
      const result = await window.electronAPI.connectProvider({
        provider,
        apiKey: typed?.apiKey || undefined,
        provisioningKey: typed?.provisioningKey || undefined,
      });
      if (result.success) {
        // Never keep a credential around after main has stored it.
        setTypedKeys((current) => ({ ...current, [provider]: {} }));
        if (result.note) {
          setProviderStatus((current) => ({
            ...current,
            [provider]: { note: result.note, isError: false },
          }));
        } else {
          reportProvider(
            provider,
            plainStatus("settings.general.providers.card.connected"),
            false,
          );
        }
        await refreshProviderStates();
      } else {
        reportProvider(
          provider,
          wrappedError(result.error ?? messageLabel("models.providerSetup.error.invalidSetup")),
          true,
        );
      }
    } catch (error) {
      console.error("SettingGeneral: Error connecting provider:", error);
      reportProvider(
        provider,
        wrappedError(messageLabel("models.providerSetup.error.invalidSetup")),
        true,
      );
    } finally {
      setBusyProviders((current) => ({ ...current, [provider]: false }));
    }
  };

  const handleDisconnect = async (provider: ProviderId) => {
    setConfirmDisconnect(null);
    if (!window.electronAPI?.disconnectProvider) {
      reportProvider(
        provider,
        wrappedError(messageLabel("models.providerSetup.error.invalidSetup")),
        true,
      );
      return;
    }
    setBusyProviders((current) => ({ ...current, [provider]: true }));
    setProviderStatus((current) => ({ ...current, [provider]: undefined }));
    try {
      const result = await window.electronAPI.disconnectProvider(provider);
      if (result.success) {
        setDisconnectReport({
          provider,
          lines: describeDisconnectImpact(
            provider,
            result.cleared ?? { selectedModel: false, presetIds: [], features: [] },
            // Read BEFORE the refresh below, which zeroes these.
            {
              apiKeySet: providerStates[provider]?.apiKeySet ?? false,
              provisioningKeySet:
                providerStates[provider]?.provisioningKeySet ?? false,
            },
          ),
        });
        setTypedKeys((current) => ({ ...current, [provider]: {} }));
        await refreshProviderStates();
      } else {
        reportProvider(
          provider,
          wrappedError(result.error ?? messageLabel("models.providerSetup.error.invalidSetup")),
          true,
        );
      }
    } catch (error) {
      console.error("SettingGeneral: Error disconnecting provider:", error);
      reportProvider(
        provider,
        wrappedError(messageLabel("models.providerSetup.error.invalidSetup")),
        true,
      );
    } finally {
      setBusyProviders((current) => ({ ...current, [provider]: false }));
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
      setResetStatus(wrappedError(messageLabel("settings.general.reset.unavailable")));
      return;
    }

    setResetIsError(false);
    setResetStatus(plainStatus("settings.general.reset.inProgress"));
    try {
      const result = await window.electronAPI.resetProfileSettings();
      if (result.success) {
        setResetIsError(false);
        setResetStatus(plainStatus("settings.general.reset.success"));
        setTypedKeys({});
        setProviderStatus({});
        setDisconnectReport(null);
        await refreshProviderStates();
        setTimeout(() => setResetStatus(null), 2500);
      } else {
        setResetIsError(true);
        setResetStatus(
          wrappedError(result.error ?? messageLabel("settings.general.reset.failed")),
        );
      }
    } catch (error) {
      console.error("SettingGeneral: Error resetting settings:", error);
      setResetIsError(true);
      setResetStatus(plainStatus("settings.general.reset.error"));
    }
  };

  const renderProviderCard = (card: ProviderCardState): React.ReactElement => {
    const { provider } = card;
    const name = providerName(provider);
    const typed = typedKeys[provider] ?? {};
    const busy = busyProviders[provider] === true;
    const status = providerStatus[provider];

    return (
      <div key={provider} className="rounded border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-card-foreground">{name}</span>
          <span
            className={`text-xs ${card.connected ? "text-success" : "text-muted-foreground"}`}
            role="status"
          >
            {card.connected
              ? t("settings.general.providers.card.connected")
              : t("settings.general.providers.card.notConnected")}
          </span>
        </div>

        {card.connected && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.general.providers.card.modelCount", {
              count: card.modelCount,
            })}
          </p>
        )}

        {card.requiresApiKey ? (
          <div className="mt-2">
            <label
              htmlFor={`api-key-${provider}`}
              className="block text-xs font-medium text-card-foreground mb-1"
            >
              {t("settings.general.apiKey.label", { provider: name })}
            </label>
            <p
              className={`text-xs mb-1 ${card.apiKeySet ? "text-success" : "text-muted-foreground"}`}
              role="status"
            >
              {card.apiKeySet
                ? t("settings.general.secret.set")
                : t("settings.general.secret.unset")}
            </p>
            <input
              id={`api-key-${provider}`}
              type="password"
              autoComplete="off"
              className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={typed.apiKey ?? ""}
              onChange={(event) => setTypedKey(provider, "apiKey", event.target.value)}
              placeholder={
                card.apiKeySet
                  ? t("settings.general.secret.placeholderReplace")
                  : t("settings.general.apiKey.placeholderNew", { provider: name })
              }
              aria-label={t("settings.general.apiKey.label", { provider: name })}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("settings.general.providers.ollama.hint")}
          </p>
        )}

        {card.supportsProvisioningKey && (
          <div className="mt-2">
            <label
              htmlFor={`provisioning-key-${provider}`}
              className="block text-xs font-medium text-card-foreground mb-1"
            >
              {t("settings.general.provisioningKey.label")}
            </label>
            <p
              className={`text-xs mb-1 ${card.provisioningKeySet ? "text-success" : "text-muted-foreground"}`}
              role="status"
            >
              {card.provisioningKeySet
                ? t("settings.general.secret.set")
                : t("settings.general.secret.unset")}
            </p>
            <input
              id={`provisioning-key-${provider}`}
              type="password"
              autoComplete="off"
              className="w-full p-2 bg-secondary border border-border rounded text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={typed.provisioningKey ?? ""}
              onChange={(event) =>
                setTypedKey(provider, "provisioningKey", event.target.value)
              }
              placeholder={
                card.provisioningKeySet
                  ? t("settings.general.secret.placeholderReplace")
                  : t("settings.general.provisioningKey.placeholderNew")
              }
              aria-label={t("settings.general.provisioningKey.label")}
            />
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleConnect(provider)}
            disabled={busy || !card.canConnect}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy
              ? t("settings.general.providers.card.testing")
              : card.connected
                ? t("settings.general.providers.card.testAndFetch")
                : t("settings.general.providers.card.connect")}
          </button>
          {/* Hidden while its confirmation is open, so Disconnect is never
              one of two identically-named controls. */}
          {card.connected && confirmDisconnect !== provider && (
            <button
              type="button"
              onClick={() => setConfirmDisconnect(provider)}
              disabled={busy}
              className="rounded border border-destructive/50 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {t("settings.general.providers.card.disconnect")}
            </button>
          )}
        </div>

        {confirmDisconnect === provider && (
          <div
            role="alertdialog"
            aria-labelledby={`disconnect-title-${provider}`}
            className="mt-2 rounded border border-destructive/50 bg-destructive/10 p-2"
          >
            <p
              id={`disconnect-title-${provider}`}
              className="text-xs font-semibold text-destructive"
            >
              {t("settings.general.providers.disconnect.warning.title", {
                provider: name,
              })}
            </p>
            {/* Gated on a key actually being on disk, not on the provider
                merely supporting one. */}
            {(card.apiKeySet || card.provisioningKeySet) && (
              <p className="mt-1 text-xs text-card-foreground">
                {t("settings.general.providers.disconnect.warning.key")}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void handleDisconnect(provider)}
                className="rounded bg-destructive px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-destructive/90"
              >
                {t("settings.general.providers.card.disconnect")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDisconnect(null)}
                className="rounded border border-border px-3 py-1 text-xs text-card-foreground hover:bg-secondary"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}

        {disconnectReport?.provider === provider && (
          <div
            className="mt-2 rounded border border-border bg-secondary p-2"
            role="status"
          >
            <p className="text-xs font-semibold text-card-foreground">
              {t("settings.general.providers.disconnect.warning.title", {
                provider: name,
              })}
            </p>
            {disconnectReport.lines.map((line) => (
              <p key={line.key} className="mt-1 text-xs text-muted-foreground">
                {tm(line)}
              </p>
            ))}
          </div>
        )}

        {status && (
          <p
            className={`mt-2 text-xs ${status.isError ? "text-destructive" : "text-success"}`}
            role={status.isError ? "alert" : "status"}
          >
            {status.note ? tl(status.note) : resolveStatus(status.status ?? null)}
          </p>
        )}
      </div>
    );
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
          <LanguageTabs size="md" className="w-full" />
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
            {resolveStatus(outputModeStatus)}
          </p>
        )}
      </section>

      <section className="mb-4">
        <h2 className="text-sm font-medium text-card-foreground">
          {t("settings.general.providers.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.general.providers.description")}
        </p>
        <div className="mt-3 flex flex-col gap-3">{cards.map(renderProviderCard)}</div>
      </section>

      <section className="mb-4">
        <ModelSelect
          saveOnChange
          showAdditionalInfo
          labelKey="settings.general.defaultModel.label"
          descriptionKey="settings.general.defaultModel.description"
        />
      </section>

      {/* Reset to defaults */}
      <div className="mt-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void handleResetDefaults()}
          className="w-full rounded border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 focus:outline-none focus:ring-2 focus:ring-destructive"
        >
          {t("settings.general.reset.button")}
        </button>
        {resetStatus && (
          <p
            className={`text-xs mt-1 ${resetIsError ? "text-destructive" : "text-success"}`}
            role="status"
          >
            {resolveStatus(resetStatus)}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {t("settings.general.reset.description")}
        </p>
      </div>
    </div>
  );
};
