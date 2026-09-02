/**
 * @file comboEstimate.ts
 * @description PURE derivation for the Settings combo row's cost and
 * provider transparency (design risk 5 + risk 6): before a user binds a
 * hotkey to a combo, they can see roughly how many tokens one run costs and
 * — the headline, not a footnote — the distinct list of vendors it will
 * send their selected text to. Three steps on three providers means one
 * keystroke fans the same selection out to three companies; the point of
 * this module is to make that visible on the settings row instead of
 * something the user could only infer by opening three separate preset
 * screens.
 *
 * Reuses the app's real cost math (`buildPriceMap`/`computeCost` from
 * `~/main/ai.request/cost`) and the real token estimator
 * (`estimateTextTokens` from `~/features/history/store/historyTypes`)
 * instead of a second copy that could silently drift from either. Both of
 * those modules — like this one — have zero Electron/`electron-store`
 * import at runtime (verified: their only non-type imports are `fuse.js`
 * and the Electron-free `modelRef`/`providers` modules), so they are safe to
 * import directly from the renderer. Every import of `apiStore` below is
 * `import type` only, which TypeScript erases at build time — a VALUE
 * import of that module would pull `electron-store` into the renderer
 * bundle (see the same caveat already documented in `ModelSelect.tsx`).
 *
 * No Electron or React import — safe for Vitest without mocks.
 */
import { estimateTextTokens } from "~/features/history/store/historyTypes";
import { resolveModelRef } from "~/features/providers/shared/modelRef";
import { PROVIDER_ORDER } from "~/features/providers/shared/providers";
import {
  buildPriceMap,
  computeCost,
  type CostStatus,
  type PriceMap,
} from "~/main/ai.request/cost";
import { resolveCostDisplay, type CostDisplay } from "./historyCost";
import type {
  ComboPreset,
  ComboStep,
  CorrectionPreset,
  Model,
  ProviderId,
} from "~/features/providers/store/apiStore";

export { buildPriceMap, type PriceMap };

// --- Token estimate ------------------------------------------------------

/**
 * Settings-time has no real selection to measure — the user hasn't
 * highlighted anything yet, this is shown while editing the combo. Stand in
 * with a fixed-length placeholder sized like a typical paste (a paragraph),
 * and run it through the app's own token estimator rather than inventing a
 * second chars-per-token ratio that could drift from `estimateTextTokens`'s.
 */
export const COMBO_ESTIMATE_BASELINE_CHARS = 800;

/**
 * Applied once per step transition: a step's output becomes the next step's
 * full input (design risk 6 — "each step re-sends the full text"). Individual
 * presets range from shrinking (Summarize, Translate) to growing (Correction
 * elaborating, Prompt optimization, Business Writing formalizing, Structured
 * Text adding markup), so no single per-preset multiplier is honest without
 * running the model. This is a WARNING threshold input, not a bill — the
 * app's existing cost-honesty rule already prefers an admitted "N/A" over a
 * fabricated number (see `cost.ts`'s header), and the same bias applies here:
 * a factor that leans toward over-counting is safer than one that
 * under-warns a genuinely growing chain. 1.15 (a flat +15% per hop) is a
 * deliberately round, moderate lean in that direction.
 */
export const COMBO_TOKEN_GROWTH_FACTOR = 1.15;

/**
 * Above this estimated total-tokens-per-run, the combo row shows a
 * token-volume warning. With the baseline and growth factor above, a 2-step
 * combo lands under this line and a 3-step-or-longer combo lands over it —
 * that is a fact about step count, not about how many vendors are involved.
 * A combo can cross this line while talking to exactly one provider (e.g.
 * three Ollama steps), so this signal is deliberately independent of
 * `ComboEstimate.hasMultipleProviders`: the warning text built from each
 * must never claim the other's condition.
 */
export const COMBO_TOKEN_WARNING_THRESHOLD = 1000;

/** `estimateTextTokens` run once over the fixed-length baseline placeholder. */
export const comboEstimateBaselineTokens = (): number =>
  estimateTextTokens("x".repeat(COMBO_ESTIMATE_BASELINE_CHARS));

export type ComboStepTokenEstimate = {
  /** Tokens the step sends as input — the previous step's (grown/shrunk) output. */
  promptTokens: number;
  /** Tokens the step's output is assumed to carry into the next step. */
  completionTokens: number;
};

