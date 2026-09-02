import { describe, expect, it } from "vitest";
import {
  describeKeyShape,
  findKeyShapeMismatch,
  type ProviderKeyShape,
} from "./providerKeyShapes";

// Shape-only fixtures: prefix + filler, never a real credential.
const OPENROUTER = "sk-or-v1-0123456789abcdef";
const OPENAI_PROJECT = "sk-proj-0123456789abcdef";
const OPENAI_ADMIN = "sk-admin-0123456789abcdef";
const OPENAI_LEGACY = "sk-0123456789abcdef";
const ANTHROPIC = "sk-ant-api03-0123456789abcdef";
const ANTHROPIC_ADMIN = "sk-ant-admin01-0123456789abcdef";

describe("describeKeyShape", () => {
  it("identifies each provider prefix", () => {
    const cases: [string, ProviderKeyShape][] = [
      [OPENROUTER, "openrouter"],
      [OPENAI_PROJECT, "openai-project"],
      [OPENAI_ADMIN, "openai-admin"],
      [ANTHROPIC, "anthropic"],
      // One shape covers both Anthropic kinds: FixLang stores only the request
      // key, and an admin key is just as foreign in every other slot.
      [ANTHROPIC_ADMIN, "anthropic"],
    ];
    for (const [raw, shape] of cases) {
      expect(describeKeyShape(raw)).toBe(shape);
    }
  });

  it("reads `sk-or-` as OpenRouter, not as a bare OpenAI `sk-`", () => {
    // Kills: matching "sk-" before "sk-or-", which would call every OpenRouter
    // key an OpenAI key and lock the user out of their own provider.
    expect(describeKeyShape(OPENROUTER)).toBe("openrouter");
  });

  it("leaves a legacy or unknown format unrecognized", () => {
    for (const raw of [OPENAI_LEGACY, "lm-studio-local", "", "   "]) {
      expect(describeKeyShape(raw)).toBe("unrecognized");
    }
  });

  it("ignores surrounding whitespace, as the store does before writing", () => {
    expect(describeKeyShape(`  ${OPENAI_ADMIN}  `)).toBe("openai-admin");
  });
});

describe("findKeyShapeMismatch", () => {
  it("refuses an OpenAI admin key in OpenRouter's provisioning slot", () => {
    // The reported bug: written successfully, reported as "Key set", then every
    // OpenRouter account read came back 401.
    const mismatch = findKeyShapeMismatch("openrouter", "provisioning", OPENAI_ADMIN);
    expect(mismatch).toEqual({ shape: "openai-admin", expectedPrefix: "sk-or-v1-" });
  });

  it("refuses an OpenRouter key in either OpenAI slot", () => {
    expect(findKeyShapeMismatch("openai", "api", OPENROUTER)?.shape).toBe("openrouter");
    expect(findKeyShapeMismatch("openai", "provisioning", OPENROUTER)?.shape).toBe(
      "openrouter",
    );
  });

  it("refuses the wrong OpenAI slot, not just the wrong provider", () => {
    // An admin key cannot run completions and a project key cannot read
    // /organization/costs, so both fail exactly as silently as a cross-provider
    // paste — same 401, same "Key set" badge.
    expect(findKeyShapeMismatch("openai", "api", OPENAI_ADMIN)?.expectedPrefix).toBe(
      "sk-proj-",
    );
    expect(
      findKeyShapeMismatch("openai", "provisioning", OPENAI_PROJECT)?.expectedPrefix,
    ).toBe("sk-admin-");
  });

  it("refuses an Anthropic key in an OpenAI or OpenRouter slot", () => {
    for (const slot of ["api", "provisioning"] as const) {
      expect(findKeyShapeMismatch("openai", slot, ANTHROPIC)?.shape).toBe("anthropic");
      expect(findKeyShapeMismatch("openrouter", slot, ANTHROPIC)?.shape).toBe("anthropic");
    }
  });

  it("refuses another provider's key in Anthropic's slot", () => {
    expect(findKeyShapeMismatch("anthropic", "api", OPENROUTER)).toEqual({
      shape: "openrouter",
      expectedPrefix: "sk-ant-",
    });
    expect(findKeyShapeMismatch("anthropic", "api", OPENAI_PROJECT)?.shape).toBe(
      "openai-project",
    );
    expect(findKeyShapeMismatch("anthropic", "api", OPENAI_ADMIN)?.shape).toBe(
      "openai-admin",
    );
  });

  it("accepts every key in its own slot", () => {
    expect(findKeyShapeMismatch("openrouter", "api", OPENROUTER)).toBeNull();
    expect(findKeyShapeMismatch("openrouter", "provisioning", OPENROUTER)).toBeNull();
    expect(findKeyShapeMismatch("openai", "api", OPENAI_PROJECT)).toBeNull();
    expect(findKeyShapeMismatch("openai", "provisioning", OPENAI_ADMIN)).toBeNull();
    expect(findKeyShapeMismatch("anthropic", "api", ANTHROPIC)).toBeNull();
  });

  it("accepts an unrecognized format anywhere", () => {
    // Deliberate: a legacy `sk-…` OpenAI key and any future format must not be
    // rejected on a guess. Only positively-identified foreign shapes are.
    expect(findKeyShapeMismatch("openai", "api", OPENAI_LEGACY)).toBeNull();
    expect(findKeyShapeMismatch("openrouter", "provisioning", OPENAI_LEGACY)).toBeNull();
    expect(findKeyShapeMismatch("lmstudio", "api", "anything-goes")).toBeNull();
  });

  it("accepts anything in LM Studio's optional local key slot", () => {
    expect(findKeyShapeMismatch("lmstudio", "api", OPENAI_ADMIN)).toBeNull();
  });
});
