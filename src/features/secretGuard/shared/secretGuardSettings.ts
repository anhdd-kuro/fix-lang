/**
 * @file secretGuardSettings.ts
 * @description The secret guard's stored settings shape, its normalizer, and
 * the payload schema both IPC boundaries validate against.
 *
 * Pure and electron-free — shared by main, preload and renderer.
 */
import { z } from "zod";

/**
 * ONE enum rather than two booleans: masking suppresses the confirm dialog, so
 * `confirm && mask` is an impossible state, and encoding an impossible state
 * means maintaining a resolver for it forever.
 */
const SecretGuardModeSchema = z.enum(["off", "confirm", "mask"]);

export type SecretGuardMode = z.infer<typeof SecretGuardModeSchema>;

export const SECRET_GUARD_MODES: readonly SecretGuardMode[] =
  SecretGuardModeSchema.options;

export type SecretGuardSettings = {
  mode: SecretGuardMode;
  /** The one rule with a real false-positive rate. Opt-in. */
  highEntropyRule: boolean;
};

export const DEFAULT_SECRET_GUARD_SETTINGS: SecretGuardSettings = {
  mode: "confirm",
  highEntropyRule: false,
};

/**
 * Stored JSON → {@link SecretGuardSettings}, field by field.
 *
 * Junk normalizes to `"confirm"` — fail SAFE, because junk must never silently
 * disable a privacy guard. Junk entropy normalizes to `false` — fail QUIET,
 * because only an explicit opt-in should switch on the rule that produces false
 * positives. A non-object reads as nothing stored, so it gets both defaults.
 */
const StoredSecretGuardSettingsSchema = z
  .object({
    mode: SecretGuardModeSchema.catch(DEFAULT_SECRET_GUARD_SETTINGS.mode),
    highEntropyRule: z.boolean().catch(false),
  })
  .catch(() => ({ ...DEFAULT_SECRET_GUARD_SETTINGS }));

/** Coerces stored JSON into {@link SecretGuardSettings}; never throws. */
export const normalizeSecretGuardSettings =
  StoredSecretGuardSettingsSchema.parse;

/**
 * Exactly the payloads `normalizeSecretGuardSettings` leaves unchanged — what
 * the main handler and the preload bridge each accept, independently. A
 * predicate that accepted something the normalizer then rewrote would report
 * a successful write of settings the user never chose: `highEntropyRule`
 * therefore must be a real boolean, while `false` and `mode: "off"` stay legal
 * because they are choices, not malformed input. Extra keys are tolerated
 * (the store's normalizer drops them).
 */
export const SecretGuardSettingsPayloadSchema = z.looseObject({
  mode: SecretGuardModeSchema,
  highEntropyRule: z.boolean(),
});