/**
 * One entry per step, each compounding on the last via `COMBO_TOKEN_GROWTH_FACTOR`.
 * Independent of which preset actually runs — the growth factor is a blanket,
 * per-hop assumption because a step's real output size is only known once the
 * model actually runs, which a save-time estimate cannot do.
 */
export const estimateComboStepTokens = (
  stepCount: number,
): ComboStepTokenEstimate[] => {
  const steps: ComboStepTokenEstimate[] = [];
  let running = comboEstimateBaselineTokens();
  for (let index = 0; index < stepCount; index += 1) {
    const completionTokens = Math.ceil(running * COMBO_TOKEN_GROWTH_FACTOR);
    steps.push({ promptTokens: running, completionTokens });
    running = completionTokens;
  }
  return steps;
};

export const totalComboTokens = (
  stepTokens: readonly ComboStepTokenEstimate[],
): number =>
  stepTokens.reduce(
    (sum, step) => sum + step.promptTokens + step.completionTokens,
    0,
  );

// --- Provider resolution --------------------------------------------------

/**
 * A preset with an empty `model` inherits the profile's global default model
 * — a DIFFERENT provider than the preset itself names. Mirrors the real
 * request path's `effectiveModelRef` (`~/main/ai.request/correction.ts`),
 * which cannot be imported here: it calls `getDefaultModelId()`, which reads
 * the live main-process store. The renderer already knows the same value
 * (`window.electronAPI.getSelectedModel()`, wired to that exact function),
 * so it is supplied as a parameter instead of re-fetched.
 */
export const effectiveComboStepModelRef = (
  preset: Pick<CorrectionPreset, "model"> | undefined,
  globalDefaultModelRef: string,
): string =>
  preset?.model?.trim() || globalDefaultModelRef.trim();

export type ComboStepProviderResolution = {
  /** `null` when the ref is empty, or a bare id that matches no fetched model. */
  provider: ProviderId | null;
  model: Model | null;
};

/**
 * Resolves a step's provider the same way the real request path would route
 * it: `resolveModelRef` checks the ref's own provider prefix first, and only
 * a bare id scans every connected provider's catalogue for a match — it
 * never guesses a provider from the id's shape (see the model-refs gotcha:
 * "a silent wrong answer with no error").
 */
export const resolveComboStepProvider = (
  preset: Pick<CorrectionPreset, "model"> | undefined,
  globalDefaultModelRef: string,
  models: readonly Model[],
): ComboStepProviderResolution => {
  const ref = effectiveComboStepModelRef(preset, globalDefaultModelRef);
  if (!ref) {
    return { provider: null, model: null };
  }

  const resolved = resolveModelRef(ref, models);
  return resolved
    ? { provider: resolved.provider, model: resolved.model }
    : { provider: null, model: null };
};

// --- Combined estimate -----------------------------------------------------

export type ComboCostEstimate = {
  status: CostStatus;
  /** Null exactly when `status` is `"na"` — never a fabricated number. */
  totalUsd: number | null;
};

/**
 * Renders a combo's cost the same way a history row does: `resolveCostDisplay`
 * (`historyCost.ts`) already owns the rule that a real "ok" cost under one
 * cent gets extra fraction digits so it cannot collapse to the same "$0.00"
 * a genuine "zero" combo shows. Adapting to that shared helper instead of
 * calling `Intl.NumberFormat`'s currency default directly (which is fixed at
 * 2 fraction digits) keeps the two call sites from drifting apart.
 */
export const resolveComboCostDisplay = (cost: ComboCostEstimate): CostDisplay =>
  resolveCostDisplay({
    costStatus: cost.status,
    estimatedCostUsd: cost.totalUsd ?? undefined,
  });

export type ComboEstimate = {
  totalTokens: number;
  /** Token volume alone — says nothing about how many vendors are involved. */
  exceedsWarningThreshold: boolean;
  cost: ComboCostEstimate;
  /** Distinct, ordered by `PROVIDER_ORDER` — the headline of this module. */
  providers: ProviderId[];
  /**
   * True only when the combo's steps resolved to more than one distinct
   * provider — the actual condition behind design risk 5 (one keystroke
   * fanning the selection out to several vendors). Kept independent of
   * `exceedsWarningThreshold` so a single-provider combo is never told it
   * talks to "multiple providers".
   */
  hasMultipleProviders: boolean;
  /** True when at least one step's provider could not be determined. */
  hasUnresolvedProvider: boolean;
};

