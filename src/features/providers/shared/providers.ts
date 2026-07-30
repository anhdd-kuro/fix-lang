/**
 * @file providers.ts
 * @description Provider registry: identity, ordering, credential requirements,
 * and the cached `Model` shape.
 *
 * Imported by main, preload, and renderer alike, so it must never depend on
 * Electron, its store binding, or anything under the app's stores directory —
 * such a dependency breaks `bun run build`, not the tests.
 */

export const PROVIDER_IDS = Object.freeze([
  "openai",
  "openrouter",
  "bedrock",
  "ollama",
  "lmstudio",
] as const);
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);

/** A tuple holding every member of `T` exactly once, so a new provider fails the build. */
type Permutation<T extends string, Rest extends string = T> = [T] extends [never]
  ? []
  : { [K in Rest]: [K, ...Permutation<Exclude<T, K>>] }[Rest];

/**
 * Display order AND `resolveModelRef` precedence for bare ids — reordering it
 * reroutes every un-migrated bare id to a different provider, key and price.
 */
export const PROVIDER_ORDER: readonly ProviderId[] = Object.freeze([
  "openai",
  "openrouter",
  "bedrock",
  "ollama",
  "lmstudio",
] satisfies Permutation<ProviderId>);

/** Diagnostics only — user-facing provider names come from the i18n catalogs via `t()`. */
export const PROVIDER_LOG_LABELS: Readonly<Record<ProviderId, string>> = Object.freeze({
  openai: "OpenAI",
  openrouter: "OpenRouter",
  bedrock: "AWS Bedrock",
  ollama: "Ollama",
  lmstudio: "LM Studio",
});

export const PROVIDER_REQUIRES_API_KEY: Readonly<Record<ProviderId, boolean>> = Object.freeze({
  openai: true,
  openrouter: true,
  bedrock: true,
  ollama: false,
  lmstudio: false,
});

/**
 * Whether the provider can store an API key in safeStorage. Required-key
 * providers are a subset; LM Studio supports an optional key without requiring
 * one for connect.
 */
export const PROVIDER_SUPPORTS_API_KEY: Readonly<Record<ProviderId, boolean>> = Object.freeze({
  openai: true,
  openrouter: true,
  bedrock: true,
  ollama: false,
  lmstudio: true,
});

/**
 * Whether the provider has an admin-scoped key distinct from its request key —
 * OpenRouter's provisioning key, OpenAI's Admin API key. Both are read only in
 * the main process, and only for account usage/billing reads.
 */
export const PROVIDER_SUPPORTS_PROVISIONING_KEY: Readonly<Record<ProviderId, boolean>> =
  Object.freeze({
    openai: true,
    openrouter: true,
    bedrock: false,
    ollama: false,
    lmstudio: false,
  });

/**
 * Narrowing guard for every admin-key boundary (IPC payloads, settings cards).
 * Goes through `isProviderId` first so an inherited key like `"constructor"`
 * cannot read truthy off the lookup map's prototype.
 */
export const supportsAdminKey = (value: unknown): value is ProviderId =>
  isProviderId(value) && PROVIDER_SUPPORTS_PROVISIONING_KEY[value];

export type Model = {
  id: string;
  name: string;
  created: number;
  /** Explicit source — never guess this from the id shape; ids collide across providers. */
  provider?: ProviderId;
  pricing?: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
    input_cache_read: string;
    input_cache_write: string;
    web_search: string;
    internal_reasoning: string;
  };
  local?: {
    path: string;
    size?: number;
    parameters?: {
      temperature?: number;
      top_p?: number;
      repeat_penalty?: number;
      [key: string]: unknown;
    };
  };
};

export const isModelForProvider = (model: Model, provider: ProviderId): boolean =>
  provider === "ollama"
    ? model.provider === "ollama" || model.local !== undefined
    : model.provider === provider ||
      (provider === "openrouter" && model.provider === undefined && !model.local);

/** Use this over `m.provider === provider`, which silently drops untagged legacy entries. */
export const modelsForProvider = (models: readonly Model[], provider: ProviderId): Model[] =>
  models.filter((model) => isModelForProvider(model, provider));

/** Empty groups are kept so the caller decides whether to render a heading for them. */
export const groupModelsByProvider = (
  models: readonly Model[],
  order: readonly ProviderId[] = PROVIDER_ORDER,
): { provider: ProviderId; models: Model[] }[] =>
  order.map((provider) => ({ provider, models: modelsForProvider(models, provider) }));

export const providerOfModel = (model: Model): ProviderId => model.provider ?? "openrouter";

/**
 * `provider` is re-validated despite its type: values reach here from a
 * user-editable config file, and an inherited key like `"constructor"` would
 * otherwise read truthy off the lookup maps' prototype.
 */
export const isProviderConfigured = (
  provider: ProviderId,
  state: { hasApiKey: boolean; explicitlyEnabled: boolean },
): boolean =>
  isProviderId(provider) &&
  (PROVIDER_REQUIRES_API_KEY[provider] ? state.hasApiKey : state.explicitlyEnabled);

export const sanitizeEnabledProviders = (raw: unknown): ProviderId[] => {
  if (!Array.isArray(raw)) return [];
  const known = new Set<ProviderId>();
  for (const value of raw) {
    if (isProviderId(value)) known.add(value);
  }
  return PROVIDER_ORDER.filter((provider) => known.has(provider));
};
