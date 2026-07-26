/**
 * @file modelSelectOptions.ts
 * @description Pure option/group model behind `<ModelSelect>`'s grouped
 * picker. Everything worth pinning about the picker — grouping by provider,
 * the per-group error, the empty-group placeholder, the "no longer available"
 * option and the inherit sentinel — lives here rather than in a `useMemo`
 * inside the component, so it is unit-testable without rendering React.
 *
 * Two invariants this file exists to protect:
 *
 * 1. **`value` is the composite ref, `label` is the RAW model id.**
 *    `SearchableSelect`'s `matchesSearch` filters on `value` + `label`, so
 *    decorating `label` with a price/date/provider breaks search for the very
 *    ids users type. The decorated text is carried in separate structured
 *    fields (`modelId` / `createdAt` / `detail`) that the `Option` renderer
 *    lays out — it never re-parses a joined string, which is what the
 *    comma-splitting renderer this replaces did.
 *
 * 2. **Provider display names come from `t()`, never from a TypeScript
 *    constant.** `PROVIDER_LABEL_KEYS` below is the ONE key map; the provider
 *    cards in `SettingGeneral.tsx` import it from here so a card and a group
 *    heading can never name the same provider differently.
 *    `PROVIDER_LOG_LABELS` in `~/shared/providers` is diagnostics-only and
 *    must never be rendered.
 *
 * Provider *values* (`PROVIDER_ORDER`, `modelsForProvider`, …) are imported
 * from `~/shared/providers` directly, never through `~/stores/apiStore`'s
 * re-export shim — that module constructs an `electron-store` at import and a
 * value import of it from renderer code breaks `bun run build` (finding F9).
 */
import { formatModelRef, parseModelRef } from "~/shared/modelRef";
import {
  modelsForProvider,
  PROVIDER_ORDER,
  type Model,
  type ProviderId,
} from "~/shared/providers";
import type { TranslationKey } from "~/shared/i18n/keys";
import type { Translator } from "~/shared/i18n/translate";

/**
 * Provider brand names are proper nouns (unchanged across locales) but stay
 * routed through `t()` so there is exactly one source for them. Shared by the
 * group headings here and by the provider cards in `SettingGeneral.tsx`.
 */
export const PROVIDER_LABEL_KEYS: Readonly<Record<ProviderId, TranslationKey>> =
  Object.freeze({
    openai: "models.select.provider.openai",
    openrouter: "models.select.provider.openrouter",
    ollama: "models.select.provider.ollama",
  });

/**
 * Which of the four row shapes an option is.
 *
 * A small extension to the shape the card specified: the renderer has to tell
 * a real model row from the inherit sentinel, the "no longer available" row
 * and an empty group's placeholder, and doing that by sniffing `value === ""`
 * plus `isUnavailable` plus a magic value prefix would spread the decision
 * across the component instead of keeping it here.
 */
export type ModelOptionKind = "model" | "inherit" | "unavailable" | "empty";

export type ModelOption = {
  /** The composite ref — this is what gets stored. `""` for inherit. */
  value: string;
  /** The RAW model id — this is what search matches. Never decorated. */
  label: string;
  /** Raw model id again, for display. Empty for inherit/empty placeholders. */
  modelId: string;
  provider: ProviderId | null;
  /** Unix **milliseconds**, already normalized. `null` when not shown. */
  createdAt: number | null;
  /** "$1.20 / 1M tokens" | "7B" | "Local LLM" — or the resolved default id for inherit. */
  detail: string;
  isLocal: boolean;
  isUnavailable: boolean;
  isDisabled: boolean;
  kind: ModelOptionKind;
};

export type ModelOptionGroup = {
  /** Already-localized heading text. `""` renders no heading (the inherit group). */
  label: string;
  provider: ProviderId | null;
  options: ModelOption[];
  /** Already-localized "could not load" line, shown inside the heading. */
  error?: string;
};

/**
 * Sentinel prefix for an empty group's single disabled placeholder row.
 *
 * A single NUL — deliberately not a readable word. `matchesSearch` normalizes
 * `value + " " + label` by stripping every non-alphanumeric char, so a
 * readable prefix (`__fixlang-empty__`) would make every placeholder row
 * match a search for "empty" or "fixlang". A NUL normalizes away, leaving
 * only the provider id — so "openai" still surfaces "No models from OpenAI",
 * which is the useful half. It can never collide with a real composite ref.
 */
export const EMPTY_GROUP_OPTION_PREFIX = "\u0000";

