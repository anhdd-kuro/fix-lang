import React, { useCallback, useEffect, useState } from "react";
import {
  AUTOCOMPLETE_INHERIT_ASK_MODEL,
  type AutocompleteSettings,
} from "~/features/autocomplete/shared/autocompleteSettings";
import { Checkbox } from "./Checkbox";
import { ModelSelect } from "./ModelSelect";
import { formatOverviewCostHint } from "./overviewCostView";
import {
  plainStatus,
  resolveStatus,
  type StatusDescriptor,
} from "./statusDescriptor";
import { useI18n } from "../i18n/useI18n";
import type { CostSum } from "../analytics/shared";
import type {
  AutocompleteDayRollup,
  AutocompleteUsageSnapshot,
} from "~/features/autocomplete/shared/autocompleteWire";

/**
 * @file SettingAutocomplete.tsx
 * @description Settings > General's Autocomplete card: on/off, model, the
 * privacy statement, and a today/month-to-date usage readout.
 *
 * Its own file, not a block inside SettingGeneral.tsx: that file is already
 * over CLAUDE.md's 800-line ceiling, so it gets exactly one mounting line.
 *
 * `ModelSelect`'s own built-in inherit row (rendered whenever `""` is passed
 * as `selectedModelId`) says "Use global default" — that is the correct copy
 * for a preset inheriting the app's default model, but autocomplete's `""`
 * sentinel means something narrower: inherit the *Ask AI preset's* model,
 * not the app default. Restating that distinction is this file's job, so a
 * caption below the picker states it plainly rather than trusting the
 * generic copy to carry a meaning it was not written for.
 */

const DEFAULT_SETTINGS: AutocompleteSettings = {
  enabled: true,
  model: AUTOCOMPLETE_INHERIT_ASK_MODEL,
};

const emptyRollup = (): AutocompleteDayRollup => ({
  date: "",
  requests: 0,
  responses: 0,
  tokenlessResponses: 0,
  unpricedResponses: 0,
  promptTokens: 0,
  completionTokens: 0,
  estimatedCostUsd: 0,
});

const emptyUsage = (): AutocompleteUsageSnapshot => ({
  today: emptyRollup(),
  month: emptyRollup(),
  days: [],
  dailyCap: 0,
});

/**
 * Maps a rollup onto `CostSum` so the readout can hand off to
 * `formatOverviewCostHint` — the Overview card's own none/na/partial/full
 * rendering — instead of a second, narrower copy of the same honesty rule.
 * `estimatedCostUsd` sums only priced responses, so a day that is entirely
 * unpriced must never render as "$0.00"; see `AutocompleteDayRollup`'s
 * doc comment in `autocompleteWire.ts` for the full contract.
 */
const rollupCostSum = (rollup: AutocompleteDayRollup): CostSum => ({
  totalUsd: rollup.estimatedCostUsd,
  pricedCount: rollup.responses - rollup.unpricedResponses,
  total: rollup.responses,
  hasNa: rollup.unpricedResponses > 0,
});

