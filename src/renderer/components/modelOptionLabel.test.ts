/**
 * @file modelOptionLabel.test.ts
 * @description Behavioral coverage for the ModelSelect option-label builder,
 * asserted in both EN and JA — the JA template reorders the price/date
 * clauses, so a locale-blind test would miss a regression back to string
 * concatenation.
 */
import { describe, expect, it } from "vitest";
import { createFormatters } from "~/shared/i18n/format";
import { createTranslator } from "~/shared/i18n/translate";
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
    const label = buildModelOptionLabel(model, depsFor("en"));
    expect(label).toBe("custom-local-model, 2024-03-15, Local LLM");
  });

  it("falls back to the localized 'Local LLM' badge when size is unknown (JA)", () => {
    const model: ModelForLabel = {
      id: "custom-local-model",
      created: CREATED_SECONDS,
      local: { path: "/models/custom.gguf" } as ModelForLabel["local"],
    };
    const label = buildModelOptionLabel(model, depsFor("ja"));
    expect(label).toBe("custom-local-model, 2024-03-15, ローカル LLM");
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
