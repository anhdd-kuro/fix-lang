/**
 * @file profileMigration.test.ts
 * @description Pure-function tests for the one-shot on-disk profile
 * migration to composite model refs (`<providerId>::<rawModelId>`). No
 * electron-store mock needed here — `migrateProfileForModelRefs` is a pure
 * function that never touches the store; the store-facing driver that calls
 * it lives in `apiStore.ts` and is covered by `apiStore.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { migrateProfileForModelRefs } from "~/stores/profileMigration";
import type { CorrectionPreset, SettingsStore } from "~/stores/apiStore";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const buildPreset = (overrides: Partial<CorrectionPreset> = {}): CorrectionPreset => ({
  id: "correction",
  name: "Correction",
  hotkey: "Control+Shift+F",
  systemPrompt: "Fix grammar.",
  model: "",
  isBuiltIn: true,
  ...overrides,
});

const buildSettings = (overrides: Partial<SettingsStore> = {}): SettingsStore =>
  ({
    apiKey: "",
    models: [],
    selectedModel: "",
    enabledProviders: [],
    customSystemPrompt: "",
    customUserPrompt: "",
    tone: "",
    settingsCorrect: {
      presets: [buildPreset()],
      selectedPresetId: "correction",
    },
    settingsSummarize: {
      minLength: 0,
      maxLength: 0,
      model: "",
      targetLanguage: "en",
    },
    settingsPromptGen: {
      minLength: 50,
      maxLength: 150,
      batchCount: 5,
      nsfw: true,
      context: "",
      autoCopy: false,
      model: "",
    },
    ...overrides,
  }) as SettingsStore;

/** Builds a raw, on-disk-shaped profile — `unknown` in, like the real driver reads. */
const buildRawProfile = (overrides: Record<string, unknown> = {}): unknown => ({
  id: "profile_1",
  name: "Test Profile",
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
  provider: "openai",
  settings: buildSettings(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// D14 — the canonical migration example from the card
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — D14", () => {
  it("prefixes selectedModel and non-empty preset models, leaves an empty preset model untouched, drops provider, and sets enabledProviders", () => {
    const raw = buildRawProfile({
      provider: "openai",
      settings: buildSettings({
        selectedModel: "gpt-4o",
        settingsCorrect: {
          selectedPresetId: "correction",
          presets: [
            buildPreset({ id: "correction", model: "gpt-4o-mini" }),
            buildPreset({ id: "summarize", model: "" }),
          ],
        },
      }),
    });

    const migrated = migrateProfileForModelRefs(raw);

    expect(migrated.settings.selectedModel).toBe("openai::gpt-4o");
    expect(migrated.settings.settingsCorrect.presets[0].model).toBe("openai::gpt-4o-mini");
    expect(migrated.settings.settingsCorrect.presets[1].model).toBe("");
    expect(migrated).not.toHaveProperty("provider");
    expect(migrated.settings.enabledProviders).toEqual(["openai"]);
  });

  it("prefixes settingsPromptGen.model and settingsSummarize.model the same way", () => {
    const raw = buildRawProfile({
      provider: "openai",
      settings: buildSettings({
        settingsPromptGen: {
          minLength: 50,
          maxLength: 150,
          batchCount: 5,
          nsfw: true,
          context: "",
          autoCopy: false,
          model: "gpt-4o",
        },
        settingsSummarize: {
          minLength: 0,
          maxLength: 0,
          model: "gpt-4o-mini",
          targetLanguage: "en",
        },
      }),
    });

    const migrated = migrateProfileForModelRefs(raw);

    expect(migrated.settings.settingsPromptGen.model).toBe("openai::gpt-4o");
    expect(migrated.settings.settingsSummarize.model).toBe("openai::gpt-4o-mini");
  });
});

// ---------------------------------------------------------------------------
// D16 — no provider key at all
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — D16", () => {
  it("migrates a profile with no provider key as openrouter (the historical default)", () => {
    const raw = buildRawProfile({
      settings: buildSettings({ selectedModel: "some-model" }),
    });
    delete (raw as Record<string, unknown>).provider;

    const migrated = migrateProfileForModelRefs(raw);

    expect(migrated.settings.selectedModel).toBe("openrouter::some-model");
    expect(migrated.settings.enabledProviders).toEqual(["openrouter"]);
  });
});

