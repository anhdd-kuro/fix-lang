/**
 * @file providerCards.ts
 * @description Pure state model behind Settings → General's per-provider
 * cards. Each provider connects and disconnects independently, so every card
 * derives its own affordances from `get-provider-states` plus whatever the
 * user has typed but not yet submitted.
 *
 * Kept out of the `.tsx` so the disconnect warning — the one piece of copy a
 * user makes an irreversible decision from — is pinned by tests.
 *
 * Provider values come from `~/shared/providers` directly, never through
 * `~/stores/apiStore`'s re-export shim (finding F9: that module builds an
 * `electron-store` at import, and a value import of it from renderer code
 * breaks `bun run build`).
 */
import { msg, type Message } from "~/shared/i18n/message";
import {
  isProviderConfigured,
  PROVIDER_ORDER,
  PROVIDER_REQUIRES_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
  type ProviderId,
} from "~/shared/providers";

/** The slice of `get-provider-states` a card reads. */
export type ProviderConnectionState = {
  connected: boolean;
  apiKeySet: boolean;
  provisioningKeySet: boolean;
  modelCount: number;
};

/** What the user has typed into a card but not yet submitted. */
export type TypedProviderKeys = Partial<
  Record<ProviderId, { apiKey?: string; provisioningKey?: string }>
>;

export type ProviderCardState = {
  provider: ProviderId;
  /** In `enabledProviders` — this, not `configured`, gates Disconnect. */
  connected: boolean;
  /** `isProviderConfigured`: a key is on disk, or Ollama is explicitly enabled. */
  configured: boolean;
  apiKeySet: boolean;
  provisioningKeySet: boolean;
  modelCount: number;
  requiresApiKey: boolean;
  supportsProvisioningKey: boolean;
  /** Enough credential material exists (stored or typed) to attempt a connect. */
  canConnect: boolean;
};

/** The `cleared` record `disconnect-provider` returns. */
export type ClearedRefsSummary = {
  selectedModel: boolean;
  presetIds: readonly string[];
  features: readonly string[];
};

/**
 * One card per provider, in `PROVIDER_ORDER`.
 *
 * `configured` is **recomputed** through `isProviderConfigured` rather than
 * copied from main's field: the rule ("key providers need a key, Ollama needs
 * to be explicitly enabled") is the registry's, and recomputing it here keeps
 * a fourth provider correct without a renderer edit.
 *
 * A provider missing from `states` is rendered as a fully disconnected card
 * rather than skipped — a dropped provider must be visible and reconnectable,
 * not silently absent from the settings screen.
 */
export const buildProviderCards = (
  states: Partial<Record<ProviderId, ProviderConnectionState>>,
  typedKeys: TypedProviderKeys = {},
): ProviderCardState[] =>
  PROVIDER_ORDER.map((provider) => {
    const state = states[provider];
    const connected = state?.connected ?? false;
    const apiKeySet = state?.apiKeySet ?? false;
    const requiresApiKey = PROVIDER_REQUIRES_API_KEY[provider];
    const typedApiKey = typedKeys[provider]?.apiKey ?? "";

    return {
      provider,
      connected,
      configured: isProviderConfigured(provider, {
        hasApiKey: apiKeySet,
        explicitlyEnabled: connected,
      }),
      apiKeySet,
      provisioningKeySet: state?.provisioningKeySet ?? false,
      modelCount: state?.modelCount ?? 0,
      requiresApiKey,
      supportsProvisioningKey: PROVIDER_SUPPORTS_PROVISIONING_KEY[provider],
      canConnect: requiresApiKey ? apiKeySet || typedApiKey.trim() !== "" : true,
    };
  });

/**
 * The lines of the disconnect confirmation, as locale-free descriptors.
 *
 * **Returns descriptors, not prose.** The card's sketch said `: string`, but a
 * pure module has no translator and the project rule is that aggregation
 * returns `Message`s the renderer resolves with `tm()`. The caller renders the
 * `…warning.title` heading itself, because that one line interpolates a
 * *localized* provider name, which a raw `Message` param cannot carry.
 *
 * **The three `cleared` facts are independent and each gets its own line.**
 * Any subset can be non-empty: the default model may live on this provider
 * while no preset does, or the reverse. Folding one fact into another's
 * sentence tells the user their default is clearing when it is not — that
 * defect already happened once in the copy, and the strings were rewritten to
 * be independently true. Keep them that way.
 *
 * When nothing is cleared the result still says so explicitly. An empty list
 * would render an empty warning box and read as a rendering bug.
 *
 * `storedKeys` gates the stored-key line on a key **actually being on disk**,
 * not on the provider merely supporting one. Deriving it from
 * `PROVIDER_REQUIRES_API_KEY` alone produced a warning that announced a key
 * deletion for a key-provider that had no key stored — and then, one line
 * later, said nothing would be lost. Two lines of the same warning
 * contradicting each other is exactly the dishonesty this function exists to
 * remove.
 */
export const describeDisconnectImpact = (
  provider: ProviderId,
  cleared: ClearedRefsSummary,
  storedKeys: { apiKeySet: boolean; provisioningKeySet: boolean } = {
    apiKeySet: PROVIDER_REQUIRES_API_KEY[provider],
    provisioningKeySet: false,
  },
): Message[] => {
  const lines: Message[] = [];

  if (storedKeys.apiKeySet || storedKeys.provisioningKeySet) {
    lines.push(msg("settings.general.providers.disconnect.warning.key"));
  }
  if (cleared.selectedModel) {
    lines.push(msg("settings.general.providers.disconnect.warning.selectedModel"));
  }
  if (cleared.presetIds.length > 0) {
    lines.push(
      msg("settings.general.providers.disconnect.warning.cleared", {
        count: cleared.presetIds.length,
      }),
    );
  }
  if (cleared.features.length > 0) {
    lines.push(
      msg("settings.general.providers.disconnect.warning.features", {
        count: cleared.features.length,
      }),
    );
  }
  if (
    !cleared.selectedModel &&
    cleared.presetIds.length === 0 &&
    cleared.features.length === 0
  ) {
    lines.push(msg("settings.general.providers.disconnect.warning.nothing"));
  }

  return lines;
};
