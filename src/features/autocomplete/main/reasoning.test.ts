/**
 * @file reasoning.test.ts
 * @description Source guard: autocomplete must never inherit a reasoning effort.
 *
 * The distinction is load-bearing and invisible at a glance
 * (`~/features/correction/shared/reasoningEffort`):
 *
 *   - `undefined` / `"provider-default"` → `reasoningForAiSdk` returns
 *     `undefined` → the parameter is OMITTED → the provider keeps its own
 *     default, which on a reasoning-capable model is reasoning ON.
 *   - `"none"` → returned as-is and sent explicitly.
 *
 * So a 24-token continuation issued on every keypause would silently pay for a
 * reasoning pass. A behavioural test alone would not hold the line: someone
 * threading the profile default through later would still satisfy "sends a
 * reasoning value" while reintroducing the bug. Pinning the imports is what
 * makes the mistake impossible to make quietly. Same technique as
 * `profileChange.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const serviceSource = readFileSync(
  join(import.meta.dirname, "service.ts"),
  "utf-8",
);

/**
 * Comments are stripped before matching. `service.ts` documents *why* it avoids
 * these symbols by naming them, so a raw substring search would be satisfied by
 * the very comment that explains the rule — a guard that fires on its own
 * documentation and stays green when the rule is actually broken.
 */
const serviceCode = serviceSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("autocomplete reasoning", () => {
  it.each(["getDefaultReasoningEffort", "resolveReasoningEffort"])(
    "service.ts does not import %s",
    (symbol) => {
      expect(serviceCode).not.toContain(symbol);
    },
  );

  it("service.ts does not import the reasoning module at all", () => {
    expect(serviceCode).not.toContain("reasoningEffort");
  });

  it("sends the literal \"none\"", () => {
    expect(serviceCode).toContain('reasoning: "none"');
  });

  // A profile-wide default reaching this request would be the bug in its most
  // likely disguise.
  it("does not read defaultReasoningEffort", () => {
    expect(serviceCode).not.toContain("defaultReasoningEffort");
  });
});
