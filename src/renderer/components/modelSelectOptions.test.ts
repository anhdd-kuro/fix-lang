// Copy is derived through the real translator kernel, not a stub, so a catalog
// reword cannot silently pass.
import { describe, expect, it } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { PROVIDER_ORDER, type Model } from "~/shared/providers";
import {
  buildModelOptionGroups,
  EMPTY_GROUP_OPTION_PREFIX,
  findOption,
  formatModelDetail,
  modelOptionText,
  normalizeModelTimestamp,
  PROVIDER_LABEL_KEYS,
  resolveModelSelectCopy,
  withInheritOption,
  withUnavailableOption,
  type ModelOptionGroup,
} from "./modelSelectOptions";
import { matchesSearch } from "./SearchableSelect";

const t = createTranslator("en");
const tJa = createTranslator("ja");
const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;
const deps = { t, formatCurrency };

const cloud = (id: string, provider: Model["provider"], prompt = "0.0000012"): Model => ({
  id,
  name: id,
  created: 1_700_000_000,
  provider,
  pricing: {
    prompt,
    completion: "0",
    image: "0",
    request: "0",
    input_cache_read: "0",
    input_cache_write: "0",
    web_search: "0",
    internal_reasoning: "0",
  },
});

const local = (id: string, size?: number): Model => ({
  id,
  name: id,
  created: 1_700_000_000_000,
  provider: "ollama",
  local: { path: `/models/${id}`, ...(size === undefined ? {} : { size }) },
});

const MODELS: Model[] = [
  cloud("gpt-5-mini", "openai"),
  cloud("anthropic/claude-opus-4.5", "openrouter"),
  local("llama3.2:3b", 3),
];

const build = (
  models: readonly Model[] = MODELS,
  overrides: Partial<Parameters<typeof buildModelOptionGroups>[1]> = {},
): ModelOptionGroup[] =>
  buildModelOptionGroups(models, {
    ...deps,
    enabledProviders: PROVIDER_ORDER,
    ...overrides,
  });

describe("buildModelOptionGroups — grouping, ordering and the value/label contract", () => {
  it("emits one group per enabled provider, in PROVIDER_ORDER, headed by the localized provider name", () => {
    const groups = build();

    expect(groups.map((group) => group.provider)).toEqual([
      "openai",
      "openrouter",
      "ollama",
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      t("models.select.provider.openai"),
      t("models.select.provider.openrouter"),
      t("models.select.provider.ollama"),
    ]);
  });

  it("drops a provider that is not connected instead of showing an empty group for it", () => {
    const groups = build(MODELS, { enabledProviders: ["openai", "ollama"] });
    expect(groups.map((group) => group.provider)).toEqual(["openai", "ollama"]);
  });

  it("gives every option the composite ref as `value` and the RAW model id as `label`", () => {
    const groups = build();
    const options = groups.flatMap((group) => group.options);

    expect(options.map((option) => option.value)).toEqual([
      "openai::gpt-5-mini",
      "openrouter::anthropic/claude-opus-4.5",
      "ollama::llama3.2:3b",
    ]);
    expect(options.map((option) => option.label)).toEqual([
      "gpt-5-mini",
      "anthropic/claude-opus-4.5",
      "llama3.2:3b",
    ]);
    expect(options.every((option) => option.label === option.modelId)).toBe(true);
  });

  it("refers each row to ITS OWN group's provider when a model is served by two", () => {
    // Kills: building the ref from `modelRefForModel` (which scans
    // PROVIDER_ORDER) would label the openrouter row "openai::…".
    const shared: Model = { id: "shared-1", name: "shared-1", created: 1 };
    const groups = build([shared]);
    const openrouterGroup = groups.find((group) => group.provider === "openrouter");
    expect(openrouterGroup?.options[0]?.value).toBe("openrouter::shared-1");
  });

  it("localizes the group headings through t(), not through a hardcoded label map", () => {
    const groups = buildModelOptionGroups(MODELS, {
      t: tJa,
      formatCurrency,
      enabledProviders: ["ollama"],
    });
    expect(groups[0]?.label).toBe(tJa(PROVIDER_LABEL_KEYS.ollama));
  });

  it("omits createdAt and detail when showAdditionalInfo is false", () => {
    const [openai] = build(MODELS, { showAdditionalInfo: false });
    expect(openai?.options[0]?.createdAt).toBeNull();
    expect(openai?.options[0]?.detail).toBe("");
  });
});

