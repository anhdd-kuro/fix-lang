import { describe, expect, it } from "vitest";
import {
  describeKeyFamily,
  findKeyFamilyMismatch,
  KEY_FAMILY_LOG_FIELD,
  type ProviderKeyFamily,
} from "./providerKeyFamilies";

// Shape-only fixtures: prefix + filler, never a real credential.
const OPENROUTER = "sk-or-v1-0123456789abcdef";
const OPENAI_PROJECT = "sk-proj-0123456789abcdef";
const OPENAI_ADMIN = "sk-admin-0123456789abcdef";
const OPENAI_LEGACY = "sk-0123456789abcdef";
const ANTHROPIC = "sk-ant-api03-0123456789abcdef";
const ANTHROPIC_ADMIN = "sk-ant-admin01-0123456789abcdef";

describe("KEY_FAMILY_LOG_FIELD", () => {
  it("keeps the field name existing JSONL logs were written with", () => {
    expect(KEY_FAMILY_LOG_FIELD).toBe("keyShape");
  });
});

describe("describeKeyFamily", () => {
  it("identifies each provider prefix", () => {
    const cases: [string, ProviderKeyFamily][] = [
      [OPENROUTER, "openrouter"],
      [OPENAI_PROJECT, "openai-project"],
      [OPENAI_ADMIN, "openai-admin"],
      [ANTHROPIC, "anthropic"],
      // One family covers both Anthropic kinds: FixLang stores only the request
      // key, and an admin key is just as foreign in every other slot.
      [ANTHROPIC_ADMIN, "anthropic"],
    ];
    for (const [raw, family] of cases) {
      expect(describeKeyFamily(raw)).toBe(family);
    }
  });

  it("reads `sk-or-` as OpenRouter, not as a bare OpenAI `sk-`", () => {
    // Kills: matching "sk-" before "sk-or-", which would call every OpenRouter
    // key an OpenAI key and lock the user out of their own provider.
    expect(describeKeyFamily(OPENROUTER)).toBe("openrouter");
  });

  it("leaves a legacy or unknown format unrecognized", () => {
    for (const raw of [OPENAI_LEGACY, "lm-studio-local", "", "   "]) {
      expect(describeKeyFamily(raw)).toBe("unrecognized");
    }
  });

  it("ignores surrounding whitespace, as the store does before writing", () => {
    expect(describeKeyFamily(`  ${OPENAI_ADMIN}  `)).toBe("openai-admin");
  });
});

describe("findKeyFamilyMismatch", () => {
  it("refuses an OpenAI admin key in OpenRouter's provisioning slot", () => {
    // The reported bug: written successfully, reported as "Key set", then every
    // OpenRouter account read came back 401.
    const mismatch = findKeyFamilyMismatch(
      "openrouter",
      "provisioning",
      OPENAI_ADMIN,
    );
    expect(mismatch).toEqual({
      family: "openai-admin",
      expectedPrefix: "sk-or-v1-",
    });
  });

  it("refuses an OpenRouter key in either OpenAI slot", () => {
    expect(findKeyFamilyMismatch("openai", "api", OPENROUTER)?.family).toBe(
      "openrouter",
    );
    expect(
      findKeyFamilyMismatch("openai", "provisioning", OPENROUTER)?.family,
    ).toBe("openrouter");
  });

  it("refuses the wrong OpenAI slot, not just the wrong provider", () => {
    // An admin key cannot run completions and a project key cannot read
    // /organization/costs, so both fail exactly as silently as a cross-provider
    // paste — same 401, same "Key set" badge.
    expect(
      findKeyFamilyMismatch("openai", "api", OPENAI_ADMIN)?.expectedPrefix,
    ).toBe("sk-proj-");
    expect(
      findKeyFamilyMismatch("openai", "provisioning", OPENAI_PROJECT)
        ?.expectedPrefix,
    ).toBe("sk-admin-");
  });

  it("refuses an Anthropic key in an OpenAI or OpenRouter slot", () => {
    for (const slot of ["api", "provisioning"] as const) {
      expect(findKeyFamilyMismatch("openai", slot, ANTHROPIC)?.family).toBe(
        "anthropic",
      );
      expect(findKeyFamilyMismatch("openrouter", slot, ANTHROPIC)?.family).toBe(
        "anthropic",
      );
    }
  });

  it("refuses another provider's key in Anthropic's slot", () => {
    expect(findKeyFamilyMismatch("anthropic", "api", OPENROUTER)).toEqual({
      family: "openrouter",
      expectedPrefix: "sk-ant-",
    });
    expect(
      findKeyFamilyMismatch("anthropic", "api", OPENAI_PROJECT)?.family,
    ).toBe("openai-project");
    expect(
      findKeyFamilyMismatch("anthropic", "api", OPENAI_ADMIN)?.family,
    ).toBe("openai-admin");
  });

  it("accepts every key in its own slot", () => {
    expect(findKeyFamilyMismatch("openrouter", "api", OPENROUTER)).toBeNull();
    expect(
      findKeyFamilyMismatch("openrouter", "provisioning", OPENROUTER),
    ).toBeNull();
    expect(findKeyFamilyMismatch("openai", "api", OPENAI_PROJECT)).toBeNull();
    expect(
      findKeyFamilyMismatch("openai", "provisioning", OPENAI_ADMIN),
    ).toBeNull();
    expect(findKeyFamilyMismatch("anthropic", "api", ANTHROPIC)).toBeNull();
  });

  it("accepts an unrecognized format anywhere", () => {
    // Deliberate: a legacy `sk-…` OpenAI key and any future format must not be
    // rejected on a guess. Only positively-identified foreign shapes are.
    expect(findKeyFamilyMismatch("openai", "api", OPENAI_LEGACY)).toBeNull();
    expect(
      findKeyFamilyMismatch("openrouter", "provisioning", OPENAI_LEGACY),
    ).toBeNull();
    expect(
      findKeyFamilyMismatch("lmstudio", "api", "anything-goes"),
    ).toBeNull();
  });

  it("accepts anything in LM Studio's optional local key slot", () => {
    expect(findKeyFamilyMismatch("lmstudio", "api", OPENAI_ADMIN)).toBeNull();
  });
});
