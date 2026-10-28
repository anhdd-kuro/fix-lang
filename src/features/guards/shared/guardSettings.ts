/**
 * @file guardSettings.ts
 * @description Selection-guard settings shape and its normalizer. Backs the
 * stale-clipboard age guard, the selection size cap, and the frontmost-app
 * deny-list — electron-free, shared by main, preload, and renderer.
 */
import { z } from "zod";

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
// oxlint-disable-next-line no-control-regex -- rejecting control chars is the point
const CONTROL_CHARACTERS_PATTERN = /[\x00-\x1f\x7f-\x9f]/;

/**
 * A finite number normalizes to a floored, non-negative integer; anything
 * else (`NaN`, `Infinity`, a string, `null`, an object, …) falls back to
 * `fallback` rather than `0` — junk input must never silently disable a
 * safety rail. An explicit `0` still passes through unchanged, since that is
 * the documented way to disable a guard on purpose. (`z.number()` accepts
 * exactly the finite numbers.)
 */
const storedNonNegativeIntOr = (fallback: number) =>
  z
    .number()
    .transform((value) => Math.max(0, Math.floor(value)))
    .catch(fallback);

/**
 * The one canonicalisation rule for a bundle id, exported so any consumer
 * (a `set-selection-guards` IPC validator, a renderer predicate) can ask
 * "is this a valid, canonical bundle id?" without re-deriving the rule.
 * Rejects non-strings, empty-after-trim, over-length, and control-character
 * entries outright rather than coercing them.
 */
export const normalizeBundleId = (raw: string | null): string | null => {
  // Re-checked at runtime, not trusted from the type: callers pass values
  // that crossed IPC, and a non-string must read as "no id", never throw.
  const parsed = z.string().safeParse(raw);
  if (!parsed.success) return null;
  const trimmed = parsed.data.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > MAX_BUNDLE_ID_LENGTH)
    return null;
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
  return deniedBundleIds.some(
    (denied) => normalizeBundleId(denied) === normalized,
  );
};

/** Drops invalid (`null`) and duplicate ids, keeping at most the cap. */
const uniqueCappedBundleIds = (
  bundleIds: readonly (string | null)[],
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const bundleId of bundleIds) {
    if (bundleId === null || seen.has(bundleId)) continue;
    seen.add(bundleId);
    result.push(bundleId);
    if (result.length >= MAX_DENIED_BUNDLE_IDS) break;
  }
  return result;
};

/**
 * A non-array value (missing field, legacy shape, junk) seeds the defaults.
 * An array is taken as-is, including `[]`: the seed values live only in the
 * store's `defaults`, so re-adding them here would resurrect a bundle id the
 * user deliberately unblocked on every normalize. Within an array, anything
 * that is not a valid bundle-id string (holes included) is skipped.
 */
const StoredDeniedBundleIdsSchema = z
  .array(z.string().transform(normalizeBundleId).catch(null))
  .transform(uniqueCappedBundleIds)
  .catch(() => [...DEFAULT_DENIED_BUNDLE_IDS]);

/**
 * Stored JSON → {@link SelectionGuardSettings}, field by field, each junk
 * field on its own DEFAULT. A non-object reads as nothing stored.
 */
const StoredSelectionGuardSettingsSchema = z
  .object({
    clipboardMaxAgeSeconds: storedNonNegativeIntOr(
      DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
    ),
    maxSelectionChars: storedNonNegativeIntOr(DEFAULT_MAX_SELECTION_CHARS),
    deniedBundleIds: StoredDeniedBundleIdsSchema,
  })
  .catch(() => ({
    clipboardMaxAgeSeconds: DEFAULT_CLIPBOARD_MAX_AGE_SECONDS,
    maxSelectionChars: DEFAULT_MAX_SELECTION_CHARS,
    deniedBundleIds: [...DEFAULT_DENIED_BUNDLE_IDS],
  }));

/** Coerces stored JSON into {@link SelectionGuardSettings}; never throws. */
export const normalizeSelectionGuardSettings =
  StoredSelectionGuardSettingsSchema.parse;

/**
 * A number must be a non-negative INTEGER, not merely finite. Every finite
 * value that fails this (a negative number, a fractional one) is exactly the
 * class the stored-settings normalizer silently floors/clamps to `0` — which
 * would otherwise turn a rail off with no signal that the write was anything
 * but accepted. An integer `x >= 0` is guaranteed to survive that normalizer
 * unchanged (`Math.max(0, Math.floor(x)) === x`). An explicit `0` passes — it
 * is the documented, deliberate way to disable a guard. `Number.isInteger`
 * rather than `.int()`: the latter also caps at the safe-integer range.
 */
const NonNegativeIntegerSettingSchema = z
  .number()
  .refine((value) => Number.isInteger(value) && value >= 0);

/**
 * The raw `.length` bound runs BEFORE `normalizeBundleId` (which trims and
 * lowercases) and aborts the parse, so a huge string is rejected without the
 * allocation that string would otherwise cost — without `abort`, zod would
 * still run the refine after the bound failed.
 */
const DeniedBundleIdPayloadEntrySchema = z
  .string()
  .max(MAX_BUNDLE_ID_LENGTH, { abort: true })
  .refine((entry) => normalizeBundleId(entry) !== null);

/**
 * Valid only if every entry would survive `normalizeBundleId` as a real entry
 * and the list is no longer than the store will ever persist. Built on
 * `Array#every`, which skips holes, rather than on `z.array`, which would read
 * them as `undefined` and refuse; the array itself is the parse result.
 */
const DeniedBundleIdsPayloadSchema = z.custom<string[]>(
  (value) =>
    Array.isArray(value) &&
    value.length <= MAX_DENIED_BUNDLE_IDS &&
    value.every(
      (entry) => DeniedBundleIdPayloadEntrySchema.safeParse(entry).success,
    ),
);

/**
 * What `set-selection-guards` accepts in main and what the preload bridge
 * accepts in both directions — each side validates independently against
 * this one rule. A malformed payload is REJECTED field by field rather than
 * coerced into defaults: coercing would let a buggy renderer silently disable
 * a safety rail instead of failing the write loudly. Extra keys are tolerated
 * (the store's normalizer drops them).
 */
export const SelectionGuardSettingsPayloadSchema = z.looseObject({
  clipboardMaxAgeSeconds: NonNegativeIntegerSettingSchema,
  maxSelectionChars: NonNegativeIntegerSettingSchema,
  deniedBundleIds: DeniedBundleIdsPayloadSchema,
});