describe("the search filter still hits raw model ids", () => {
  const optionFor = (id: string) => {
    const option = findOption(build(), id);
    if (!option) throw new Error(`no option for ${id}`);
    return { value: option.value, label: option.label };
  };

  it('finds "openai::gpt-5-mini" when searching "gpt 5"', () => {
    expect(matchesSearch(optionFor("gpt-5-mini"), "gpt 5")).toBe(true);
    expect(matchesSearch(optionFor("gpt-5-mini"), "GPT-5-MINI")).toBe(true);
  });

  it("never puts the provider name in an option label", () => {
    for (const option of build().flatMap((group) => group.options)) {
      for (const provider of PROVIDER_ORDER) {
        expect(option.label.toLowerCase()).not.toContain(provider);
      }
    }
  });

  it("does not match a model of a DIFFERENT provider when a provider name is searched", () => {
    // A provider-name search is not inert — `value` is the composite ref — but
    // it must never reach across providers.
    expect(matchesSearch(optionFor("llama3.2:3b"), "openai")).toBe(false);
    expect(matchesSearch(optionFor("gpt-5-mini"), "openai")).toBe(true);
  });

  it("rejects a query that matches neither the ref nor the raw id", () => {
    expect(matchesSearch(optionFor("gpt-5-mini"), "mistral")).toBe(false);
  });
});

describe("an empty but connected provider keeps its heading", () => {
  it("renders a disabled placeholder row carrying the empty message, not a missing group", () => {
    const groups = build([cloud("gpt-5-mini", "openai")]);
    const ollama = groups.find((group) => group.provider === "ollama");

    expect(ollama).toBeDefined();
    expect(ollama?.options).toHaveLength(1);
    expect(ollama?.options[0]?.isDisabled).toBe(true);
    expect(ollama?.options[0]?.value).toBe(`${EMPTY_GROUP_OPTION_PREFIX}ollama`);
    expect(modelOptionText(ollama?.options[0] ?? never(), t)).toBe(
      t("models.select.group.empty", { provider: t("models.select.provider.ollama") }),
    );
  });
});

describe("a per-provider error degrades only its own group", () => {
  it("attaches the error to that group and leaves the other groups' options intact", () => {
    const groups = build(MODELS, { errors: { openrouter: "502 Bad Gateway" } });
    const byProvider = indexByProvider(groups);

    expect(byProvider.openrouter?.error).toBe(
      t("models.select.group.error", {
        provider: t("models.select.provider.openrouter"),
      }),
    );
    expect(byProvider.openai?.error).toBeUndefined();
    expect(byProvider.ollama?.error).toBeUndefined();
    expect(byProvider.openai?.options.map((option) => option.value)).toEqual([
      "openai::gpt-5-mini",
    ]);
    expect(byProvider.ollama?.options.map((option) => option.value)).toEqual([
      "ollama::llama3.2:3b",
    ]);
  });

  it("renders no error line at all when the fetch reported none", () => {
    expect(build().every((group) => group.error === undefined)).toBe(true);
  });
});

describe("withUnavailableOption — surfaces a stored ref that no longer resolves", () => {
  it("yields a disabled option whose value is EXACTLY the stored ref, in an Unavailable group", () => {
    const groups = withUnavailableOption(build(), "openai::ghost", t);
    const unavailable = groups[groups.length - 1];

    expect(unavailable?.label).toBe(t("models.select.group.unavailable"));
    expect(unavailable?.provider).toBeNull();
    expect(unavailable?.options).toHaveLength(1);
    expect(unavailable?.options[0]?.value).toBe("openai::ghost");
    expect(unavailable?.options[0]?.isDisabled).toBe(true);
    expect(unavailable?.options[0]?.isUnavailable).toBe(true);
    expect(modelOptionText(unavailable?.options[0] ?? never(), t)).toBe(
      t("models.select.option.unavailable", { model: "ghost" }),
    );
  });

  it("leaves the other groups untouched", () => {
    const base = build();
    const groups = withUnavailableOption(base, "openai::ghost", t);
    expect(groups.slice(0, base.length)).toEqual(base);
  });

  it("adds nothing when the ref already resolves", () => {
    const base = build();
    expect(withUnavailableOption(base, "openai::gpt-5-mini", t)).toEqual(base);
    expect(withUnavailableOption(base, "gpt-5-mini", t)).toEqual(base);
  });

  it('adds nothing for the inherit sentinel — "" means "use the default", not "gone"', () => {
    const base = build();
    expect(withUnavailableOption(base, "", t)).toEqual(base);
  });
});

describe("withInheritOption — adds a selectable \"\" row naming the resolved default", () => {
  it('emits an explicit `value: ""` option that findOption("") returns', () => {
    const groups = withInheritOption(build(), "openai::gpt-5-mini");
    const inherit = findOption(groups, "");

    expect(inherit).not.toBeNull();
    expect(inherit?.value).toBe("");
    expect(inherit?.kind).toBe("inherit");
    expect(inherit?.isDisabled).toBe(false);
    expect(modelOptionText(inherit ?? never(), t)).toBe(t("models.select.option.inherit"));
  });

  it("names the model the default currently resolves to", () => {
    const groups = withInheritOption(build(), "openai::gpt-5-mini");
    expect(findOption(groups, "")?.detail).toBe("gpt-5-mini");
  });

  it("leaves the detail blank when the default is itself unset or unresolvable", () => {
    expect(findOption(withInheritOption(build(), ""), "")?.detail).toBe("");
    expect(findOption(withInheritOption(build(), "openai::ghost"), "")?.detail).toBe("");
  });

  it('without it, findOption("") finds nothing — the blank-control failure mode', () => {
    expect(findOption(build(), "")).toBeNull();
  });
});

