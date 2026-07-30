/**
 * @file providerKeyShapes.ts
 * @description Classifies a provider credential by its PREFIX alone, so a key
 * belonging to one provider can be refused before it is written into another
 * provider's slot.
 *
 * Why this exists: every secret slot is provider-scoped on disk, yet nothing
 * checked that the pasted VALUE belonged to that provider. Storing an
 * `sk-admin-…` OpenAI key in OpenRouter's provisioning slot succeeded, the card
 * then reported "Key set" (existence is all `hasProfileSecret` can see without
 * decrypting), and the only symptom was a later opaque 401 on an account the key
 * has no business reading.
 *
 * Electron-free and secret-free: it reads a prefix and returns a label. Nothing
 * here logs, stores, or echoes the key.
 */
import type { ProviderId } from "~/features/providers/shared/providers";

/**
 * The two credential slots a provider can own. Declared here rather than
 * imported from `profileSecretStore` so this module stays Electron-free; the
 * store's `SecretKind` is the same union.
 */
export type KeySlotKind = "api" | "provisioning";

/**
 * `unrecognized` is a first-class answer, not a failure: a bare `sk-…` is a
 * legacy OpenAI key AND anything a local provider accepts, and LM Studio takes
 * arbitrary strings. Only positively-identified shapes are ever refused, so a
 * format this table has not seen can never block a user with a valid key.
 */
export type ProviderKeyShape =
  | "openrouter"
  | "openai-project"
  | "openai-admin"
  | "unrecognized";

/** Prefixes in match order — `sk-or-` must be tested before any bare `sk-`. */
const SHAPE_PREFIXES: readonly { prefix: string; shape: ProviderKeyShape }[] = [
  { prefix: "sk-or-", shape: "openrouter" },
  { prefix: "sk-proj-", shape: "openai-project" },
  { prefix: "sk-admin-", shape: "openai-admin" },
];

export const describeKeyShape = (raw: string): ProviderKeyShape =>
  SHAPE_PREFIXES.find(({ prefix }) => raw.trim().startsWith(prefix))?.shape ??
  "unrecognized";

/** Human-readable prefix hint for the rejection message, per slot. */
const EXPECTED_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  "openrouter:api": "sk-or-v1-",
  "openrouter:provisioning": "sk-or-v1-",
  "openai:api": "sk-proj-",
  "openai:provisioning": "sk-admin-",
});

/**
 * Shapes that cannot work in a given slot. Derived per slot rather than per
 * provider: OpenAI's admin endpoints reject a project key and its chat
 * endpoints reject an admin key, so both wrong-slot-same-account cases fail as
 * silently as a wrong-provider paste does.
 */
const FOREIGN_SHAPES: Readonly<Record<string, readonly ProviderKeyShape[]>> =
  Object.freeze({
    "openrouter:api": ["openai-project", "openai-admin"],
    "openrouter:provisioning": ["openai-project", "openai-admin"],
    "openai:api": ["openrouter", "openai-admin"],
    "openai:provisioning": ["openrouter", "openai-project"],
  });

export type KeyShapeMismatch = {
  shape: ProviderKeyShape;
  /** Prefix the slot does expect, for the user-facing message. */
  expectedPrefix: string;
};

/**
 * Reports a key that provably belongs elsewhere, or `null` when the value is
 * acceptable for the slot. Slots with no entry (LM Studio's optional local key)
 * accept anything by design.
 */
export const findKeyShapeMismatch = (
  provider: ProviderId,
  kind: KeySlotKind,
  raw: string,
): KeyShapeMismatch | null => {
  const slot = `${provider}:${kind}`;
  const foreign = FOREIGN_SHAPES[slot];
  if (!foreign) return null;

  const shape = describeKeyShape(raw);
  if (!foreign.includes(shape)) return null;

  return { shape, expectedPrefix: EXPECTED_PREFIX[slot] ?? "" };
};
