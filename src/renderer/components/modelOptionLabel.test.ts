/**
 * @file modelOptionLabel.test.ts
 * @description Behavioral coverage for the ModelSelect option-label builder,
 * asserted in both EN and JA — the JA template reorders the price/date
 * clauses, so a locale-blind test would miss a regression back to string
 * concatenation.
 */
import { describe, expect, it } from "vitest";
import { createFormatters } from "~/features/i18n/shared/format";
import { CATALOGS } from "~/features/i18n/shared/locales";
import { LOCALE_CODES } from "~/features/i18n/shared/registry";
import { createTranslator } from "~/features/i18n/shared/translate";
import { buildModelOptionLabel, type ModelForLabel } from "./modelOptionLabel";

const depsFor = (locale: "en" | "ja") => {
  const { formatCurrency, dateFnsLocale } = createFormatters(locale);
  return { t: createTranslator(locale), formatCurrency, dateFnsLocale };
};

// 2024-03-15T00:00:00Z in Unix seconds.
const CREATED_SECONDS = 1710460800;

describe("buildModelOptionLabel", () => {
  it("formats a cloud model's price via formatCurrency (EN)", () => {
    const model: ModelForLabel = {
      id: "openai/gpt-5-mini",
      created: CREATED_SECONDS,
      pricing: { prompt: "0.0000004" } as ModelForLabel["pricing"],
    };
    const label = buildModelOptionLabel(model, depsFor("en"));
    expect(label).toBe("openai/gpt-5-mini, 2024-03-15, $0.40 / 1M tokens");
  });

  it("formats a cloud model's price with the JA word order", () => {
    const model: ModelForLabel = {
      id: "openai/gpt-5-mini",
      created: CREATED_SECONDS,
      pricing: { prompt: "0.0000004" } as ModelForLabel["pricing"],
    };
    const label = buildModelOptionLabel(model, depsFor("ja"));
    expect(label).toBe("openai/gpt-5-mini, 2024-03-15, 100万トークンあたり$0.40");
  });

  it("shows the model size for a local model with a known size (EN)", () => {
    const model: ModelForLabel = {
      id: "llama3:70b",
      created: CREATED_SECONDS,
      local: { path: "/models/llama3-70b.gguf", size: 70 } as ModelForLabel["local"],
    };
    const label = buildModelOptionLabel(model, depsFor("en"));
    expect(label).toBe("llama3:70b, 2024-03-15, 70B");
  });

  it("shows the model size for a local model with a known size (JA)", () => {
    const model: ModelForLabel = {
      id: "llama3:70b",
      created: CREATED_SECONDS,
      local: { path: "/models/llama3-70b.gguf", size: 70 } as ModelForLabel["local"],
    };
    const label = buildModelOptionLabel(model, depsFor("ja"));
    expect(label).toBe("llama3:70b, 2024-03-15, 70B");
  });

  it("falls back to the localized 'Local LLM' badge when size is unknown (EN)", () => {
    const model: ModelForLabel = {
      id: "custom-local-model",
      created: CREATED_SECONDS,
      local: { path: "/models/custom.gguf" } as ModelForLabel["local"],
    };
    const deps = depsFor("en");
    const label = buildModelOptionLabel(model, deps);
    // The "Local LLM" badge text is a catalog value (models.select.localLlm)
    // — derived through the real translator, not hand-restated, so a catalog
    // reword doesn't spuriously break this composition test.
    expect(label).toBe(
      deps.t("models.select.optionLabel.local", {
        id: "custom-local-model",
        createdAt: "2024-03-15",
        size: deps.t("models.select.localLlm"),
      }),
    );
  });

  it("falls back to the localized 'Local LLM' badge when size is unknown (JA)", () => {
    const model: ModelForLabel = {
      id: "custom-local-model",
      created: CREATED_SECONDS,
      local: { path: "/models/custom.gguf" } as ModelForLabel["local"],
    };
    const deps = depsFor("ja");
    const label = buildModelOptionLabel(model, deps);
    expect(label).toBe(
      deps.t("models.select.optionLabel.local", {
        id: "custom-local-model",
        createdAt: "2024-03-15",
        size: deps.t("models.select.localLlm"),
      }),
    );
    // Prove the locale genuinely changes the badge wording.
    expect(deps.t("models.select.localLlm")).not.toBe(
      depsFor("en").t("models.select.localLlm"),
    );
  });

  it("normalizes millisecond timestamps the same as second timestamps", () => {
    const seconds: ModelForLabel = {
      id: "m",
      created: CREATED_SECONDS,
      pricing: { prompt: "0" } as ModelForLabel["pricing"],
    };
    const millis: ModelForLabel = {
      id: "m",
      created: CREATED_SECONDS * 1000,
      pricing: { prompt: "0" } as ModelForLabel["pricing"],
    };
    const deps = depsFor("en");
    expect(buildModelOptionLabel(seconds, deps)).toBe(
      buildModelOptionLabel(millis, deps),
    );
  });
});

describe("models.select.optionLabel comma contract", () => {
  // `ModelSelect.tsx`'s custom Option renderer does
  // `label.split(",").map((part) => part.trim())` to lay out the id/date/
  // price-or-size chips (see the CONTRACT comment there and in
  // `modelOptionLabel.ts`). That only works if every catalog value below has
  // exactly two literal ASCII commas — a translator swapping them for `、`,
  // or a third language template that drops one, must fail here instead of
  // silently collapsing the option to a single unstyled line in the UI.
  const CONTRACT_KEYS = [
    "models.select.optionLabel.local",
    "models.select.optionLabel.cloud",
  ] as const;

  it.each(CONTRACT_KEYS)("%s has exactly two ASCII commas in every locale", (key) => {
    for (const locale of LOCALE_CODES) {
      const template = CATALOGS[locale][key];
      expect(template, `${locale}/${key} is missing`).toBeDefined();
      const commaCount = (template ?? "").split(",").length - 1;
      expect(commaCount, `${locale}/${key}: "${template}"`).toBe(2);
    }
  });
});
