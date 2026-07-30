import { describe, expect, it } from "vitest";
import { FEATURE_IDS, isPromptGenEnabled, parseFeatureFlags } from "./features";

describe("parseFeatureFlags", () => {
  it("defaults every feature to false", () => {
    const flags = parseFeatureFlags({});
    for (const id of FEATURE_IDS) {
      expect(flags[id]).toBe(false);
    }
    expect(parseFeatureFlags({ argv: [], env: {} })).toEqual({
      promptGen: false,
    });
  });

  it("ignores unrelated argv entries", () => {
    const flags = parseFeatureFlags({
      argv: ["node", "electron-vite", "build", "--outDir", "out"],
    });
    expect(flags.promptGen).toBe(false);
  });

  it("enables promptGen on --promptgen", () => {
    expect(parseFeatureFlags({ argv: ["--promptgen"] }).promptGen).toBe(true);
  });

  it("enables promptGen on --promptgen=true and other truthy values", () => {
    for (const token of [
      "--promptgen=true",
      "--promptgen=1",
      "--promptgen=yes",
      "--promptgen=on",
      "--PromptGen=TRUE",
    ]) {
      expect(parseFeatureFlags({ argv: [token] }).promptGen).toBe(true);
    }
  });

  it("disables promptGen on --promptgen=false and other falsy values", () => {
    for (const token of [
      "--promptgen=false",
      "--promptgen=0",
      "--promptgen=no",
      "--promptgen=off",
    ]) {
      expect(
        parseFeatureFlags({
          argv: [token],
          env: { FIXLANG_FEATURES: "promptgen" },
        }).promptGen,
      ).toBe(false);
    }
  });

  it("disables promptGen on --no-promptgen", () => {
    expect(
      parseFeatureFlags({
        argv: ["--no-promptgen"],
        env: { FIXLANG_FEATURES: "promptgen" },
      }).promptGen,
    ).toBe(false);
  });

  it("enables promptGen from FIXLANG_FEATURES=promptgen", () => {
    expect(
      parseFeatureFlags({ env: { FIXLANG_FEATURES: "promptgen" } }).promptGen,
    ).toBe(true);
  });

  it("accepts comma and whitespace separated env lists", () => {
    for (const value of [
      "promptgen",
      " promptgen ",
      "promptgen,",
      "someOther, promptgen",
      "someOther promptgen",
      "PROMPTGEN",
    ]) {
      expect(
        parseFeatureFlags({ env: { FIXLANG_FEATURES: value } }).promptGen,
      ).toBe(true);
    }
  });

  it("enables everything on FIXLANG_FEATURES=all", () => {
    const flags = parseFeatureFlags({ env: { FIXLANG_FEATURES: "all" } });
    for (const id of FEATURE_IDS) {
      expect(flags[id]).toBe(true);
    }
  });

  it("lets explicit CLI tags win over env", () => {
    expect(
      parseFeatureFlags({
        argv: ["--no-promptgen"],
        env: { FIXLANG_FEATURES: "all" },
      }).promptGen,
    ).toBe(false);

    expect(
      parseFeatureFlags({
        argv: ["--promptgen"],
        env: { FIXLANG_FEATURES: "" },
      }).promptGen,
    ).toBe(true);
  });

  it("ignores unknown tags instead of throwing", () => {
    expect(() =>
      parseFeatureFlags({
        argv: ["--nope", "--no-nope", "--nope=true", "-promptgen"],
        env: { FIXLANG_FEATURES: "nope, mystery-feature" },
      }),
    ).not.toThrow();

    expect(
      parseFeatureFlags({
        argv: ["--nope", "--promptgen=maybe", "-promptgen"],
        env: { FIXLANG_FEATURES: "nope, mystery-feature" },
      }).promptGen,
    ).toBe(false);
  });
});

describe("isPromptGenEnabled", () => {
  it("is false when the build-time define is absent (vitest)", () => {
    expect(isPromptGenEnabled()).toBe(false);
  });
});