// ---------------------------------------------------------------------------
// D15a — idempotent on repeated direct application
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — D15a idempotency", () => {
  it("running the migration twice on the same profile is a fixed point", () => {
    const raw = buildRawProfile({
      provider: "openai",
      settings: buildSettings({
        selectedModel: "gpt-4o",
        settingsCorrect: {
          selectedPresetId: "correction",
          presets: [buildPreset({ model: "gpt-4o-mini" })],
        },
      }),
    });

    const once = migrateProfileForModelRefs(raw);
    const twice = migrateProfileForModelRefs(once);

    expect(twice).toEqual(once);
  });

  it("is still a fixed point when the legacy default provider (openrouter) differs from the profile's real original provider", () => {
    // Once migrated, `provider` is gone, so a second pass falls back to the
    // "openrouter" default when computing `legacy` — but every ref is already
    // prefixed, so the `isModelRef` short-circuit means that fallback is
    // never actually applied to a value.
    const raw = buildRawProfile({
      provider: "ollama",
      settings: buildSettings({ selectedModel: "local-model" }),
    });

    const once = migrateProfileForModelRefs(raw);
    const twice = migrateProfileForModelRefs(once);

    expect(once.settings.selectedModel).toBe("ollama::local-model");
    expect(twice.settings.selectedModel).toBe("ollama::local-model");
    expect(twice.settings.enabledProviders).toEqual(once.settings.enabledProviders);
    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — immutability", () => {
  it("does not mutate its argument", () => {
    const raw = buildRawProfile({
      settings: buildSettings({ selectedModel: "gpt-4o" }),
    });
    const clone = JSON.parse(JSON.stringify(raw));

    migrateProfileForModelRefs(raw);

    expect(raw).toEqual(clone);
  });
});

// ---------------------------------------------------------------------------
// Already-migrated refs are left alone regardless of the recorded legacy provider
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — isModelRef short-circuit", () => {
  it("leaves an already-prefixed ref untouched even when it names a different provider than profile.provider", () => {
    const raw = buildRawProfile({
      provider: "ollama",
      settings: buildSettings({ selectedModel: "openai::gpt-4o" }),
    });

    const migrated = migrateProfileForModelRefs(raw);

    expect(migrated.settings.selectedModel).toBe("openai::gpt-4o");
  });
});

// ---------------------------------------------------------------------------
// F3(a) — enabledProviders must attribute via isModelForProvider, not the raw
// `model.provider` field, or an untagged local Ollama model never enables
// "ollama" (discover.ts builds exactly this untagged shape).
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — F3(a) enabledProviders predicate", () => {
  it("attributes an untagged local Ollama model via isModelForProvider instead of dropping it", () => {
    const raw = buildRawProfile({
      provider: "openrouter",
      settings: buildSettings({
        models: [{ id: "llama3.2:3b", name: "llama", created: 2, local: { path: "/x" } }],
        enabledProviders: [],
      }),
    });

    const migrated = migrateProfileForModelRefs(raw);

    // Wrong predicate would seed only ["openrouter"] (raw.provider is
    // undefined on the model), dropping the cached local model out of every
    // future provider-gated picker.
    expect(migrated.settings.enabledProviders).toEqual(["openrouter", "ollama"]);
  });
});

