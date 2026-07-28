/**
 * @file usageTabs.ts
 * @description PURE sub-tab logic for the Usage tab, kept out of the React
 * component so it is unit-testable without a DOM testing library (none is
 * installed). Mirrors `MainWindow/dashboardTabs.ts`.
 *
 * Which providers appear is a UI decision with two inputs: the provider must be
 * usage-capable at all (OpenAI, OpenRouter — the local ones bill nothing), and it
 * must be connected. Holding an admin key is NOT required to show the sub-tab —
 * the panel itself prompts for the key — but it does decide the ORDER, so the
 * tab that opens first is one that can actually render numbers.
 */
import { PROVIDER_ORDER, type ProviderId } from "~/shared/providers";
import type { MessageKey } from "~/shared/i18n/message";

/** Providers with an account-level usage API. Mirrors the main-process registry. */
export const USAGE_PROVIDERS: readonly ProviderId[] = Object.freeze([
  "openai",
  "openrouter",
]);

export type UsageProviderState = {
  connected: boolean;
  provisioningKeySet: boolean;
};

export type UsageSubTab = {
  provider: ProviderId;
  /** `usage.provider.*` translation key — resolved via `t()` at render time. */
  labelKey: MessageKey;
  /** Whether this provider's admin key is stored; drives ordering + empty state. */
  hasAdminKey: boolean;
};

const LABEL_KEYS: Readonly<Partial<Record<ProviderId, MessageKey>>> = {
  openai: "usage.provider.openai",
  openrouter: "usage.provider.openrouter",
};

export const isUsageProvider = (provider: ProviderId): boolean =>
  USAGE_PROVIDERS.includes(provider);

/**
 * Visible sub-tabs: usage-capable ∩ connected, keyed providers first, then
 * `PROVIDER_ORDER` within each group. A provider whose label key is missing is
 * dropped rather than rendered with a raw key as its name.
 */
export const buildUsageSubTabs = (
  states: Partial<Record<ProviderId, UsageProviderState>>,
): UsageSubTab[] => {
  const visible = PROVIDER_ORDER.filter(
    (provider) =>
      isUsageProvider(provider) &&
      states[provider]?.connected === true &&
      LABEL_KEYS[provider] !== undefined,
  );

  const withKey = visible.filter(
    (provider) => states[provider]?.provisioningKeySet === true,
  );
  const withoutKey = visible.filter(
    (provider) => states[provider]?.provisioningKeySet !== true,
  );

  return [...withKey, ...withoutKey].map((provider) => ({
    provider,
    labelKey: LABEL_KEYS[provider] as MessageKey,
    hasAdminKey: states[provider]?.provisioningKeySet === true,
  }));
};

/**
 * Keep the user's chosen sub-tab across a provider-state refresh, falling back to
 * the first tab. Re-deriving the active provider from the index alone would jump
 * the user to a different account when a connect/disconnect reorders the list.
 */
export const resolveActiveUsageProvider = (
  subTabs: readonly UsageSubTab[],
  current: ProviderId | null,
): ProviderId | null => {
  if (current !== null && subTabs.some((tab) => tab.provider === current)) {
    return current;
  }
  return subTabs[0]?.provider ?? null;
};
