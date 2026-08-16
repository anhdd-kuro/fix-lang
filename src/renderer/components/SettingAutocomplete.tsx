import React, { useCallback, useEffect, useState } from "react";
import {
  AUTOCOMPLETE_INHERIT_ASK_MODEL,
  DEFAULT_DAILY_COST_CAP_USD,
  MAX_DAILY_COST_CAP_USD,
  normalizeDailyCostCapUsd,
  type AutocompleteSettings,
} from "~/features/autocomplete/shared/autocompleteSettings";
import { resolveAutocompleteCapUsage } from "./autocompleteUsageView";
import { Checkbox } from "./Checkbox";
import { Input } from "./Input";
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
import type { MessageKey } from "~/features/i18n/shared/message";

/**
 * @file SettingAutocomplete.tsx
 * @description Settings > Autocomplete: on/off, model, the daily spend cap, the
 * privacy statement, and a today/month-to-date usage readout. It is the whole
 * tab, mounted from `SettingsModal.tsx` — a sibling of Transform rather than a
 * card inside General.
 *
 * The cap is stated with its own limits beside it, not just an input. It is a
 * budget over PRICED spend, so it never fires for a local provider (which costs
 * a real `$0`) nor for a model `computeCost` cannot price (which bills and
 * records `$0`) — and this tab is the one place recommending local providers
 * for privacy, so leaving that unsaid would sell a guarantee the number does
 * not carry. `DAILY_REQUEST_BACKSTOP` in `main/service.ts` covers those cases
 * and is deliberately not surfaced here: it is set past what typing can reach,
 * so showing it would read as a second budget.
 *
 * `ModelSelect`'s own built-in inherit row (rendered whenever `""` is passed
 * as `selectedModelId`) says "Use global default" — that is the correct copy
 * for a preset inheriting the app's default model, but autocomplete's `""`
 * sentinel means something narrower: inherit the *Ask AI preset's* model,
 * not the app default. Restating that distinction is this file's job, so a
 * caption below the picker states it plainly rather than trusting the
 * generic copy to carry a meaning it was not written for.
 */

/**
 * The privacy statement's points, in the order they are shown — what
 * autocomplete sends, what else it carries, and only then the local-provider
 * recommendation. The reassuring point comes last on purpose: it must not be
 * able to stand in for the warnings above it.
 */
const PRIVACY_HINT_KEYS: readonly MessageKey[] = [
  "settings.autocomplete.privacy.typing",
  "settings.autocomplete.privacy.askContext",
  "settings.autocomplete.privacy.metadata",
  "settings.autocomplete.privacy.localProvider",
];

/** Closed readings: this renders before IPC replies, and must not flash a lie. */
const DEFAULT_SETTINGS: AutocompleteSettings = {
  enabled: false,
  model: AUTOCOMPLETE_INHERIT_ASK_MODEL,
  dailyCostCapUsd: DEFAULT_DAILY_COST_CAP_USD,
  scopeMode: "allowlist",
  scopedApps: [],
  cloudScopeConsent: "",
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
  dailyCostCapUsd: 0,
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
  const { t, tm, tl, formatNumber, formatCurrency } = useI18n();
  const [settings, setSettings] = useState<AutocompleteSettings>(DEFAULT_SETTINGS);
  const [usage, setUsage] = useState<AutocompleteUsageSnapshot>(emptyUsage);
  /**
   * The cap field while it is being typed, or `null` for "show what is stored".
   *
   * A draft rather than a controlled number, because a number input passes
   * through states no cap should ever be persisted from: `""` while the field
   * is cleared to retype it, and `"0."` mid-decimal. Committing on every
   * keystroke would write a `0` cap — which means "spend nothing" and silently
   * turns the feature off — the moment the user selects-all and starts typing.
   *
   * `null` rather than a synced copy so an external change (another window's
   * profile switch, `settings-updated`) flows straight through without an
   * effect writing state back into render.
   */
  const [capDraft, setCapDraft] = useState<string | null>(null);
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

  // The SAME derivation the dashboard's cap card uses, imported rather than
  // recomputed: an inline `estimatedCostUsd / cap` here printed `$0.00 of $5.00`
  // over a day whose responses all went unpriced — the exact false zero the
  // readout below already refuses for its own cost line.
  const cap = resolveAutocompleteCapUsage(usage.today, settings.dailyCostCapUsd);
  const capPct = Math.round(cap.ratio * 100);

  /**
   * Commits the typed cap, or reverts to the stored one.
   *
   * An unparseable field reverts rather than clamping to `0`: the two are
   * indistinguishable at the DOM (`Number.parseFloat("")` is `NaN` either way),
   * and one of them turns off a feature the user was only editing.
   */
  const commitCap = (): void => {
    if (capDraft === null) return;
    const typed = Number.parseFloat(capDraft);
    setCapDraft(null);
    if (!Number.isFinite(typed)) return;
    const next = normalizeDailyCostCapUsd(typed);
    if (next === settings.dailyCostCapUsd) return;
    void persist(settings, { ...settings, dailyCostCapUsd: next });
  };

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

      <div className="mt-3 flex flex-col gap-2">
        <label
          htmlFor="autocomplete-daily-cap"
          className="block text-sm text-card-foreground"
        >
          {t("settings.autocomplete.dailyCap.label")}
        </label>
        <Input
          id="autocomplete-daily-cap"
          type="number"
          min={0}
          max={MAX_DAILY_COST_CAP_USD}
          step={0.5}
          inputMode="decimal"
          aria-label={t("settings.autocomplete.dailyCap.label")}
          value={capDraft ?? String(settings.dailyCostCapUsd)}
          onChange={(event) => setCapDraft(event.target.value)}
          onBlur={commitCap}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          {t("settings.autocomplete.dailyCap.description", {
            max: MAX_DAILY_COST_CAP_USD,
          })}
        </p>
        {/* Stated because a $0 cap looks like a broken feature otherwise: it
            refuses every request, and nothing else on screen says why. */}
        {settings.dailyCostCapUsd === 0 && (
          <p className="text-xs text-warning">
            {t("settings.autocomplete.dailyCap.zero")}
          </p>
        )}
        {/* The cap only sees spend it can price. A local model bills nothing
            and never moves it, which is a feature of the provider and a hole in
            the budget — the user should hear it from us, not discover it. */}
        <p className="text-xs text-muted-foreground">
          {t("settings.autocomplete.dailyCap.unpricedHint")}
        </p>
      </div>

      {/* The privacy statement is the one thing on this tab a user must not
          skim past, so it is a list of discrete claims at body scale — the
          same treatment as Security's "What this can and can't do" — rather
          than a `text-xs` paragraph competing with the caption below the cap
          input. The order is deliberate: what is sent, what else rides along,
          what metadata it carries, and only then the recommendation. */}
      <div className="mt-3 rounded-md border border-card-control-border bg-background/40 p-3">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
          {PRIVACY_HINT_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>

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

      <p className="mt-1 text-xs text-muted-foreground">
        {cap.spent.kind === "na"
          ? t("autocomplete.cap.unmeasured", {
              cap: formatCurrency(cap.capUsd, "USD"),
            })
          : t("settings.autocomplete.usage.capUsage", {
              used: formatCurrency(cap.spent.value, "USD"),
              cap: formatCurrency(cap.capUsd, "USD"),
              pct: capPct,
            })}
      </p>

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
