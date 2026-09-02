/**
 * @file comboEstimate.test.ts
 * @description Unit tests for the PURE combo cost/provider-transparency
 * derivation. No electron, no React — direct calls only.
 */
import { describe, expect, it } from "vitest";
import enSettings from "~/features/i18n/shared/locales/en/settings.json";
import jaSettings from "~/features/i18n/shared/locales/ja/settings.json";
import {
  buildComboEstimatePresetLookup,
  buildPriceMap,
  comboEstimateBaselineTokens,
  COMBO_TOKEN_GROWTH_FACTOR,
  COMBO_TOKEN_WARNING_THRESHOLD,
  effectiveComboStepModelRef,
  estimateCombo,
  estimateComboPreset,
  estimateComboStepTokens,
  resolveComboCostDisplay,
  resolveComboStepProvider,
  totalComboTokens,
  type PriceMap,
} from "./comboEstimate";
import type {
  ComboStep,
  CorrectionPreset,
  Model,
} from "~/features/providers/store/apiStore";

const makePricedModel = (
  overrides: Partial<Model> & { id: string },
): Model => ({
  name: overrides.id,
  created: 0,
  ...overrides,
  pricing: overrides.pricing ?? {
    prompt: "0.000002",
    completion: "0.000008",
    image: "0",
    request: "0",
    input_cache_read: "0",
    input_cache_write: "0",
    web_search: "0",
    internal_reasoning: "0",
  },
});

const makeStep = (id: string, presetId: string): ComboStep => ({ id, presetId });

describe("token growth factor", () => {
  it("baseline is estimateTextTokens over the fixed-length placeholder (800 chars / 4)", () => {
    expect(comboEstimateBaselineTokens()).toBe(200);
  });

  it("compounds COMBO_TOKEN_GROWTH_FACTOR once per step, each step's completion feeding the next step's prompt", () => {
    const steps = estimateComboStepTokens(3);
    expect(steps).toEqual([
      { promptTokens: 200, completionTokens: 230 },
      { promptTokens: 230, completionTokens: 265 },
      { promptTokens: 265, completionTokens: 305 },
    ]);
    expect(COMBO_TOKEN_GROWTH_FACTOR).toBeCloseTo(1.15);
  });

  it("sums prompt + completion tokens across every step", () => {
    expect(totalComboTokens(estimateComboStepTokens(2))).toBe(925);
    expect(totalComboTokens(estimateComboStepTokens(5))).toBe(2906);
  });

  it("a 0-step combo (transient editor state) estimates zero tokens, not a crash", () => {
    expect(totalComboTokens(estimateComboStepTokens(0))).toBe(0);
  });
});

