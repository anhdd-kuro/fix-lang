import { formatModelRef, parseModelRef } from "~/shared/modelRef";
import {
  modelsForProvider,
  PROVIDER_ORDER,
  type Model,
  type ProviderId,
} from "~/shared/providers";
import type { TranslationKey } from "~/shared/i18n/keys";
import type { Translator } from "~/shared/i18n/translate";

/** The one source of provider display names — group headings and provider cards share it. */
export const PROVIDER_LABEL_KEYS: Readonly<Record<ProviderId, TranslationKey>> =
  Object.freeze({
    openai: "models.select.provider.openai",
    openrouter: "models.select.provider.openrouter",
    ollama: "models.select.provider.ollama",
  });

export type ModelOptionKind = "model" | "inherit" | "unavailable" | "empty";

export type ModelOption = {
  value: string;
  /** The RAW model id — react-select searches on `label`, so never decorate it. */
  label: string;
  modelId: string;
  provider: ProviderId | null;
  /** Unix **milliseconds**, already normalized. `null` when not shown. */
  createdAt: number | null;
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
  error?: string;
};

/**
 * Must stay a non-alphanumeric sentinel: `matchesSearch` strips those, so a
 * readable prefix would make every placeholder row match a search for it.
 */
export const EMPTY_GROUP_OPTION_PREFIX = "\u0000";

export type ModelOptionDeps = {
  t: Translator;
  formatCurrency: (value: number, currency?: string) => string;
};

/** Cloud APIs report `created` in seconds (≤10 digits until 2286); Ollama reports ms. */
export const normalizeModelTimestamp = (timestamp: number): number => {
  const isLikelySeconds = Math.floor(Math.log10(timestamp) + 1) <= 10;
  return isLikelySeconds ? timestamp * 1000 : timestamp;
};

export const formatModelDetail = (
  model: Pick<Model, "local" | "pricing">,
  deps: ModelOptionDeps,
): string => {
  if (model.local !== undefined) {
    return model.local.size
      ? `${String(model.local.size)}B`
      : deps.t("models.select.localLlm");
  }
  // An absent price means unknown, not free — render no badge rather than "$0.00".
  const prompt = model.pricing?.prompt;
  if (prompt === undefined || prompt === "") return "";
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
  errors?: Partial<Record<ProviderId, string>>;
  /** Omit to show every provider in `PROVIDER_ORDER`. */
  enabledProviders?: readonly ProviderId[];
};

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
        // The group's provider, not the model's own — a model served by two
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
 * Exact `value` match first, then a bare-id fallback in `PROVIDER_ORDER` — the
 * same precedence `resolveModelRef` bills against, so a legacy un-prefixed id
 * renders as the provider that would actually serve it.
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
 * control. `""` is inherit, not unavailable.
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
          // Verbatim: an unreachable provider must not silently rewrite the
          // ref the profile actually holds.
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
 * Load bearing: presets store `""` for inherit, so without an option whose
 * `value` is literally `""` react-select renders them as a bare placeholder.
 */
export const withInheritOption = (
  groups: readonly ModelOptionGroup[],
  defaultRef: string,
): ModelOptionGroup[] => {
  const resolved = defaultRef === "" ? null : findOption(groups, defaultRef);
  return [
    {
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

// Separate from `modelOptionText` on purpose: the menu rows sit under a
// provider heading already, so only the closed control gets the provider.
export const selectedModelOptionText = (option: ModelOption, t: Translator): string => {
  if (option.kind !== "model" || option.provider === null) {
    return modelOptionText(option, t);
  }
  return t("models.select.option.selected", {
    provider: t(PROVIDER_LABEL_KEYS[option.provider]),
    model: option.modelId,
  });
};

export type ModelSelectCopyKeys = {
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
};

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
