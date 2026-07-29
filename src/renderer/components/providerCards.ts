import { msg, type Message } from "~/shared/i18n/message";
import {
  isProviderConfigured,
  PROVIDER_ORDER,
  PROVIDER_REQUIRES_API_KEY,
  PROVIDER_SUPPORTS_API_KEY,
  PROVIDER_SUPPORTS_PROVISIONING_KEY,
  type ProviderId,
} from "~/shared/providers";
import type { TranslationKey } from "~/shared/i18n/keys";

export type ProviderConnectionState = {
  connected: boolean;
  apiKeySet: boolean;
  provisioningKeySet: boolean;
  modelCount: number;
};

/** Typed into a card but not yet submitted. */
export type TypedProviderKeys = Partial<
  Record<ProviderId, { apiKey?: string; secretKey?: string; provisioningKey?: string }>
>;

/**
 * Admin-key field strings per provider. A static record, not a template-built
 * key: `t()` keys are compile-time checked, and `` `…label.${provider}` `` would
 * widen to `string` and silently accept a key no catalog defines.
 */
export const ADMIN_KEY_MESSAGE_KEYS: Partial<
  Record<
    ProviderId,
    {
      label: TranslationKey;
      placeholderNew: TranslationKey;
      /** Link text for `helpUrl`. */
      help: TranslationKey;
      /**
       * The provider's own page for minting this key. Opened externally — these
       * consoles are not embeddable, and an admin key must never be typed into
       * a page FixLang rendered.
       */
      helpUrl: string;
    }
  >
> = {
  openai: {
    label: "settings.general.provisioningKey.label.openai",
    placeholderNew: "settings.general.provisioningKey.placeholderNew.openai",
    help: "settings.general.provisioningKey.help.openai",
    helpUrl: "https://platform.openai.com/settings/organization/admin-keys",
  },
  openrouter: {
    label: "settings.general.provisioningKey.label.openrouter",
    placeholderNew: "settings.general.provisioningKey.placeholderNew.openrouter",
    help: "settings.general.provisioningKey.help.openrouter",
    helpUrl: "https://openrouter.ai/settings/provisioning-keys",
  },
};

export type ProviderCardState = {
  provider: ProviderId;
  /** In `enabledProviders` — this, not `configured`, gates Disconnect. */
  connected: boolean;
  configured: boolean;
  apiKeySet: boolean;
  provisioningKeySet: boolean;
  modelCount: number;
  requiresApiKey: boolean;
  supportsApiKey: boolean;
  supportsProvisioningKey: boolean;
  canConnect: boolean;
};

/** The `cleared` record `disconnect-provider` returns. */
export type ClearedRefsSummary = {
  selectedModel: boolean;
  presetIds: readonly string[];
  features: readonly string[];
};

/**
 * One card per provider in `PROVIDER_ORDER` — a provider missing from `states`
 * still gets a disconnected card, so it stays visible and reconnectable.
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
    const supportsApiKey = PROVIDER_SUPPORTS_API_KEY[provider];
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
      supportsApiKey,
      supportsProvisioningKey: PROVIDER_SUPPORTS_PROVISIONING_KEY[provider],
      canConnect: requiresApiKey ? apiKeySet || typedApiKey.trim() !== "" : true,
    };
  });

/**
 * The disconnect confirmation lines, as locale-free descriptors the renderer
 * resolves with `tm()`.
 *
 * Every line must stand alone and be independently true: each `cleared` fact
 * gets its own line, `storedKeys` gates the key line on a key actually being
 * on disk, and "nothing is cleared" is stated rather than left empty.
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
