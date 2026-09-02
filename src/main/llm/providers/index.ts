/**
 * @file providers/index.ts
 * @description Per-provider capability registry for the main process.
 *
 * One descriptor per `ProviderId`, so adding a provider is a new folder here
 * plus one entry below — not scattered edits across `ai.request/shared.ts`,
 * `ipc/features/api.ts`, and the IPC layer.
 *
 * Credential facts are DERIVED from the tables in `~/features/providers/shared/providers`, never
 * restated: a second source of truth for "does this provider take an admin key"
 * would drift from the secret-slot derivation in `profileSecretStore`.
 *
 * Behaviour slots (`fetchModels`, `makeRequest`) resolve their provider module
 * through a LAZY `import()`. Laziness is load-bearing, not style: this module is
 * re-exported by `~/main/llm`, which `ipc/features/api.ts` and unit tests import
 * for the Ollama client alone. Loading the request modules eagerly would drag the
 * OpenAI/OpenRouter SDKs, notifications and `electron-store` in with them.
 *
 * `ai.request/shared.ts` dispatches THROUGH this registry, so nothing here may
 * import `shared.ts` — the request/response types come from
 * `ai.request/requestTypes.ts` precisely to keep that edge one-way.
 *
 * A provider with no `fetchModels` slot is not "unsupported": Ollama and LM Studio
 * are discovered by reachability probe, whose "empty vs unreachable" distinction
 * lives in `fetchProviderModels` and would be lost behind this signature.
 */
import {
  PROVIDER_ORDER,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
  type ProviderId,
  type Model,
} from "~/features/providers/shared/providers";
import type {
  AIRequestOptions,
  AIRequestResponse,
} from "~/main/ai.request/requestTypes";

/**
 * Providers exposing an account-level usage/billing API. Local providers bill
 * nothing, and this is a genuinely new fact — not derivable from the key tables
 * (LM Studio accepts an optional key yet has no usage endpoint).
 */
const PROVIDER_SUPPORTS_USAGE: Readonly<Record<ProviderId, boolean>> = Object.freeze({
  openai: true,
  openrouter: true,
  // Anthropic's usage/cost reports need an org admin key, which no profile
  // stores — see `PROVIDER_SUPPORTS_PROVISIONING_KEY`.
  anthropic: false,
  bedrock: false,
  ollama: false,
  lmstudio: false,
});

export type ProviderCapabilities = {
  id: ProviderId;
  /** Admin/provisioning key slot — mirrors the secret-store derivation. */
  supportsAdminKey: boolean;
  /** Has an account-level usage/billing API, i.e. can back a Usage sub-tab. */
  supportsUsage: boolean;
  /** Live model list for a provider that has one; absent for local discovery. */
  fetchModels?: (apiKey: string) => Promise<Model[]>;
  /** Transform/PromptGen request path. */
  makeRequest?: (options: AIRequestOptions) => Promise<AIRequestResponse>;
};

const capabilities = (
  id: ProviderId,
  behaviour: Pick<ProviderCapabilities, "fetchModels" | "makeRequest">,
): ProviderCapabilities => ({
  id,
  supportsAdminKey: PROVIDER_SUPPORTS_PROVISIONING_KEY[id],
  supportsUsage: PROVIDER_SUPPORTS_USAGE[id],
  ...behaviour,
});

export const PROVIDER_CAPABILITIES: Readonly<Record<ProviderId, ProviderCapabilities>> =
  Object.freeze({
    openai: capabilities("openai", {
      fetchModels: (apiKey) =>
        import("./openai/models").then((m) => m.fetchOpenAIModels(apiKey)),
      makeRequest: (options) =>
        import("./openai/request").then((m) => m.makeOpenAIAIRequest(options)),
    }),
    openrouter: capabilities("openrouter", {
      fetchModels: (apiKey) =>
        import("./openrouter/models").then((m) => m.fetchOpenRouterModels(apiKey)),
      makeRequest: (options) =>
        import("./openrouter/request").then((m) =>
          m.makeOpenRouterAIRequest(options),
        ),
    }),
    anthropic: capabilities("anthropic", {
      fetchModels: (apiKey) =>
        import("./anthropic/models").then((m) => m.fetchAnthropicModels(apiKey)),
      makeRequest: (options) =>
        import("./anthropic/request").then((m) => m.makeAnthropicAIRequest(options)),
    }),
    bedrock: capabilities("bedrock", {
      fetchModels: (_apiKey) =>
        import("./bedrock/models").then(async (m) => {
          const { getCurrentProfileId } = await import("~/features/providers/store/apiStore");
          const { getProfileSecret } = await import("~/features/providers/store/profileSecretStore");
          const { resolveBedrockRegion } = await import("~/features/providers/shared/bedrockEndpoint");
          const { getProviderEndpoint } = await import("~/features/providers/store/apiStore");
          const profileId = getCurrentProfileId();
          if (!profileId) return [];
          const accessKeyId = await getProfileSecret(profileId, "bedrock", "api");
          const secretAccessKey = await getProfileSecret(profileId, "bedrock", "secret");
          if (!accessKeyId || !secretAccessKey) return [];
          return m.fetchBedrockModels({
            accessKeyId,
            secretAccessKey,
            region: resolveBedrockRegion(getProviderEndpoint("bedrock")),
          });
        }),
      makeRequest: (options) =>
        import("./bedrock/request").then((m) => m.makeBedrockAIRequest(options)),
    }),
    ollama: capabilities("ollama", {
      makeRequest: (options) =>
        import("./ollama/request").then((m) => m.makeLocalAIRequest(options)),
    }),
    lmstudio: capabilities("lmstudio", {
      makeRequest: (options) =>
        import("./lmstudio/request").then((m) => m.makeLmStudioAIRequest(options)),
    }),
  });

export const providerCapabilities = (id: ProviderId): ProviderCapabilities =>
  PROVIDER_CAPABILITIES[id];

/** Providers that can back a Usage sub-tab, in display order. */
export const usageCapableProviders = (): ProviderId[] =>
  PROVIDER_ORDER.filter((id) => PROVIDER_CAPABILITIES[id].supportsUsage);

// Only the lightweight local clients are re-exported eagerly. The request/model
// modules are reachable through the lazy slots above, or by direct import from
// `ai.request/shared.ts` — re-exporting them here would defeat that laziness.
export * from "./ollama/client";
export * from "./lmstudio/client";