export type ComboEstimateInput = {
  steps: readonly ComboStep[];
  presetsById: ReadonlyMap<string, Pick<CorrectionPreset, "model">>;
  globalDefaultModelRef: string;
  models: readonly Model[];
  priceMap: PriceMap;
};

/**
 * The combo row's full estimate: tokens, cost, and — the point of this
 * card — who gets the user's selected text.
 *
 * Cost aggregation follows the same honesty rule `cost.ts` already enforces
 * per-step: one unpriced step poisons the total. Summing the known steps and
 * quietly omitting the unknown one would understate what the combo actually
 * costs, which is worse than an admitted "N/A" (see `cost.ts`'s file header).
 * A combo that only ever touches local/Ollama-family providers reports
 * `"zero"` (a real $0, not "unknown"); any step landing on a provider this
 * app cannot price (e.g. direct OpenAI — see `computeCost`) makes the whole
 * combo `"na"`.
 */
export const estimateCombo = (input: ComboEstimateInput): ComboEstimate => {
  const stepTokens = estimateComboStepTokens(input.steps.length);
  const totalTokens = totalComboTokens(stepTokens);

  const providersSeen = new Set<ProviderId>();
  let hasUnresolvedProvider = false;
  // Tracked as booleans, not a mutated `CostStatus`, so the final status is
  // computed once from a plain if/else chain below rather than folded
  // together with per-step mutation.
  let sawNaCost = false;
  let sawOkCost = false;
  let totalUsd = 0;

  for (const [index, step] of input.steps.entries()) {
    const preset = input.presetsById.get(step.presetId);
    const { provider, model } = resolveComboStepProvider(
      preset,
      input.globalDefaultModelRef,
      input.models,
    );

    if (provider) {
      providersSeen.add(provider);
    } else {
      hasUnresolvedProvider = true;
    }

    const tokens = stepTokens[index];
    const snapshot = computeCost(
      {
        provider: provider ?? undefined,
        model: model?.id,
        promptTokens: tokens?.promptTokens,
        completionTokens: tokens?.completionTokens,
      },
      input.priceMap,
    );

    if (snapshot.status === "na") {
      sawNaCost = true;
    } else if (snapshot.status === "ok") {
      sawOkCost = true;
      totalUsd += snapshot.estimatedCostUsd ?? 0;
    }
    // "zero" steps contribute nothing and flip no flag on their own.
  }

  // One unpriceable step poisons the whole total (never a silently-partial
  // sum); a fully local/Ollama combo (neither flag set) is a genuine zero.
  const costStatus: CostStatus = sawNaCost ? "na" : sawOkCost ? "ok" : "zero";

  return {
    totalTokens,
    exceedsWarningThreshold: totalTokens > COMBO_TOKEN_WARNING_THRESHOLD,
    cost: {
      status: costStatus,
      totalUsd: costStatus === "na" ? null : totalUsd,
    },
    providers: PROVIDER_ORDER.filter((provider) => providersSeen.has(provider)),
    hasMultipleProviders: providersSeen.size > 1,
    hasUnresolvedProvider,
  };
};

/** Convenience: builds the `presetsById` lookup `estimateCombo` needs from a preset list. */
export const buildComboEstimatePresetLookup = (
  presets: readonly CorrectionPreset[],
): ReadonlyMap<string, Pick<CorrectionPreset, "model">> =>
  new Map(presets.map((preset) => [preset.id, { model: preset.model }]));

/** Convenience wrapper taking a whole `ComboPreset` instead of just its steps. */
export const estimateComboPreset = (
  combo: Pick<ComboPreset, "steps">,
  presetsById: ReadonlyMap<string, Pick<CorrectionPreset, "model">>,
  globalDefaultModelRef: string,
  models: readonly Model[],
  priceMap: PriceMap,
): ComboEstimate =>
  estimateCombo({
    steps: combo.steps,
    presetsById,
    globalDefaultModelRef,
    models,
    priceMap,
  });
