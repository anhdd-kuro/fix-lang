/**
 * @file enhancePrompt.test.ts
 * @description Pins the Prompt optimization contract that must survive future
 * prompt rewrites.
 *
 * HONEST LIMIT: these checks prove that each required instruction is present
 * in the bundled text, not that an LLM follows it. Prompt quality still needs
 * representative model evaluation.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_OPTIMIZATION_PROMPT } from "~/prompts";

const prompt = DEFAULT_PROMPT_OPTIMIZATION_PROMPT;

const expectExactlyOnce = (marker: string) => {
  expect(prompt.split(marker)).toHaveLength(2);
};

describe("Prompt optimization bundled contract", () => {
  it("is non-empty and trimmed", () => {
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toBe(prompt.trim());
  });

  it("returns one copy-ready prompt without placeholders or hotkey clarification", () => {
    expectExactlyOnce("**No placeholders.**");
    expectExactlyOnce(
      "Do not ask the user a clarifying question in this one-shot optimization flow.",
    );
    expectExactlyOnce("**Output the prompt only.**");
    expect(prompt).toContain(
      "tells the target model to ask for the smallest missing inputs",
    );
  });

  it("preserves supplied prompt, API, model, and tool structure", () => {
    expect(prompt).toContain(
      "prompt roles and structure, API or model settings, tool contracts",
    );
  });

  it("optimizes around outcome, purpose, boundaries, and proof", () => {
    expect(prompt).toContain(
      "Be strict about the destination and important boundaries while leaving room for the target model to choose an efficient route.",
    );
    expect(prompt).toContain(
      "the audience, use, environment, and reason behind important constraints",
    );
    expect(prompt).toContain(
      "the observable evidence that will count as complete",
    );
  });

  it("keeps diagnosis separate from requested implementation", () => {
    expect(prompt).toContain(
      "When a fix is requested, require the narrowest complete fix",
    );
  });

  it("delegates only when the harness and task support it", () => {
    expect(prompt).toContain("If delegation is available and useful");
    expect(prompt).toContain(
      "only when the harness supports it and the task warrants independent review",
    );
  });

  it("uses proportional verification and never requests hidden reasoning", () => {
    expect(prompt).toContain(
      "Do not demand broad or repeated testing when a smaller check proves the changed behavior.",
    );
    expectExactlyOnce("Never request hidden chain-of-thought.");
  });

  it("preserves the draft language unless the user requests another", () => {
    expect(prompt).toContain(
      "Write the optimized prompt in the language of the user's draft unless the user requests another language",
    );
  });

  it("does not restore obsolete prescriptive guidance", () => {
    for (const obsolete of [
      "up to ~30%",
      "single highest-leverage",
      "Positive framing outperforms",
      "as many relevant features",
      "Self-critique your approach periodically",
      "Strip out API-only mechanics",
      "including ones you're uncertain about or consider low-severity",
    ]) {
      expect(prompt).not.toContain(obsolete);
    }
  });
});
