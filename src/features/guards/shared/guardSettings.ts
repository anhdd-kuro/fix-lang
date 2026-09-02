/**
 * @file guardSettings.ts
 * @description Selection-guard settings shape and its normalizer. Backs the
 * stale-clipboard age guard, the selection size cap, and the frontmost-app
 * deny-list — electron-free, shared by main, preload, and renderer.
 */

export type SelectionGuardSettings = {
  /** Seconds. `0` disables the age guard AND the background clipboard poll. */
  clipboardMaxAgeSeconds: number;
  /** Characters. `0` disables the confirm-before-send prompt. */
  maxSelectionChars: number;
  /** Lowercased, trimmed, deduped bundle ids. */
  deniedBundleIds: string[];
};

export const DEFAULT_CLIPBOARD_MAX_AGE_SECONDS = 5;
export const DEFAULT_MAX_SELECTION_CHARS = 20_000;

export const DEFAULT_DENIED_BUNDLE_IDS = [
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.apple.keychainaccess",
] as const;

export const MAX_DENIED_BUNDLE_IDS = 200;

/**
 * Aligned with `RAW_LOG_LIMIT` (120) in `~/main/accessibility/activeApp.ts`,
 * not `MAX_APP_NAME_LENGTH` (64): a denied bundle id ends up in the same
 * place that constant protects — an untrusted-length identifier reaching a
 * log line (`verdict.bundleId` in `logger.warn(..., { deniedBundleId })`) —
 * rather than a human-facing display name, so it takes the log-safety
 * precedent instead of the display-name one.
 */
export const MAX_BUNDLE_ID_LENGTH = 120;

/**
 * Same class of control characters `activeApp.ts` strips from a frontmost
 * app's `name` — they cannot appear in a real bundle id and would otherwise
 * ride an unbounded value into a JSONL log line untouched.
 */
// eslint-disable-next-line no-control-regex -- rejecting control chars is the point
const CONTROL_CHARACTERS_PATTERN = /[\x00-\x1f\x7f-\x9f]/;

/**
 * A finite number normalizes to a floored, non-negative integer; anything
 * else (`NaN`, `Infinity`, a string, `null`, an object, …) falls back to
 * `fallback` rather than `0` — junk input must never silently disable a
 * safety rail. An explicit `0` still passes through unchanged, since that is
 * the documented way to disable a guard on purpose.
 */
const normalizeNonNegativeInt = (raw: unknown, fallback: number): number => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.floor(raw));
};

/**
 * The one canonicalisation rule for a bundle id, exported so any consumer
 * (a `set-selection-guards` IPC validator, a renderer predicate) can ask
 * "is this a valid, canonical bundle id?" without re-deriving the rule.
 * Rejects non-strings, empty-after-trim, over-length, and control-character
 * entries outright rather than coercing them.
 */
export const normalizeBundleId = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_BUNDLE_ID_LENGTH) return null;
  if (CONTROL_CHARACTERS_PATTERN.test(trimmed)) return null;
  return trimmed;
};

/**
 * The one deny-list membership rule, exported so a renderer chip and an IPC
 * validator can both ask "is this bundle id blocked?" against the exact
 * comparison `evaluateSelectionGuards` enforces, rather than each writing
 * its own `.includes()` that silently diverges on a non-canonical input.
 */
export const isBundleIdDenied = (
  bundleId: string | null,
  deniedBundleIds: readonly string[],
): boolean => {
  const normalized = normalizeBundleId(bundleId);
  if (normalized === null) return false;
  return deniedBundleIds.some((denied) => normalizeBundleId(denied) === normalized);
};

/**
 * A non-array `raw` (missing field, legacy shape, junk) seeds the defaults.
 * An array is taken as-is, including `[]`: the seed values live only in the
 * store's `defaults`, so re-adding them here would resurrect a bundle id the
 * user deliberately unblocked on every normalize.
 */
const normalizeDeniedBundleIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [...DEFAULT_DENIED_BUNDLE_IDS];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const bundleId = normalizeBundleId(entry);
    if (bundleId === null || seen.has(bundleId)) continue;
    seen.add(bundleId);
    result.push(bundleId);
    if (result.length >= MAX_DENIED_BUNDLE_IDS) break;
  }
  return result;
};

export const normalizeSelectionGuardSettings = (raw: unknown): SelectionGuardSettings => {
  const value = (raw ?? {}) as Partial<Record<keyof SelectionGuardSettings, unknown>>;
  return {
    clipboardMaxAgeSeconds: normalizeNonNegativeInt(
      value.clipboardMaxAgeSeconds,
      DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
    ),
    maxSelectionChars: normalizeNonNegativeInt(value.maxSelectionChars, DEFAULT_MAX_SELECTION_CHARS),
    deniedBundleIds: normalizeDeniedBundleIds(value.deniedBundleIds),
  };
};