describe("warning threshold", () => {
  const presetsById = buildComboEstimatePresetLookup([]);
  const empty: PriceMap = new Map();

  const stepsOfLength = (n: number): ComboStep[] =>
    Array.from({ length: n }, (_unused, index) => makeStep(`s${index}`, "missing"));

  it("a 2-step combo stays under the warning threshold with the default assumptions", () => {
    const estimate = estimateCombo({
      steps: stepsOfLength(2),
      presetsById,
      globalDefaultModelRef: "",
      models: [],
      priceMap: empty,
    });
    expect(estimate.totalTokens).toBe(925);
    expect(estimate.totalTokens).toBeLessThan(COMBO_TOKEN_WARNING_THRESHOLD);
    expect(estimate.exceedsWarningThreshold).toBe(false);
  });

  it("a 3-step-or-longer combo crosses the warning threshold with the default assumptions", () => {
    const estimate = estimateCombo({
      steps: stepsOfLength(3),
      presetsById,
      globalDefaultModelRef: "",
      models: [],
      priceMap: empty,
    });
    expect(estimate.totalTokens).toBe(1495);
    expect(estimate.totalTokens).toBeGreaterThan(COMBO_TOKEN_WARNING_THRESHOLD);
    expect(estimate.exceedsWarningThreshold).toBe(true);
  });

  it("a 3-step ALL-OLLAMA combo crosses the token threshold but is NOT flagged as multi-provider (f2)", () => {
    const models: Model[] = [
      makePricedModel({ id: "llama3.2:3b", provider: "ollama", local: { path: "/x" } }),
    ];
    const presetsById = buildComboEstimatePresetLookup([
      { id: "p1", name: "P1", hotkey: "", systemPrompt: "", model: "ollama::llama3.2:3b", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "p1"), makeStep("s2", "p1"), makeStep("s3", "p1")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    // The token-volume signal fires — this is genuinely a lot of tokens —
    // but the vendor-fan-out signal must stay false: one provider, zero
    // vendors external to the machine. The two conditions must be able to
    // disagree; a UI that always shows the same "multiple providers" text
    // for both would be lying here.
    expect(estimate.exceedsWarningThreshold).toBe(true);
    expect(estimate.hasMultipleProviders).toBe(false);
    expect(estimate.providers).toEqual(["ollama"]);
  });

  it("a 2-step combo across two providers is flagged multi-provider even though it stays under the token threshold", () => {
    const models: Model[] = [
      makePricedModel({ id: "gpt-4o-mini", provider: "openai" }),
      makePricedModel({ id: "llama3.2:3b", provider: "ollama", local: { path: "/x" } }),
    ];
    const presetsById = buildComboEstimatePresetLookup([
      { id: "p1", name: "P1", hotkey: "", systemPrompt: "", model: "gpt-4o-mini", isBuiltIn: false },
      { id: "p2", name: "P2", hotkey: "", systemPrompt: "", model: "ollama::llama3.2:3b", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "p1"), makeStep("s2", "p2")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.totalTokens).toBeLessThan(COMBO_TOKEN_WARNING_THRESHOLD);
    expect(estimate.exceedsWarningThreshold).toBe(false);
    expect(estimate.hasMultipleProviders).toBe(true);
  });

  it("a single-provider combo is never flagged multi-provider", () => {
    const models: Model[] = [makePricedModel({ id: "gpt-4o-mini", provider: "openai" })];
    const presetsById = buildComboEstimatePresetLookup([
      { id: "p1", name: "P1", hotkey: "", systemPrompt: "", model: "gpt-4o-mini", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: stepsOfLength(3).map((step) => ({ ...step, presetId: "p1" })),
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.hasMultipleProviders).toBe(false);
  });
});

describe("resolveComboCostDisplay (f1 — sub-cent 'ok' must not read as genuine zero)", () => {
  it("a sub-cent real cost gets extra fraction digits, distinguishing it from a genuine zero", () => {
    const paidSubCent = resolveComboCostDisplay({ status: "ok", totalUsd: 0.00482 });
    const genuineZero = resolveComboCostDisplay({ status: "zero", totalUsd: 0 });

    expect(paidSubCent).toEqual({
      kind: "amount",
      valueUsd: 0.00482,
      minimumFractionDigits: 0,
      maximumFractionDigits: 6,
    });
    expect(genuineZero).toEqual({
      kind: "amount",
      valueUsd: 0,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    // The whole point: these must not format to the identical "$0.00".
    expect(paidSubCent).not.toEqual(genuineZero);
  });

  it("a cost at or above one cent keeps the standard 2-digit display", () => {
    expect(resolveComboCostDisplay({ status: "ok", totalUsd: 0.0145 })).toEqual({
      kind: "amount",
      valueUsd: 0.0145,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  });

  it("'na' never renders as a number", () => {
    expect(resolveComboCostDisplay({ status: "na", totalUsd: null })).toEqual({
      kind: "na",
    });
  });
});

describe("estimate baseline disclosure (f3 — the 800-char assumption must be stated, not implied)", () => {
  it("names the baseline character count as an explicit assumption, in both locales", () => {
    for (const catalog of [enSettings, jaSettings] as Record<string, string>[]) {
      expect(catalog["settings.correction.combos.estimate.tokens"]).toContain(
        "{baselineChars}",
      );
      expect(catalog["settings.correction.combos.estimate.cost"]).toContain(
        "{baselineChars}",
      );
    }
  });
});

describe("effectiveComboStepModelRef", () => {
  it("uses the preset's own model when set", () => {
    expect(
      effectiveComboStepModelRef({ model: "openai::gpt-5" }, "openrouter::x"),
    ).toBe("openai::gpt-5");
  });

  it("falls back to the global default when the preset's model is empty or whitespace", () => {
    expect(effectiveComboStepModelRef({ model: "" }, "openrouter::x")).toBe(
      "openrouter::x",
    );
    expect(effectiveComboStepModelRef({ model: "   " }, "openrouter::x")).toBe(
      "openrouter::x",
    );
  });

  it("returns empty when neither the preset nor the global default names a model", () => {
    expect(effectiveComboStepModelRef({ model: "" }, "")).toBe("");
  });

  it("treats an undefined preset (deleted/unknown presetId) the same as an empty model", () => {
    expect(effectiveComboStepModelRef(undefined, "openrouter::x")).toBe(
      "openrouter::x",
    );
  });
});

describe("resolveComboStepProvider", () => {
  const models: Model[] = [
    makePricedModel({ id: "openai/gpt-4o", provider: "openrouter" }),
    makePricedModel({ id: "gpt-4o-mini", provider: "openai" }),
  ];

  it("resolves a prefixed ref via its own provider only", () => {
    const result = resolveComboStepProvider(
      { model: "openrouter::openai/gpt-4o" },
      "",
      models,
    );
    expect(result.provider).toBe("openrouter");
    expect(result.model?.id).toBe("openai/gpt-4o");
  });

  it("resolves a bare id by scanning connected providers' catalogues, never by guessing from the id shape", () => {
    const result = resolveComboStepProvider({ model: "gpt-4o-mini" }, "", models);
    expect(result.provider).toBe("openai");
  });

  it("a preset with no model inherits the global default's provider", () => {
    const result = resolveComboStepProvider({ model: "" }, "gpt-4o-mini", models);
    expect(result.provider).toBe("openai");
  });

  it("is unresolved (never a guess) when nothing names a model", () => {
    const result = resolveComboStepProvider({ model: "" }, "", models);
    expect(result.provider).toBeNull();
    expect(result.model).toBeNull();
  });

  it("is unresolved when a bare id matches no fetched model", () => {
    const result = resolveComboStepProvider({ model: "no-such-model" }, "", models);
    expect(result.provider).toBeNull();
  });
});

describe("estimateCombo — provider list (the headline)", () => {
  const models: Model[] = [
    makePricedModel({ id: "gpt-4o-mini", provider: "openai" }),
    makePricedModel({ id: "llama3.2:3b", provider: "ollama", local: { path: "/x" } }),
    makePricedModel({ id: "anthropic/claude-3.5-sonnet", provider: "openrouter" }),
  ];
  const presets: CorrectionPreset[] = [
    { id: "p1", name: "P1", hotkey: "", systemPrompt: "", model: "gpt-4o-mini", isBuiltIn: false },
    { id: "p2", name: "P2", hotkey: "", systemPrompt: "", model: "ollama::llama3.2:3b", isBuiltIn: false },
    {
      id: "p3",
      name: "P3",
      hotkey: "",
      systemPrompt: "",
      model: "openrouter::anthropic/claude-3.5-sonnet",
      isBuiltIn: false,
    },
  ];
  const presetsById = buildComboEstimatePresetLookup(presets);

  it("names every distinct provider across all steps, ordered by PROVIDER_ORDER, deduped", () => {
    const estimate = estimateCombo({
      steps: [
        makeStep("s1", "p2"), // ollama
        makeStep("s2", "p1"), // openai
        makeStep("s3", "p3"), // openrouter
        makeStep("s4", "p1"), // openai again — must not duplicate
      ],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    // PROVIDER_ORDER is openai, openrouter, bedrock, ollama, lmstudio.
    expect(estimate.providers).toEqual(["openai", "openrouter", "ollama"]);
    expect(estimate.hasUnresolvedProvider).toBe(false);
  });

  it("flags an unresolved provider instead of silently omitting the step", () => {
    const orphanPresets = buildComboEstimatePresetLookup([
      { id: "orphan", name: "Orphan", hotkey: "", systemPrompt: "", model: "", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "orphan"), makeStep("s2", "p1")],
      presetsById: new Map([...orphanPresets, ...presetsById]),
      globalDefaultModelRef: "", // nothing to inherit either
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.hasUnresolvedProvider).toBe(true);
    expect(estimate.providers).toEqual(["openai"]);
  });

  it("a step referencing a deleted preset is unresolved, not a crash", () => {
    const estimate = estimateCombo({
      steps: [makeStep("s1", "does-not-exist")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.hasUnresolvedProvider).toBe(true);
    expect(estimate.providers).toEqual([]);
  });

  it("a step with an empty model inherits the global default's provider — which can be a DIFFERENT vendor than the combo's other steps name", () => {
    // p1 has no model of its own, so it must inherit globalDefaultModelRef
    // (openai's gpt-4o-mini) — a different provider than p3 (openrouter),
    // which is exactly the "risk 5" case: the combo talks to a vendor the
    // preset itself never names. Exercised through estimateCombo end to
    // end, not just the pure resolveComboStepProvider/effectiveComboStepModelRef
    // helpers, so a regression in how estimateCombo WIRES
    // globalDefaultModelRef through would be caught here.
    const noModelPresets = buildComboEstimatePresetLookup([
      { id: "no-model", name: "NoModel", hotkey: "", systemPrompt: "", model: "", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "no-model"), makeStep("s2", "p3")],
      presetsById: new Map([...noModelPresets, ...presetsById]),
      globalDefaultModelRef: "gpt-4o-mini",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.providers).toEqual(["openai", "openrouter"]);
    expect(estimate.hasUnresolvedProvider).toBe(false);
  });
});

describe("estimateCombo — cost honesty", () => {
  it("a fully local/Ollama combo reports a genuine zero, never N/A", () => {
    const models: Model[] = [
      makePricedModel({ id: "llama3.2:3b", provider: "ollama", local: { path: "/x" } }),
    ];
    const presetsById = buildComboEstimatePresetLookup([
      { id: "p1", name: "P1", hotkey: "", systemPrompt: "", model: "ollama::llama3.2:3b", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "p1"), makeStep("s2", "p1")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.cost).toEqual({ status: "zero", totalUsd: 0 });
  });

  it("direct OpenAI has no local price map, so cost is N/A (never $0.00) even with tokens known", () => {
    const models: Model[] = [makePricedModel({ id: "gpt-5", provider: "openai" })];
    const presetsById = buildComboEstimatePresetLookup([
      { id: "p1", name: "P1", hotkey: "", systemPrompt: "", model: "openai::gpt-5", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "p1"), makeStep("s2", "p1")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.cost).toEqual({ status: "na", totalUsd: null });
  });

  it("one unpriceable step poisons the whole combo's total — never a silently-partial sum", () => {
    const pricedModels: Model[] = [
      makePricedModel({ id: "anthropic/claude-3.5-sonnet", provider: "openrouter" }),
    ];
    const presetsById = buildComboEstimatePresetLookup([
      {
        id: "priced",
        name: "Priced",
        hotkey: "",
        systemPrompt: "",
        model: "openrouter::anthropic/claude-3.5-sonnet",
        isBuiltIn: false,
      },
      { id: "unknown", name: "Unknown", hotkey: "", systemPrompt: "", model: "", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "priced"), makeStep("s2", "unknown")],
      presetsById,
      globalDefaultModelRef: "", // "unknown" step has nothing to resolve
      models: pricedModels,
      priceMap: buildPriceMap(pricedModels),
    });
    expect(estimate.cost.status).toBe("na");
    expect(estimate.cost.totalUsd).toBeNull();
  });

  it("sums per-step cost across a fully-priced multi-step combo", () => {
    const models: Model[] = [
      makePricedModel({
        id: "openai/gpt-4o",
        provider: "openrouter",
        pricing: {
          prompt: "0.000002",
          completion: "0.000008",
          image: "0",
          request: "0",
          input_cache_read: "0",
          input_cache_write: "0",
          web_search: "0",
          internal_reasoning: "0",
        },
      }),
    ];
    const presetsById = buildComboEstimatePresetLookup([
      {
        id: "p1",
        name: "P1",
        hotkey: "",
        systemPrompt: "",
        model: "openrouter::openai/gpt-4o",
        isBuiltIn: false,
      },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "p1"), makeStep("s2", "p1")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    // step0: prompt=200, completion=230 -> 200*2e-6 + 230*8e-6 = 0.00224
    // step1: prompt=230, completion=265 -> 230*2e-6 + 265*8e-6 = 0.00258
    expect(estimate.cost.status).toBe("ok");
    expect(estimate.cost.totalUsd).toBeCloseTo(0.00482, 6);
  });

  it("mixes a priced step and a local step into one 'ok' total, local contributing exactly zero", () => {
    const models: Model[] = [
      makePricedModel({
        id: "openai/gpt-4o",
        provider: "openrouter",
        pricing: {
          prompt: "0.000002",
          completion: "0.000008",
          image: "0",
          request: "0",
          input_cache_read: "0",
          input_cache_write: "0",
          web_search: "0",
          internal_reasoning: "0",
        },
      }),
      makePricedModel({ id: "llama3.2:3b", provider: "ollama", local: { path: "/x" } }),
    ];
    const presetsById = buildComboEstimatePresetLookup([
      {
        id: "priced",
        name: "Priced",
        hotkey: "",
        systemPrompt: "",
        model: "openrouter::openai/gpt-4o",
        isBuiltIn: false,
      },
      { id: "local", name: "Local", hotkey: "", systemPrompt: "", model: "ollama::llama3.2:3b", isBuiltIn: false },
    ]);
    const estimate = estimateCombo({
      steps: [makeStep("s1", "priced"), makeStep("s2", "local")],
      presetsById,
      globalDefaultModelRef: "",
      models,
      priceMap: buildPriceMap(models),
    });
    expect(estimate.cost.status).toBe("ok");
    expect(estimate.cost.totalUsd).toBeCloseTo(0.00224, 6);
  });
});

describe("estimateComboPreset", () => {
  it("is a thin wrapper over estimateCombo taking a whole combo's steps", () => {
    const presetsById = buildComboEstimatePresetLookup([]);
    const viaWrapper = estimateComboPreset(
      { steps: [makeStep("s1", "missing")] },
      presetsById,
      "",
      [],
      new Map(),
    );
    const viaDirect = estimateCombo({
      steps: [makeStep("s1", "missing")],
      presetsById,
      globalDefaultModelRef: "",
      models: [],
      priceMap: new Map(),
    });
    expect(viaWrapper).toEqual(viaDirect);
  });
});
