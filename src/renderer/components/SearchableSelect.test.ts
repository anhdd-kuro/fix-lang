import { describe, expect, it } from "vitest";
import { matchesSearch } from "./SearchableSelect";

const option = (value: string, label = value) => ({ value, label });

describe("matchesSearch", () => {
  it("keeps every option for an empty query", () => {
    expect(matchesSearch(option("openai/gpt-5"), "")).toBe(true);
    expect(matchesSearch(option("openai/gpt-5"), "   ")).toBe(true);
  });

  it("ignores separators and case on both sides", () => {
    expect(matchesSearch(option("openai/gpt-5"), "gpt 5")).toBe(true);
    expect(matchesSearch(option("openai/gpt-5"), "GPT-5")).toBe(true);
    expect(matchesSearch(option("openai/gpt-5"), "openaigpt5")).toBe(true);
  });

  it("matches against the label as well as the value", () => {
    expect(matchesSearch(option("m-1", "Claude Opus 4.5"), "opus45")).toBe(true);
  });

  it("rejects options that do not contain the normalized query", () => {
    expect(matchesSearch(option("openai/gpt-5"), "llama")).toBe(false);
    expect(matchesSearch(option("openai/gpt-5"), "gpt6")).toBe(false);
  });
});
