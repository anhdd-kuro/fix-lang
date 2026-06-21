/**
 * @file parsers.ts
 * @description PURE, defensive parsers for OpenRouter account-analytics
 * endpoints (#59). Each takes the ALREADY-parsed JSON (`unknown`) — fetch is
 * done by the client, never here — and returns a typed view-model wrapped in a
 * `CardResult` so each card degrades independently. Parsers NEVER throw on
 * shape drift, missing fields, or garbage: malformed input yields
 * `{ ok:false, reason:"parse_error" }`. No electron/fetch/React dependency.
 *
 * The exact OpenRouter response shapes are designed tolerantly around the
 * documented field names; real per-endpoint JSON should be captured against a
 * live account to lock the fixtures (see #59 plan HITL #1 — flagged for QA).
 */

/** Independent per-card result so one failing endpoint doesn't sink the tab. */
export type CardResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unauthorized" | "unavailable" | "parse_error" };

/** Low-balance threshold (USD). Single source of truth (#59 plan HITL #2). */
export const LOW_BALANCE_THRESHOLD_USD = 5;

// ---------------------------------------------------------------------------
// Safe accessors — narrow `unknown` without throwing.
// ---------------------------------------------------------------------------
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
};

const asString = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

/** Unwrap an optional `{ data: ... }` envelope (OpenRouter wraps most payloads). */
const unwrapData = (json: unknown): unknown =>
  isRecord(json) && "data" in json ? json.data : json;

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------
export type Credits = {
  /** Remaining available credit in USD. */
  availableUsd: number;
  totalCreditsUsd: number | null;
  totalUsageUsd: number | null;
  lowBalance: boolean;
};

/**
 * Parse `/api/v1/credits`. Tolerant of either `{ total_credits, total_usage }`
 * (available = credits − usage) or a direct `limit_remaining`/`credits` field.
 */
export const parseCredits = (json: unknown): CardResult<Credits> => {
  const data = unwrapData(json);
  if (!isRecord(data)) {
    return { ok: false, reason: "parse_error" };
  }

  const totalCredits = asNumber(data.total_credits);
  const totalUsage = asNumber(data.total_usage);

  const available: number | null =
    totalCredits !== null && totalUsage !== null
      ? totalCredits - totalUsage
      : // Fall back to a direct remaining field if present.
        (asNumber(data.limit_remaining) ??
        asNumber(data.credits) ??
        asNumber(data.balance));

  if (available === null) {
    return { ok: false, reason: "parse_error" };
  }

  return {
    ok: true,
    data: {
      availableUsd: available,
      totalCreditsUsd: totalCredits,
      totalUsageUsd: totalUsage,
      lowBalance: available < LOW_BALANCE_THRESHOLD_USD,
    },
  };
};

// ---------------------------------------------------------------------------
// Key usage
// ---------------------------------------------------------------------------
export type KeyUsage = {
  label: string | null;
  /** Total usage in USD for this key (lifetime, per `/key`). */
  usageUsd: number;
  /** Spend limit in USD, or null when unlimited. */
  limitUsd: number | null;
  /** True when the key has a hard limit and it has been reached. */
  limitReached: boolean;
};

/**
 * Parse `/api/v1/key`. The endpoint exposes the key's `label`, `usage`, and
 * `limit` (daily/weekly/monthly windows come from `/activity`; this card shows
 * the lifetime usage + limit the `/key` endpoint provides — #59 plan HITL #3).
 */
export const parseKeyUsage = (json: unknown): CardResult<KeyUsage> => {
  const data = unwrapData(json);
  if (!isRecord(data)) {
    return { ok: false, reason: "parse_error" };
  }

  const usage = asNumber(data.usage);
  if (usage === null) {
    return { ok: false, reason: "parse_error" };
  }
  const limit = asNumber(data.limit); // null when unlimited
  const limitRemaining = asNumber(data.limit_remaining);

  return {
    ok: true,
    data: {
      label: asString(data.label),
      usageUsd: usage,
      limitUsd: limit,
      limitReached:
        limit !== null &&
        (limitRemaining !== null ? limitRemaining <= 0 : usage >= limit),
    },
  };
};

// ---------------------------------------------------------------------------
// Activity (per-model, last 30 completed UTC days; 7d slices the last 7)
// ---------------------------------------------------------------------------
export type ActivityModelRow = {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export type Activity = {
  range: "7d" | "30d";
  rows: ActivityModelRow[];
};

/** UTC day string "YYYY-MM-DD" for a Date. */
const utcDayKey = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Parse `/api/v1/activity` (array of per-day per-model rows). Aggregates per
 * model within the selected UTC-day window: "30d" = all returned rows (already
 * 30-day capped by the API), "7d" = only rows whose `date` is within the last 7
 * completed UTC days relative to `now`. `now` injected for deterministic tests.
 */
export const parseActivity = (
  json: unknown,
  range: "7d" | "30d",
  now: Date = new Date()
): CardResult<Activity> => {
  const data = unwrapData(json);
  if (!Array.isArray(data)) {
    return { ok: false, reason: "parse_error" };
  }

  // 7d window: keep rows with date >= (today UTC − 7 days).
  const cutoffKey =
    range === "7d"
      ? utcDayKey(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))
      : null;

  const byModel = new Map<string, ActivityModelRow>();
  for (const raw of data) {
    if (!isRecord(raw)) {
      continue; // skip garbage rows, never throw
    }
    if (cutoffKey !== null) {
      const date = asString(raw.date);
      // String compare works for "YYYY-MM-DD" lexicographic ordering.
      if (date === null || date < cutoffKey) {
        continue;
      }
    }
    const model = asString(raw.model) ?? asString(raw.model_permaslug);
    if (model === null) {
      continue;
    }
    const acc =
      byModel.get(model) ??
      {
        model,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
      };
    acc.requests += asNumber(raw.requests) ?? 0;
    acc.promptTokens += asNumber(raw.prompt_tokens) ?? 0;
    acc.completionTokens += asNumber(raw.completion_tokens) ?? 0;
    acc.costUsd += asNumber(raw.usage) ?? asNumber(raw.cost) ?? 0;
    byModel.set(model, acc);
  }

  const rows = [...byModel.values()].sort((a, b) => b.requests - a.requests);
  return { ok: true, data: { range, rows } };
};

// ---------------------------------------------------------------------------
// Provisioning keys (count enabled keys; read-only — no create/delete)
// ---------------------------------------------------------------------------
export type EnabledKeys = {
  enabledCount: number;
  totalCount: number;
};

/**
 * Parse the provisioning-keys list endpoint. Counts keys that are NOT disabled
 * (`disabled` falsy). Tolerant of `{ data: [...] }` or a bare array.
 */
export const parseProvisioningKeys = (
  json: unknown
): CardResult<EnabledKeys> => {
  const data = unwrapData(json);
  if (!Array.isArray(data)) {
    return { ok: false, reason: "parse_error" };
  }
  let enabled = 0;
  for (const raw of data) {
    if (!isRecord(raw)) {
      continue;
    }
    // A key is enabled unless explicitly disabled.
    if (raw.disabled !== true) {
      enabled += 1;
    }
  }
  return { ok: true, data: { enabledCount: enabled, totalCount: data.length } };
};
