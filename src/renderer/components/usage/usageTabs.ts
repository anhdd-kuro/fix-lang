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
import { PROVIDER_ORDER, type ProviderId } from "~/features/providers/shared/providers";
import type { MessageKey } from "~/features/i18n/shared/message";

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

/**
 * A slot in the rendered sub-tab bar. Autocomplete is not a provider and never
 * will be — it reports what THIS app spent on ghost text, from local rollups
 * rather than a billing API — so it joins the bar as its own key instead of
 * being forced through `ProviderId`.
 *
 * `"providers"` is the stand-in shown ONLY when no usage-capable provider is
 * connected. Before autocomplete moved in here, that case replaced the entire
 * tab with a "connect a provider" card; keeping it as a slot preserves that
 * guidance instead of letting a bar with one other tab quietly swallow it.
 */
export type UsageSubTabKey = ProviderId | "autocomplete" | "providers";

export type UsageBarTab = {
  key: UsageSubTabKey;
  labelKey: MessageKey;
};

const AUTOCOMPLETE_BAR_TAB: UsageBarTab = Object.freeze({
  key: "autocomplete",
  labelKey: "usage.subTab.autocomplete",
});

const PROVIDERS_EMPTY_BAR_TAB: UsageBarTab = Object.freeze({
  key: "providers",
  labelKey: "usage.subTab.providers",
});

/**
 * The full bar: every provider sub-tab, then Autocomplete last. Autocomplete is
 * always present — it is the only sub-tab that needs no account, and a user on
 * Ollama alone would otherwise have no way to reach it.
 */
export const buildUsageBar = (
  providerTabs: readonly UsageSubTab[],
): UsageBarTab[] =>
  providerTabs.length === 0
    ? [PROVIDERS_EMPTY_BAR_TAB, AUTOCOMPLETE_BAR_TAB]
    : [
        ...providerTabs.map((tab) => ({ key: tab.provider, labelKey: tab.labelKey })),
        AUTOCOMPLETE_BAR_TAB,
      ];

/**
 * Keep the user's chosen slot across a refresh, falling back to the first one.
 * Same contract as `resolveActiveUsageProvider`, widened to the whole bar: a
 * choice whose slot has disappeared (a disconnected provider) is dropped rather
 * than left pointing at a tab that is no longer rendered.
 */
export const resolveActiveUsageSubTab = (
  bar: readonly UsageBarTab[],
  current: UsageSubTabKey | null,
): UsageSubTabKey | null => {
  if (current !== null && bar.some((tab) => tab.key === current)) {
    return current;
  }
  return bar[0]?.key ?? null;
};
