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

/**
 * Every exported collection here is `Object.freeze`d. `readonly` and
 * `Readonly<...>` are erased at runtime, so a single unguarded cast in any
 * same-process consumer would corrupt the one shared instance for every other
 * importer. Same reason `src/shared/features.ts` freezes its own map.
 */
export const PROVIDER_IDS = Object.freeze(["openai", "openrouter", "ollama"] as const);
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);

/**
 * Compile-time exhaustiveness guard: a tuple holding every member of `T`
 * exactly once, in any order. Without it a hand-written `readonly ProviderId[]`
 * accepts a list that is missing a provider, so a fourth `PROVIDER_IDS` entry
 * would compile clean while silently dropping out of ordering and resolution.
 */
type Permutation<T extends string, Rest extends string = T> = [T] extends [never]
  ? []
  : { [K in Rest]: [K, ...Permutation<Exclude<T, K>>] }[Rest];

/**
 * **Two concerns, deliberately one constant.**
 *
 * 1. Card + group display order everywhere providers are listed to a user.
 * 2. **Resolution precedence** — `resolveModelRef` scans this order for a bare
 *    (un-prefixed) model id and bills the first provider that has it.
 *
 * So reordering this is not cosmetic: it reroutes every un-migrated bare id to
 * a different provider, a different API key and a different price. If display
 * order ever needs to diverge from precedence, split the constant in two rather
 * than reordering this one.
 *
 * Derived through `Permutation<ProviderId>` so adding a provider to
 * `PROVIDER_IDS` fails the build here instead of silently skipping it.
 */
export const PROVIDER_ORDER: readonly ProviderId[] = Object.freeze([
  "openai",
  "openrouter",
  "ollama",
] satisfies Permutation<ProviderId>);

/**
 * **Diagnostics only — never render this in the UI.** Provider display names
 * shown to a user are routed through `t()` from the i18n catalogs
 * (`models.select.provider.*`, `settings.general.provider.*`); this map is the
 * hardcoded-English fallback for contexts that have no i18n context at all,
 * such as structured logs and other non-React code. Rendering it in a component
 * would create a second, untranslated source for strings the catalogs already
 * own, and no gate would catch the drift.
 */
export const PROVIDER_LOG_LABELS: Readonly<Record<ProviderId, string>> = Object.freeze({
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
});

/** Ollama runs locally and needs no API key; the other two do. */
export const PROVIDER_REQUIRES_API_KEY: Readonly<Record<ProviderId, boolean>> = Object.freeze({
  openai: true,
  openrouter: true,
  ollama: false,
});

/** Only OpenRouter has a separate provisioning key (for model discovery/billing). */
export const PROVIDER_SUPPORTS_PROVISIONING_KEY: Readonly<Record<ProviderId, boolean>> =
  Object.freeze({
    openai: false,
    openrouter: true,
    ollama: false,
  });

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
 * The models a provider can serve, in cache order.
 *
 * Use this instead of `models.filter((m) => m.provider === provider)`: an
 * untagged legacy cache entry has no `provider` field at all, so the `===`
 * version silently drops every pre-upgrade model out of every list.
 */
export const modelsForProvider = (models: readonly Model[], provider: ProviderId): Model[] =>
  models.filter((model) => isModelForProvider(model, provider));

/**
 * Partition a cache into one group per provider, in the given order
 * (`PROVIDER_ORDER` by default). Pass a subset to restrict the groups — e.g.
 * the user's enabled providers.
 *
 * Empty groups are kept, so the caller decides whether an empty provider still
 * gets a heading. A model available from two providers appears in both groups.
 */
export const groupModelsByProvider = (
  models: readonly Model[],
  order: readonly ProviderId[] = PROVIDER_ORDER,
): { provider: ProviderId; models: Model[] }[] =>
  order.map((provider) => ({ provider, models: modelsForProvider(models, provider) }));

/**
 * Provider a cached model belongs to. Falls back to `"openrouter"` when
 * `Model.provider` is absent — the historical default for an uncached model —
 * and, deliberately, is never inferred from the id shape or the `local`
 * descriptor.
 */
export const providerOfModel = (model: Model): ProviderId => model.provider ?? "openrouter";

/**
 * API-key providers are configured iff a key is present; Ollama iff explicitly
 * enabled.
 *
 * `provider` is re-validated even though it is typed: the values that reach
 * here originate in a user-editable config file, and the lookup maps carry a
 * live prototype, so an inherited key such as `"constructor"` would otherwise
 * read truthy and report an unknown provider as configured.
 */
export const isProviderConfigured = (
  provider: ProviderId,
  state: { hasApiKey: boolean; explicitlyEnabled: boolean },
): boolean =>
  isProviderId(provider) &&
  (PROVIDER_REQUIRES_API_KEY[provider] ? state.hasApiKey : state.explicitlyEnabled);

/** Dedupe, drop anything that isn't a known provider id, and order by `PROVIDER_ORDER`. */
export const sanitizeEnabledProviders = (raw: unknown): ProviderId[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ProviderId>();
  for (const value of raw) {
    if (isProviderId(value)) seen.add(value);
  }
  return PROVIDER_ORDER.filter((provider) => seen.has(provider));
};