export type ModelOptionDeps = {
  t: Translator;
  /** From `useI18n()` — already bound to the active locale. */
  formatCurrency: (value: number, currency?: string) => string;
};

/**
 * Cloud APIs report `created` in Unix **seconds**; Ollama reports Unix
 * **milliseconds**. Seconds timestamps have at most 10 digits until the year
 * 2286, milliseconds have 13 — the same discriminator card 04's history sort
 * uses. Lifted from `modelOptionLabel.ts` so the grouped picker and the legacy
 * label builder cannot disagree about the same field.
 */
export const normalizeModelTimestamp = (timestamp: number): number => {
  const isLikelySeconds = Math.floor(Math.log10(timestamp) + 1) <= 10;
  return isLikelySeconds ? timestamp * 1000 : timestamp;
};

/**
 * The trailing badge for one model row: a parameter count for a sized local
 * model, a generic "Local LLM" for an unsized one, and a per-million-token
 * price for a cloud model.
 */
export const formatModelDetail = (
  model: Pick<Model, "local" | "pricing">,
  deps: ModelOptionDeps,
): string => {
  if (model.local !== undefined) {
    return model.local.size
      ? `${String(model.local.size)}B`
      : deps.t("models.select.localLlm");
  }
  // No pricing at all (OpenAI's /v1/models reports none) means "unknown", not
  // "free". The legacy comma-joined label coerced it to 0 and printed
  // "$0.00 / 1M tokens"; in a dedicated badge that reads as a claim, so an
  // absent price now renders no badge.
  const prompt = model.pricing?.prompt;
  if (prompt === undefined || prompt === "") return "";
  // Pre-formatted currency is passed as a *string* so `t()` does not re-run
  // its own numeric formatting over it.
  return deps.t("models.select.detail.pricePerMillion", {
    price: deps.formatCurrency(+prompt * 1_000_000, "USD"),
  });
};

const emptyPlaceholder = (provider: ProviderId): ModelOption => ({
  value: `${EMPTY_GROUP_OPTION_PREFIX}${provider}`,
  label: "",
  modelId: "",
  provider,
  createdAt: null,
  detail: "",
  isLocal: false,
  isUnavailable: false,
  isDisabled: true,
  kind: "empty",
});

export type BuildModelOptionGroupsOptions = ModelOptionDeps & {
  /** When false, `createdAt`/`detail` are omitted (the compact tray picker). */
  showAdditionalInfo?: boolean;
  /** Per-provider fetch failures from `fetch-ai-models`. */
  errors?: Partial<Record<ProviderId, string>>;
  /**
   * Restrict to the providers the user has connected. Omit to show every
   * provider in `PROVIDER_ORDER`.
   */
  enabledProviders?: readonly ProviderId[];
};

/**
 * One group per enabled provider, in `PROVIDER_ORDER`.
 *
 * A connected provider with no models keeps its heading and carries a single
 * disabled placeholder row, so "connected but empty" is visibly different
 * from "not connected" (which drops the group entirely).
 *
 * A provider's fetch error attaches to **that group only** — the other groups
 * keep their options, which is the whole point of the fan-out fetch returning
 * a per-provider `errors` map instead of one global failure.
 */
export const buildModelOptionGroups = (
  models: readonly Model[],
  options: BuildModelOptionGroupsOptions,
): ModelOptionGroup[] => {
  const {
    showAdditionalInfo = true,
    errors,
    enabledProviders,
    t,
    formatCurrency,
  } = options;

  const order =
    enabledProviders === undefined
      ? PROVIDER_ORDER
      : PROVIDER_ORDER.filter((provider) => enabledProviders.includes(provider));

  return order.map((provider) => {
    const providerName = t(PROVIDER_LABEL_KEYS[provider]);
    const groupOptions = modelsForProvider(models, provider).map<ModelOption>(
      (model) => ({
        // The group's provider, NOT `modelRefForModel` — a model served by two
        // providers appears in both groups and each row must refer to its own.
        value: formatModelRef(provider, model.id),
        label: model.id,
        modelId: model.id,
        provider,
        createdAt: showAdditionalInfo ? normalizeModelTimestamp(model.created) : null,
        detail: showAdditionalInfo ? formatModelDetail(model, { t, formatCurrency }) : "",
        isLocal: model.local !== undefined,
        isUnavailable: false,
        isDisabled: false,
        kind: "model",
      }),
    );

    const error = errors?.[provider];
    return {
      label: providerName,
      provider,
      options: groupOptions.length > 0 ? groupOptions : [emptyPlaceholder(provider)],
      ...(error === undefined
        ? {}
        : { error: t("models.select.group.error", { provider: providerName }) }),
    };
  });
};

