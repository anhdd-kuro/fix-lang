/**
 * @file providerCards.test.ts
 * @description Pins the per-provider card state and — the part a user makes
 * an irreversible decision from — the disconnect impact description.
 *
 * The four `cleared` combinations are covered explicitly, because the three
 * facts in that record are independent and a previous draft of this copy
 * coupled two of them: disconnecting a provider that held a preset, while the
 * default model lived elsewhere, told the user their default was clearing.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { PROVIDER_ORDER } from "~/shared/providers";
import {
  buildProviderCards,
  describeDisconnectImpact,
  type ClearedRefsSummary,
  type ProviderConnectionState,
} from "./providerCards";

const t = createTranslator("en");

const state = (
  overrides: Partial<ProviderConnectionState> = {},
): ProviderConnectionState => ({
  connected: false,
  apiKeySet: false,
  provisioningKeySet: false,
  modelCount: 0,
  ...overrides,
});

const cleared = (overrides: Partial<ClearedRefsSummary> = {}): ClearedRefsSummary => ({
  selectedModel: false,
  presetIds: [],
  features: [],
  ...overrides,
});

const keys = (lines: readonly { key: string }[]): string[] =>
  lines.map((line) => line.key);

describe("buildProviderCards", () => {
  it("emits one card per provider in PROVIDER_ORDER", () => {
    expect(buildProviderCards({}).map((card) => card.provider)).toEqual([
      ...PROVIDER_ORDER,
    ]);
  });

  it("marks a key-requiring provider configured iff its key is set", () => {
    const withKey = buildProviderCards({ openai: state({ apiKeySet: true }) });
    const withoutKey = buildProviderCards({ openai: state({ connected: true }) });

    expect(withKey.find((card) => card.provider === "openai")?.configured).toBe(true);
    // Connected but no key on disk: NOT configured. `configured` is the
    // registry's rule, not a copy of main's field.
    expect(withoutKey.find((card) => card.provider === "openai")?.configured).toBe(
      false,
    );
  });

  it("marks Ollama configured iff explicitly enabled, regardless of any key", () => {
    const enabled = buildProviderCards({ ollama: state({ connected: true }) });
    const disabled = buildProviderCards({ ollama: state({ apiKeySet: true }) });

    expect(enabled.find((card) => card.provider === "ollama")?.configured).toBe(true);
    expect(disabled.find((card) => card.provider === "ollama")?.configured).toBe(false);
  });

  it("reports `connected` from enabledProviders, separately from `configured`", () => {
    // A disconnected provider whose key is still on disk. The Disconnect
    // button gates on `connected`; offering models gates on it too.
    const [openai] = buildProviderCards({
      openai: state({ connected: false, apiKeySet: true }),
    });
    expect(openai?.connected).toBe(false);
    expect(openai?.configured).toBe(true);
  });

  it("carries the credential requirements from the registry", () => {
    const cards = buildProviderCards({});
    const byProvider = Object.fromEntries(cards.map((card) => [card.provider, card]));

    expect(byProvider.openai?.requiresApiKey).toBe(true);
    expect(byProvider.openai?.supportsProvisioningKey).toBe(false);
    expect(byProvider.openrouter?.supportsProvisioningKey).toBe(true);
    expect(byProvider.ollama?.requiresApiKey).toBe(false);
  });

  it("allows a connect attempt with a stored key, a typed key, or no key at all for Ollama", () => {
    const byProvider = (
      states: Parameters<typeof buildProviderCards>[0],
      typed: Parameters<typeof buildProviderCards>[1] = {},
    ) =>
      Object.fromEntries(
        buildProviderCards(states, typed).map((card) => [card.provider, card]),
      );

    expect(byProvider({}).openai?.canConnect).toBe(false);
    expect(byProvider({ openai: state({ apiKeySet: true }) }).openai?.canConnect).toBe(
      true,
    );
    expect(byProvider({}, { openai: { apiKey: "sk-live" } }).openai?.canConnect).toBe(
      true,
    );
    // Whitespace is not a key.
    expect(byProvider({}, { openai: { apiKey: "   " } }).openai?.canConnect).toBe(false);
    expect(byProvider({}).ollama?.canConnect).toBe(true);
  });

  it("reports every secret slot as unset for a provider missing from the states map", () => {
    // Defaulting a `…Set` flag to `true` would have the card claim a stored
    // provisioning key that does not exist, and offer a Disconnect warning
    // about deleting it.
    const cards = buildProviderCards({});
    for (const card of cards) {
      expect(card.apiKeySet).toBe(false);
      expect(card.provisioningKeySet).toBe(false);
      expect(card.modelCount).toBe(0);
      expect(card.connected).toBe(false);
    }
  });

  it("passes the stored-secret flags through verbatim", () => {
    const [, openrouter] = buildProviderCards({
      openrouter: state({ connected: true, apiKeySet: true, provisioningKeySet: true }),
    });
    expect(openrouter?.apiKeySet).toBe(true);
    expect(openrouter?.provisioningKeySet).toBe(true);
  });

  it("renders a provider missing from the states map as a disconnected card, not a gap", () => {
    const cards = buildProviderCards({ openai: state({ connected: true, apiKeySet: true }) });
    expect(cards).toHaveLength(PROVIDER_ORDER.length);
    expect(cards.find((card) => card.provider === "ollama")?.connected).toBe(false);
    expect(cards.find((card) => card.provider === "ollama")?.modelCount).toBe(0);
  });
});

describe("describeDisconnectImpact — all four cleared combinations", () => {
  it("presets only: says nothing about the default model", () => {
    const lines = describeDisconnectImpact("openai", cleared({ presetIds: ["p1", "p2"] }));

    expect(keys(lines)).toEqual([
      "settings.general.providers.disconnect.warning.key",
      "settings.general.providers.disconnect.warning.cleared",
    ]);
    expect(lines.find((line) => line.key.endsWith("cleared"))?.params).toEqual({
      count: 2,
    });
    // The regression this file exists for: a preset being cleared must NEVER
    // drag the default-model sentence in behind it.
    expect(keys(lines)).not.toContain(
      "settings.general.providers.disconnect.warning.selectedModel",
    );
    expect(
      lines.some((line) =>
        t(line.key as "settings.general.providers.disconnect.warning.key", line.params)
          .toLowerCase()
          .includes("default model"),
      ),
    ).toBe(false);
  });

  it("default only: says nothing about presets", () => {
    const lines = describeDisconnectImpact("openai", cleared({ selectedModel: true }));

    expect(keys(lines)).toEqual([
      "settings.general.providers.disconnect.warning.key",
      "settings.general.providers.disconnect.warning.selectedModel",
    ]);
    expect(keys(lines)).not.toContain(
      "settings.general.providers.disconnect.warning.cleared",
    );
  });

  it("both: one independent line each, in a stable order", () => {
    const lines = describeDisconnectImpact(
      "openrouter",
      cleared({ selectedModel: true, presetIds: ["p1"] }),
    );

    expect(keys(lines)).toEqual([
      "settings.general.providers.disconnect.warning.key",
      "settings.general.providers.disconnect.warning.selectedModel",
      "settings.general.providers.disconnect.warning.cleared",
    ]);
    expect(lines[2]?.params).toEqual({ count: 1 });
  });

  it("neither: states that nothing will be lost — not an empty list, not a hedge", () => {
    const lines = describeDisconnectImpact("ollama", cleared());

    // Ollama has no stored key, so the "nothing will be lost" line is the
    // WHOLE warning — an empty array here would render a blank warning box.
    expect(keys(lines)).toEqual([
      "settings.general.providers.disconnect.warning.nothing",
    ]);
    expect(
      t("settings.general.providers.disconnect.warning.nothing").toLowerCase(),
    ).toContain("will be lost");
  });

  it("still says nothing will be lost for a key provider with an empty cleared record", () => {
    const lines = describeDisconnectImpact("openai", cleared(), {
      apiKeySet: true,
      provisioningKeySet: false,
    });
    expect(keys(lines)).toEqual([
      "settings.general.providers.disconnect.warning.key",
      "settings.general.providers.disconnect.warning.nothing",
    ]);
    // …and the two lines must not contradict: the key line announces a real
    // loss, so the second line has to be scoped ("Nothing ELSE will be lost").
    expect(
      t("settings.general.providers.disconnect.warning.nothing").toLowerCase(),
    ).toContain("nothing else");
  });

  describe("the stored-key line tracks keys ON DISK, not the provider's capability", () => {
    it("is omitted for a key provider that has no key stored", () => {
      expect(
        keys(
          describeDisconnectImpact("openai", cleared(), {
            apiKeySet: false,
            provisioningKeySet: false,
          }),
        ),
      ).toEqual(["settings.general.providers.disconnect.warning.nothing"]);
    });

    it("is emitted for OpenRouter when only the provisioning key is stored", () => {
      expect(
        keys(
          describeDisconnectImpact("openrouter", cleared(), {
            apiKeySet: false,
            provisioningKeySet: true,
          }),
        ),
      ).toEqual([
        "settings.general.providers.disconnect.warning.key",
        "settings.general.providers.disconnect.warning.nothing",
      ]);
    });

    it("is omitted for Ollama even when the caller wrongly reports a key", () => {
      // Ollama stores no secret at all; `secretKindsForProvider` derives an
      // empty slot list for it, so nothing can be on disk to delete.
      expect(
        keys(
          describeDisconnectImpact("ollama", cleared({ selectedModel: true }), {
            apiKeySet: false,
            provisioningKeySet: false,
          }),
        ),
      ).toEqual(["settings.general.providers.disconnect.warning.selectedModel"]);
    });
  });

  it("names cleared feature models as their own independent fact", () => {
    const lines = describeDisconnectImpact(
      "ollama",
      cleared({ features: ["promptGen", "summarize"] }),
    );

    expect(keys(lines)).toEqual([
      "settings.general.providers.disconnect.warning.features",
    ]);
    expect(lines[0]?.params).toEqual({ count: 2 });
    // Features are cleared, so "nothing will be lost" would be a lie.
    expect(keys(lines)).not.toContain(
      "settings.general.providers.disconnect.warning.nothing",
    );
  });

  it("omits the stored-key line for a provider that has no key", () => {
    expect(keys(describeDisconnectImpact("ollama", cleared({ selectedModel: true })))).toEqual([
      "settings.general.providers.disconnect.warning.selectedModel",
    ]);
  });

  it("uses the plural family so a single preset reads in the singular", () => {
    const [, line] = describeDisconnectImpact("openai", cleared({ presetIds: ["p1"] }));
    expect(t("settings.general.providers.disconnect.warning.cleared", line?.params)).toBe(
      t("settings.general.providers.disconnect.warning.cleared", { count: 1 }),
    );
    expect(
      t("settings.general.providers.disconnect.warning.cleared", { count: 1 }),
    ).not.toBe(t("settings.general.providers.disconnect.warning.cleared", { count: 2 }));
  });
});
