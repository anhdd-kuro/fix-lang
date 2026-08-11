/**
 * @file secretGuardSettings.ts
 * @description The secret guard's stored settings shape and its normalizer.
 *
 * Pure and electron-free — shared by main, preload and renderer.
 */

/**
 * ONE enum rather than two booleans: masking suppresses the confirm dialog, so
 * `confirm && mask` is an impossible state, and encoding an impossible state
 * means maintaining a resolver for it forever.
 */
export type SecretGuardMode = "off" | "confirm" | "mask";

export const SECRET_GUARD_MODES: readonly SecretGuardMode[] = ["off", "confirm", "mask"];

export type SecretGuardSettings = {
  mode: SecretGuardMode;
  /** The one rule with a real false-positive rate. Opt-in. */
  highEntropyRule: boolean;
};

export const DEFAULT_SECRET_GUARD_SETTINGS: SecretGuardSettings = {
  mode: "confirm",
  highEntropyRule: false,
};

const isSecretGuardMode = (value: unknown): value is SecretGuardMode =>
  SECRET_GUARD_MODES.includes(value as SecretGuardMode);

/**
 * Coerces stored JSON into {@link SecretGuardSettings}.
 *
 * Junk normalizes to `"confirm"` — fail SAFE, because junk must never silently
 * disable a privacy guard. Junk entropy normalizes to `false` — fail QUIET,
 * because only an explicit opt-in should switch on the rule that produces false
 * positives.
 */
export const normalizeSecretGuardSettings = (raw: unknown): SecretGuardSettings => {
  const value = (raw ?? {}) as Partial<Record<keyof SecretGuardSettings, unknown>>;
  return {
    mode: isSecretGuardMode(value.mode) ? value.mode : DEFAULT_SECRET_GUARD_SETTINGS.mode,
    highEntropyRule: value.highEntropyRule === true,
  };
};