describe("findOption", () => {
  it("resolves a bare id to the first provider in PROVIDER_ORDER that serves it", () => {
    const both = build([cloud("dup", "openai"), cloud("dup", "openrouter")]);
    expect(findOption(both, "dup")?.value).toBe("openai::dup");
  });

  it("returns null for an absent ref", () => {
    expect(findOption(build(), "openai::ghost")).toBeNull();
    expect(findOption(build(), "ghost")).toBeNull();
  });

  it("prefers an exact ref match over the bare-id scan", () => {
    const both = build([cloud("dup", "openai"), cloud("dup", "openrouter")]);
    expect(findOption(both, "openrouter::dup")?.value).toBe("openrouter::dup");
  });

  it("never resolves a bare id against a non-model row", () => {
    const groups = withUnavailableOption(build(), "openai::ghost", t);
    expect(findOption(groups, "openai::ghost")).not.toBeNull();
    expect(findOption(groups, "ghost")).toBeNull();
  });

  it("never returns an empty group's placeholder for the inherit sentinel", () => {
    // The placeholder's `modelId` is "" too, so only an exact `value` match
    // may answer "".
    const groups = build([cloud("gpt-5-mini", "openai")]);
    expect(findOption(groups, "")).toBeNull();
  });
});

describe("formatModelDetail", () => {
  it("prices a cloud model per million tokens", () => {
    expect(formatModelDetail(cloud("gpt-5-mini", "openai"), deps)).toBe(
      t("models.select.detail.pricePerMillion", { price: "$1.20" }),
    );
  });

  it("shows a parameter count for a sized local model", () => {
    expect(formatModelDetail(local("llama3.2:3b", 7), deps)).toBe("7B");
  });

  it("falls back to the generic local badge when the size is unknown", () => {
    expect(formatModelDetail(local("llama3.2:3b"), deps)).toBe(t("models.select.localLlm"));
  });

  it("claims no price for a cloud model that reports none", () => {
    // Kills: coercing an absent price to 0, which claims the model is free.
    expect(formatModelDetail({ id: "gpt-5-mini" } as never, deps)).toBe("");
  });

  it("still prints a genuine zero price", () => {
    expect(formatModelDetail(cloud("free-1", "openrouter", "0"), deps)).toBe(
      t("models.select.detail.pricePerMillion", { price: "$0.00" }),
    );
  });
});

describe("the empty-group placeholder stays out of the search haystack", () => {
  it("does not match a readable word from its own sentinel", () => {
    const groups = build([cloud("gpt-5-mini", "openai")]);
    const placeholder = groups.find((group) => group.provider === "ollama")?.options[0];
    const searchable = { value: placeholder?.value ?? "", label: placeholder?.label ?? "" };

    // Kills: a readable prefix like "__fixlang-empty__".
    expect(matchesSearch(searchable, "empty")).toBe(false);
    expect(matchesSearch(searchable, "fixlang")).toBe(false);
    expect(matchesSearch(searchable, "ollama")).toBe(true);
  });
});

describe("normalizeModelTimestamp", () => {
  it("scales cloud SECONDS to milliseconds", () => {
    expect(normalizeModelTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it("leaves Ollama MILLISECONDS alone", () => {
    expect(normalizeModelTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("is applied to the option's createdAt for both shapes", () => {
    const groups = build();
    const byProvider = indexByProvider(groups);
    expect(byProvider.openai?.options[0]?.createdAt).toBe(1_700_000_000_000);
    expect(byProvider.ollama?.options[0]?.createdAt).toBe(1_700_000_000_000);
  });
});

describe("resolveModelSelectCopy — the default the other four call sites get", () => {
  it("defaults to the generic AI-model copy", () => {
    expect(resolveModelSelectCopy({})).toEqual({
      labelKey: "models.select.label",
      descriptionKey: "models.select.description.default",
    });
  });

  it("defaults to the feature description for a feature picker", () => {
    expect(resolveModelSelectCopy({ useFeatureModel: true }).descriptionKey).toBe(
      "models.select.description.feature",
    );
  });

  it("honours an explicit override (what Settings → General passes)", () => {
    expect(
      resolveModelSelectCopy({
        labelKey: "settings.general.defaultModel.label",
        descriptionKey: "settings.general.defaultModel.description",
      }),
    ).toEqual({
      labelKey: "settings.general.defaultModel.label",
      descriptionKey: "settings.general.defaultModel.description",
    });
  });
});

/** Fails loudly instead of letting `?? undefined` turn a missing option into a pass. */
function never(): never {
  throw new Error("expected an option to be present");
}

function indexByProvider(
  groups: readonly ModelOptionGroup[],
): Partial<Record<string, ModelOptionGroup>> {
  const indexed: Partial<Record<string, ModelOptionGroup>> = {};
  for (const group of groups) {
    indexed[group.provider ?? "none"] = group;
  }
  return indexed;
}