export const SettingAutocomplete: React.FC = () => {
  const { t, tm, tl, formatNumber } = useI18n();
  const [settings, setSettings] = useState<AutocompleteSettings>(DEFAULT_SETTINGS);
  const [usage, setUsage] = useState<AutocompleteUsageSnapshot>(emptyUsage);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<StatusDescriptor | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const stored = await window.electronAPI.getAutocompleteSettings();
      setSettings(stored);
    } catch (error) {
      console.error("Failed to load autocomplete settings:", error);
      setSettings(DEFAULT_SETTINGS);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const snapshot = await window.electronAPI.getAutocompleteUsage();
      setUsage(snapshot);
    } catch (error) {
      console.error("Failed to load autocomplete usage:", error);
      setUsage(emptyUsage());
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      await Promise.all([loadSettings(), loadUsage()]);
      setIsLoading(false);
    })();
  }, [loadSettings, loadUsage]);

  // Cross-window sync, matching ModelSelect/SettingCorrection: another
  // window's profile switch or settings change must not leave this card
  // showing a stale enabled/model value.
  //
  // Profile switches broadcast `active-profile-changed`, not
  // `settings-updated` (see `notifyActiveProfileChanged` in
  // `~/main/profileChange.ts`), and `settingsAutocomplete` is a per-profile
  // setting (`getProfileSetting`/`updateProfileSetting` in
  // `settings.ts`) — so without this second subscription, switching profiles
  // with Settings left open keeps showing the OLD profile's enabled/model
  // values, and the next toggle or model pick writes that stale state into
  // the newly active profile. Usage is deliberately NOT reloaded here:
  // `autocompleteUsageStore` is a single global electron-store keyed only by
  // date, with no profile id anywhere in its schema or writes, so a profile
  // switch can never change what `getAutocompleteUsage` returns.
  useEffect(() => {
    const offActiveProfile = window.electronAPI.onActiveProfileChanged?.(() => {
      loadSettings();
    });
    const offSettings = window.electronAPI.onSettingsUpdated?.(() => {
      loadSettings();
    });
    return () => {
      offActiveProfile?.();
      offSettings?.();
    };
  }, [loadSettings]);

  /**
   * Optimistic, but only past the guard: `setAutocompleteSettings` returns
   * `{ success: false }` for a payload the main-process guard rejects, and
   * the store is never written in that case — so the checkbox/picker must
   * revert to `previous` rather than keep showing a value that was never
   * actually persisted.
   */
  const persist = async (previous: AutocompleteSettings, next: AutocompleteSettings) => {
    setSettings(next);
    try {
      const result = await window.electronAPI.setAutocompleteSettings(next);
      if (result.success) {
        setStatusIsError(false);
        setStatus(plainStatus("settings.autocomplete.saved"));
        setTimeout(() => setStatus(null), 2000);
        return;
      }
      setSettings(previous);
      setStatusIsError(true);
      setStatus(plainStatus("settings.autocomplete.saveError"));
    } catch (error) {
      console.error("Failed to save autocomplete settings:", error);
      setSettings(previous);
      setStatusIsError(true);
      setStatus(plainStatus("settings.autocomplete.saveError"));
    }
  };

  if (isLoading) {
    return (
      <section className="mb-4">
        <p className="text-xs text-muted-foreground">
          {t("settings.autocomplete.loading")}
        </p>
      </section>
    );
  }

  const capPct =
    usage.dailyCap > 0
      ? Math.min(100, Math.round((usage.today.requests / usage.dailyCap) * 100))
      : null;

  const todayCostHint = formatOverviewCostHint(rollupCostSum(usage.today), t, formatNumber);
  const monthCostHint = formatOverviewCostHint(rollupCostSum(usage.month), t, formatNumber);

  return (
    <section className="mb-4">
      <h2 className="text-sm font-medium text-card-foreground">
        {t("settings.autocomplete.heading")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("settings.autocomplete.hint")}
      </p>

      <div className="mt-3">
        <Checkbox
          checked={settings.enabled}
          onChange={(enabled) => void persist(settings, { ...settings, enabled })}
          label={t("settings.autocomplete.enabled.label")}
          className="text-card-foreground"
        />
      </div>

      <div className="mt-3">
        <ModelSelect
          persistSelection={false}
          selectedModelId={settings.model}
          onChange={(model) => void persist(settings, { ...settings, model })}
          labelKey="settings.autocomplete.model.label"
          descriptionKey="settings.autocomplete.model.description"
        />
        {settings.model === AUTOCOMPLETE_INHERIT_ASK_MODEL && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("settings.autocomplete.model.sameAsAskAI")}
          </p>
        )}
      </div>

      <p className="mt-3 rounded-md border border-card-control-border bg-background/40 p-3 text-xs text-muted-foreground">
        {t("settings.autocomplete.privacy.hint")}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-card-control-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.autocomplete.usage.today")}
          </p>
          <p className="text-sm font-semibold text-foreground">
            {t("settings.autocomplete.usage.requests", { count: usage.today.requests })}
          </p>
          {todayCostHint && (
            <p className="text-xs text-muted-foreground">{todayCostHint}</p>
          )}
        </div>
        <div className="rounded-md border border-card-control-border bg-background/40 p-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.autocomplete.usage.month")}
          </p>
          <p className="text-sm font-semibold text-foreground">
            {t("settings.autocomplete.usage.requests", { count: usage.month.requests })}
          </p>
          {monthCostHint && (
            <p className="text-xs text-muted-foreground">{monthCostHint}</p>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {t("settings.autocomplete.usage.requestsHint")}
      </p>

      {capPct !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.autocomplete.usage.capUsage", {
            used: usage.today.requests,
            cap: usage.dailyCap,
            pct: capPct,
          })}
        </p>
      )}

      {status && (
        <p
          className={`mt-2 text-xs ${statusIsError ? "text-destructive" : "text-success"}`}
          role="status"
        >
          {resolveStatus(status, t, tm, tl)}
        </p>
      )}
    </section>
  );
};