// ---------------------------------------------------------------------------
// F5 — the migration must be total over malformed on-disk shapes, not throw.
// Severity is minor (schema defaults + clearInvalidConfig mean this is a
// contract defect, not a live data-loss path) but the function should not
// crash `initializeDefaultProfile` at startup if it ever does see one.
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — F5 total over malformed shapes", () => {
  it("does not throw on null", () => {
    expect(() => migrateProfileForModelRefs(null)).not.toThrow();
  });

  it("does not throw on undefined", () => {
    expect(() => migrateProfileForModelRefs(undefined)).not.toThrow();
  });

  it("does not throw when settings is missing", () => {
    const raw = { id: "p", name: "n", createdAt: "c", updatedAt: "c", provider: "openai" };
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
  });

  it("does not throw when settingsCorrect is missing", () => {
    const raw = buildRawProfile({
      settings: { ...buildSettings(), settingsCorrect: undefined },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
  });

  it("does not throw when presets is a non-array, and normalizes it to []", () => {
    const raw = buildRawProfile({
      settings: {
        ...buildSettings(),
        settingsCorrect: { presets: "nope", selectedPresetId: "" },
      },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
    const migrated = migrateProfileForModelRefs(raw);
    expect(migrated.settings.settingsCorrect.presets).toEqual([]);
  });

  it("does not throw when a preset entry is null", () => {
    const raw = buildRawProfile({
      settings: {
        ...buildSettings(),
        settingsCorrect: { presets: [null], selectedPresetId: "" },
      },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
  });

  it("does not throw when models is a non-array", () => {
    const raw = buildRawProfile({
      settings: { ...buildSettings(), models: "nope" },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
  });

  it("does not throw when a models entry is null", () => {
    const raw = buildRawProfile({
      settings: { ...buildSettings(), models: [null] },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
  });

  it("does not throw when selectedModel is a number, and treats it as the empty/inherit sentinel", () => {
    const raw = buildRawProfile({
      settings: { ...buildSettings(), selectedModel: 5 },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
    const migrated = migrateProfileForModelRefs(raw);
    expect(migrated.settings.selectedModel).toBe("");
  });

  it("does not throw when settingsPromptGen is missing", () => {
    const raw = buildRawProfile({
      settings: { ...buildSettings(), settingsPromptGen: undefined },
    });
    expect(() => migrateProfileForModelRefs(raw)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F6 — the "non-empty enabledProviders means already migrated" heuristic must
// not invent providers for a profile that was never actually a legacy shape:
// `createProfile()` has no `provider` key and an empty `enabledProviders` by
// design, and that emptiness means "nothing connected yet", not "unmigrated".
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — F6 second pass stays inert for a fresh (post-migration) profile", () => {
  it("does not invent enabledProviders from the model cache when there is no legacy provider field and nothing left to prefix", () => {
    const raw = buildRawProfile({
      settings: buildSettings({
        models: [{ id: "gpt-4o", name: "gpt-4o", created: 1, provider: "openai" }],
        enabledProviders: [],
        selectedModel: "",
      }),
    });
    delete (raw as Record<string, unknown>).provider;

    const migrated = migrateProfileForModelRefs(raw);

    // The old heuristic recomputes ["openai", "openrouter"] here (legacy
    // fallback "openrouter" plus the cached model's provider) — enabling a
    // provider this profile's user never connected.
    expect(migrated.settings.enabledProviders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F12 — the migration must also prefix `settings.settingsTranslate.model`,
// the retired standalone-Translate field. It is no longer on the typed
// `SettingsStore` shape but still lives in raw on-disk JSON for upgrading
// users, and `normalizeCorrectionSettings` reads it back as a bare id at
// read time via `extractLegacyTranslateSettings`.
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — F12 fifth model field: settingsTranslate.model", () => {
  it("prefixes settingsTranslate.model", () => {
    const raw = buildRawProfile({
      provider: "openrouter",
      settings: { ...buildSettings(), settingsTranslate: { model: "anthropic/claude-3" } },
    });

    const migrated = migrateProfileForModelRefs(raw);

    expect(
      (migrated.settings as unknown as { settingsTranslate: { model: string } }).settingsTranslate
        .model,
    ).toBe("openrouter::anthropic/claude-3");
  });

  it("leaves other settingsTranslate fields untouched", () => {
    const raw = buildRawProfile({
      provider: "openrouter",
      settings: {
        ...buildSettings(),
        settingsTranslate: { model: "anthropic/claude-3", destinationLang: "ja" },
      },
    });

    const migrated = migrateProfileForModelRefs(raw);

    expect(
      (migrated.settings as unknown as { settingsTranslate: { destinationLang: string } })
        .settingsTranslate.destinationLang,
    ).toBe("ja");
  });

  it("does not add a settingsTranslate field when the raw profile never had one", () => {
    const raw = buildRawProfile({ provider: "openai" });

    const migrated = migrateProfileForModelRefs(raw);

    expect(migrated.settings).not.toHaveProperty("settingsTranslate");
  });
});

// ---------------------------------------------------------------------------
// F12 follow-up — grepping the settings shape (per the finding's own
// instruction) turns up a sixth model-bearing field the card and the review
// both missed: `settingsCorrect.model` on the retired flat, pre-presets
// correction shape (`LegacyCorrectionSettings`). `normalizeCorrectionSettings`
// reads it the same way it reads `settingsTranslate.model` — as a bare id,
// straight off the raw `settingsCorrect` object, whenever `presets` isn't yet
// an array.
// ---------------------------------------------------------------------------

describe("migrateProfileForModelRefs — sixth model field found via grep: settingsCorrect.model (flat legacy shape)", () => {
  it("prefixes settingsCorrect.model when presets is not an array (pre-presets legacy shape)", () => {
    const raw = buildRawProfile({
      provider: "openai",
      settings: {
        ...buildSettings(),
        settingsCorrect: { model: "gpt-4-legacy", userInput: "Fix this" },
      },
    });

    const migrated = migrateProfileForModelRefs(raw);

    expect(
      (migrated.settings.settingsCorrect as unknown as { model: string }).model,
    ).toBe("openai::gpt-4-legacy");
  });
});