/**
 * Find the option a stored ref names.
 *
 * Exact `value` match first (so `""` finds the inherit option and nothing
 * else), then a bare-id fallback that scans real model rows in group order —
 * the same `PROVIDER_ORDER` precedence `resolveModelRef` uses, so a legacy
 * un-prefixed id renders as the provider it would actually be billed to.
 */
export const findOption = (
  groups: readonly ModelOptionGroup[],
  ref: string,
): ModelOption | null => {
  for (const group of groups) {
    for (const option of group.options) {
      if (option.value === ref) return option;
    }
  }
  if (ref === "") return null;
  for (const group of groups) {
    for (const option of group.options) {
      if (option.kind === "model" && option.modelId === ref) return option;
    }
  }
  return null;
};

/**
 * Keep a stored-but-missing selection visible instead of rendering a blank
 * control. Adds nothing when the ref already resolves, and nothing for the
 * inherit sentinel (`""` is not "unavailable" — it means "use the default").
 */
export const withUnavailableOption = (
  groups: readonly ModelOptionGroup[],
  storedRef: string,
  t: Translator,
): ModelOptionGroup[] => {
  if (storedRef === "" || findOption(groups, storedRef) !== null) {
    return [...groups];
  }

  const parsed = parseModelRef(storedRef);
  return [
    ...groups,
    {
      label: t("models.select.group.unavailable"),
      provider: null,
      options: [
        {
          // Exactly the stored ref — the control has to render the value the
          // profile actually holds, not a normalized guess at it.
          value: storedRef,
          label: parsed.modelId,
          modelId: parsed.modelId,
          provider: parsed.provider,
          createdAt: null,
          detail: "",
          isLocal: false,
          isUnavailable: true,
          isDisabled: true,
          kind: "unavailable",
        },
      ],
    },
  ];
};

/**
 * Prepend the explicit inherit row.
 *
 * **This is load bearing.** Presets pass `selectedModelId={preset.model}`,
 * which is `""` for "inherit the global default". Without an option whose
 * `value` is literally `""`, react-select has nothing to match and every
 * inheriting preset renders as a bare placeholder.
 *
 * `defaultRef` is only used to show *which* model inherit currently resolves
 * to; an unresolvable or empty default just leaves the detail blank.
 */
export const withInheritOption = (
  groups: readonly ModelOptionGroup[],
  defaultRef: string,
): ModelOptionGroup[] => {
  const resolved = defaultRef === "" ? null : findOption(groups, defaultRef);
  return [
    {
      // Empty heading — `GroupHeading` renders nothing for it, so the single
      // inherit row does not get a meaningless section title of its own.
      label: "",
      provider: null,
      options: [
        {
          value: "",
          label: "",
          modelId: "",
          provider: null,
          createdAt: null,
          detail: resolved?.modelId ?? "",
          isLocal: false,
          isUnavailable: false,
          isDisabled: false,
          kind: "inherit",
        },
      ],
    },
    ...groups,
  ];
};

/**
 * The primary text for one option row. Kept here (not in the component) so
 * the empty/inherit/unavailable copy is pinned by a test rather than only by
 * reading JSX.
 *
 * Note what this never returns: a provider name for a `"model"` row. The
 * provider appears in the group heading and nowhere else (D31).
 */
export const modelOptionText = (option: ModelOption, t: Translator): string => {
  switch (option.kind) {
    case "inherit":
      return t("models.select.option.inherit");
    case "unavailable":
      return t("models.select.option.unavailable", { model: option.modelId });
    case "empty":
      return t("models.select.group.empty", {
        provider: option.provider === null ? "" : t(PROVIDER_LABEL_KEYS[option.provider]),
      });
    default:
      return option.modelId;
  }
};

export type ModelSelectCopyKeys = {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
};

/**
 * Which label/description copy a `<ModelSelect>` instance renders.
 *
 * The General tab is the only caller that overrides these (it is the profile's
 * "Default model" section, not a generic "AI Model" picker). Extracted so the
 * *defaults* — what the other four call sites get — are pinned by a test
 * instead of by reading the component's prop initializers.
 */
export const resolveModelSelectCopy = (options: {
  labelKey?: TranslationKey;
  descriptionKey?: TranslationKey;
  useFeatureModel?: boolean;
}): ModelSelectCopyKeys => ({
  labelKey: options.labelKey ?? "models.select.label",
  descriptionKey:
    options.descriptionKey ??
    (options.useFeatureModel
      ? "models.select.description.feature"
      : "models.select.description.default"),
});
