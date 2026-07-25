/**
 * @file providers.ts
 * @description Electron-free provider registry: provider identity, card/group
 * ordering, display labels, and per-provider credential requirements, plus the
 * cached `Model` shape and its provider-matching rules.
 *
 * This module is imported by the main process, preload, and renderer alike —
 * it must never depend on the Electron runtime, its store binding, or any
 * module under the app's stores directory. A stray Electron dependency here
 * breaks `bun run build`, not the tests.
 */

export const PROVIDER_IDS = ["openai", "openrouter", "ollama"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);

/** Card + group display order used everywhere providers are listed to a user. */
export const PROVIDER_ORDER: readonly ProviderId[] = ["openai", "openrouter", "ollama"];

/**
 * Display fallback only — real UI strings are routed through `t()` (see
 * `SettingGeneral.tsx`'s `PROVIDER_LABEL_KEYS`). This map exists for contexts
 * with no i18n context (e.g. logs, non-React code).
 */
export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

/** Ollama runs locally and needs no API key; the other two do. */
export const PROVIDER_REQUIRES_API_KEY: Readonly<Record<ProviderId, boolean>> = {
  openai: true,
  openrouter: true,
  ollama: false,
};

/** Only OpenRouter has a separate provisioning key (for model discovery/billing). */
export const PROVIDER_SUPPORTS_PROVISIONING_KEY: Readonly<Record<ProviderId, boolean>> = {
  openai: false,
  openrouter: true,
  ollama: false,
};

export type Model = {
  id: string;
  name: string;
  created: number;
  /**
   * Explicit source. Note the direction of the invariant: a raw model id must
   * never be used to *guess* which provider it came from (id shapes collide
   * across providers) — but a composite model ref (`<providerId>::<rawId>`)
   * does the opposite, making the provider explicit in the string itself.
   * This field is the one place that explicit source is recorded on a cached
   * model.
   */
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

/** Whether a cached model is available from the named provider. */
export const isModelForProvider = (model: Model, provider: ProviderId): boolean =>
  provider === "ollama"
    ? model.provider === "ollama" || model.local !== undefined
    : model.provider === provider ||
      (provider === "openrouter" && model.provider === undefined && !model.local);

/**
 * Provider a cached model belongs to. Falls back to `"openrouter"` when
 * `Model.provider` is absent — the historical default for an uncached model —
 * and, deliberately, is never inferred from the id shape or the `local`
 * descriptor.
 */
export const providerOfModel = (model: Model): ProviderId => model.provider ?? "openrouter";

/** API-key providers are configured iff a key is present; Ollama iff explicitly enabled. */
export const isProviderConfigured = (
  provider: ProviderId,
  state: { hasApiKey: boolean; explicitlyEnabled: boolean },
): boolean =>
  PROVIDER_REQUIRES_API_KEY[provider] ? state.hasApiKey : state.explicitlyEnabled;

/** Dedupe, drop anything that isn't a known provider id, and order by `PROVIDER_ORDER`. */
export const sanitizeEnabledProviders = (raw: unknown): ProviderId[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ProviderId>();
  for (const value of raw) {
    if (isProviderId(value)) seen.add(value);
  }
  return PROVIDER_ORDER.filter((provider) => seen.has(provider));
};
