/**
 * @file autocompleteSettings.ts
 * @description Autocomplete's stored settings shape and its normalizer.
 *
 * Electron-free — shared by main, preload, and renderer.
 */
import {
  isAutocompleteScopeMode,
  normalizeScopedApps,
  type AutocompleteScopeMode,
} from "~/features/autocomplete/shared/autocompleteScope";


export type AutocompleteSettings = {
  /** Absent or non-boolean reads as `false`; only a stored `true` enables. */
  enabled: boolean;
  /**
   * `""` means "use the Ask AI preset's model". Otherwise a composite model ref
   * (`<providerId>::<rawModelId>`).
   */
  model: string;
  /**
   * Today's spend ceiling in USD. `0` means "spend nothing" — a real setting,
   * and the reason the input never persists an empty field as a number.
   *
   * WHAT THIS CAP CAN AND CANNOT SEE, because the difference decides whether it
   * fires at all. It is compared against the day's `estimatedCostUsd`, which
   * sums PRICED responses only, and a price exists only after a response comes
   * back. So:
   *
   * - it is a TRAILING stop. Spend is booked when a reply lands, so the request
   *   that crosses the line is the one already paid for; the cap refuses the
   *   NEXT one. In-flight requests can overshoot it by the burst the rate
   *   limiter allows.
   * - a LOCAL provider (Ollama, LM Studio) genuinely costs `$0`, so it never
   *   moves this number and this cap never fires for it — which is correct, and
   *   is also why `DAILY_REQUEST_BACKSTOP` in `main/service.ts` still exists.
   * - a provider whose model `computeCost` cannot price bills real money and
   *   still records `$0` (counted in `unpricedResponses`). The cap cannot see
   *   that spend. The backstop is what bounds it.
   *
   * So: a budget for the priced case, never the runaway stop. Read
   * `DAILY_REQUEST_BACKSTOP` for that half.
   */
  dailyCostCapUsd: number;
  scopeMode: AutocompleteScopeMode;
  /** Lower-cased bundle ids; `scopeMode` decides whether they allow or refuse. */
  scopedApps: string[];
  /** Provider id consented to for system-wide reach, or `""`. Never a boolean. */
  cloudScopeConsent: string;
};

/**
 * Run independently at both IPC boundaries, defined once so they cannot drift.
 * Two copies meant a new field could be added to one only, and the failure is
 * silent: the loose side passes a reply through with `undefined` fields, React
 * writes them back, the strict side rejects, and settings become unsaveable.
 *
 * `Number.isFinite` matters — `NaN`/`Infinity` are `number` and make the cap
 * comparison always-false.
 */
export const isAutocompleteSettingsShape = (
  value: unknown,
): value is AutocompleteSettings => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" &&
    typeof record.model === "string" &&
    typeof record.dailyCostCapUsd === "number" &&
    Number.isFinite(record.dailyCostCapUsd) &&
    // Rejected, not coerced: a sender disagreeing with us about the modes must
    // not silently store `allowlist` behind a UI that says otherwise.
    isAutocompleteScopeMode(record.scopeMode) &&
    Array.isArray(record.scopedApps) &&
    record.scopedApps.every((entry) => typeof entry === "string") &&
    typeof record.cloudScopeConsent === "string"
  );
};

export const AUTOCOMPLETE_INHERIT_ASK_MODEL = "";

/** Default daily spend ceiling in USD. */
export const DEFAULT_DAILY_COST_CAP_USD = 5;

/**
 * Highest cap the settings input will store. Not a safety property — the store
 * is the user's own — but a typo of `500` for `5.00` is a hundredfold budget
 * with nothing on screen to question it, and no autocomplete day has a
 * legitimate reason to run past this.
 */
export const MAX_DAILY_COST_CAP_USD = 100;

/**
 * Clamps a stored cap into `[0, MAX_DAILY_COST_CAP_USD]`.
 *
 * Anything unreadable — absent, NaN, Infinity, a string — falls back to the
 * DEFAULT rather than to `0`: a corrupt field must not silently turn the
 * feature into "refuse everything", which looks exactly like a broken feature.
 * A negative number is the one case that clamps to `0`, because a user who
 * typed one meant "stop spending", not "spend the default".
 */
export const normalizeDailyCostCapUsd = (raw: unknown): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_DAILY_COST_CAP_USD;
  return Math.min(MAX_DAILY_COST_CAP_USD, Math.max(0, raw));
};

/**
 * Coerces stored JSON into {@link AutocompleteSettings}.
 *
 * Default-OFF lives here rather than in a migration pass: an install that has
 * never seen this feature stores nothing under `settingsAutocomplete`, so
 * `enabled` must read `false` from absent input — existing users must not be
 * upgraded into a paid autocomplete provider they never opted into. The ajv
 * `default` on the schema node cannot carry that alone — `useDefaults` injects
 * the *object* default only when the whole node is missing, so a stored object
 * that happens to omit just `enabled` would never receive it. This function is
 * the load-bearing one.
 *
 * Junk also reads as `false`, for the same reason: only an explicit `true`
 * turns the feature on.
 *
 * The scope fields fail CLOSED, inverting the cap rule above deliberately: a
 * corrupt cap reading `0` merely looks broken, whereas a corrupt `scopeMode`
 * reading `denylist` uploads every keystroke in every app.
 */
export const normalizeAutocompleteSettings = (raw: unknown): AutocompleteSettings => {
  const value = (raw ?? {}) as Partial<Record<keyof AutocompleteSettings, unknown>>;
  return {
    enabled: value.enabled === true,
    model: typeof value.model === "string" ? value.model.trim() : AUTOCOMPLETE_INHERIT_ASK_MODEL,
    dailyCostCapUsd: normalizeDailyCostCapUsd(value.dailyCostCapUsd),
    scopeMode: isAutocompleteScopeMode(value.scopeMode) ? value.scopeMode : "allowlist",
    scopedApps: normalizeScopedApps(value.scopedApps),
    cloudScopeConsent:
      typeof value.cloudScopeConsent === "string" ? value.cloudScopeConsent.trim() : "",
  };
};
