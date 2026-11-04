/**
 * @file providerKeyFamilies.ts
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
export type ProviderKeyFamily =
  | "openrouter"
  | "openai-project"
  | "openai-admin"
  | "anthropic"
  | "unrecognized";

/** Prefixes in match order — `sk-or-` must be tested before any bare `sk-`. */
const KEY_FAMILY_PREFIXES: readonly {
  prefix: string;
  family: ProviderKeyFamily;
}[] = [
  { prefix: "sk-or-", family: "openrouter" },
  { prefix: "sk-proj-", family: "openai-project" },
  { prefix: "sk-admin-", family: "openai-admin" },
  // Covers both `sk-ant-api…` request keys and `sk-ant-admin…` admin keys:
  // neither belongs in any other provider's slot, and FixLang stores only the
  // request kind, so one shape is enough to refuse a foreign paste.
  { prefix: "sk-ant-", family: "anthropic" },
];

/**
 * Log context field that carries a key's family label. The name predates the
 * "family" vocabulary and stays byte-identical so existing JSONL logs and
 * Logs-tab searches keep matching.
 */
export const KEY_FAMILY_LOG_FIELD = "keyShape";

export const describeKeyFamily = (raw: string): ProviderKeyFamily =>
  KEY_FAMILY_PREFIXES.find(({ prefix }) => raw.trim().startsWith(prefix))
    ?.family ?? "unrecognized";

/** Human-readable prefix hint for the rejection message, per slot. */
const EXPECTED_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  "openrouter:api": "sk-or-v1-",
  "openrouter:provisioning": "sk-or-v1-",
  "openai:api": "sk-proj-",
  "openai:provisioning": "sk-admin-",
  "anthropic:api": "sk-ant-",
});

/**
 * Shapes that cannot work in a given slot. Derived per slot rather than per
 * provider: OpenAI's admin endpoints reject a project key and its chat
 * endpoints reject an admin key, so both wrong-slot-same-account cases fail as
 * silently as a wrong-provider paste does.
 */
const FOREIGN_KEY_FAMILIES: Readonly<
  Record<string, readonly ProviderKeyFamily[]>
> = Object.freeze({
  "openrouter:api": ["openai-project", "openai-admin", "anthropic"],
  "openrouter:provisioning": ["openai-project", "openai-admin", "anthropic"],
  "openai:api": ["openrouter", "openai-admin", "anthropic"],
  "openai:provisioning": ["openrouter", "openai-project", "anthropic"],
  "anthropic:api": ["openrouter", "openai-project", "openai-admin"],
});

export type KeyFamilyMismatch = {
  family: ProviderKeyFamily;
  /** Prefix the slot does expect, for the user-facing message. */
  expectedPrefix: string;
};

/**
 * Reports a key that provably belongs elsewhere, or `null` when the value is
 * acceptable for the slot. Slots with no entry (LM Studio's optional local key)
 * accept anything by design.
 */
export const findKeyFamilyMismatch = (
  provider: ProviderId,
  kind: KeySlotKind,
  raw: string,
): KeyFamilyMismatch | null => {
  const slot = `${provider}:${kind}`;
  const foreign = FOREIGN_KEY_FAMILIES[slot];
  if (!foreign) return null;

  const family = describeKeyFamily(raw);
  if (!foreign.includes(family)) return null;

  return { family, expectedPrefix: EXPECTED_PREFIX[slot] ?? "" };
};
