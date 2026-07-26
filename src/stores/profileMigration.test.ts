/**
 * @file profileMigration.test.ts
 * @description Pure-function tests for the on-disk profile migration to composite
 * model refs. The store-facing driver is covered by `apiStore.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { migrateProfileForModelRefs } from "~/stores/profileMigration";
import type { CorrectionPreset, SettingsStore } from "~/stores/apiStore";

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

describe("migrateProfileForModelRefs — prefixes bare model ids with the legacy provider", () => {
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

describe("migrateProfileForModelRefs — a profile with no provider key migrates as openrouter", () => {
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

describe("migrateProfileForModelRefs — idempotency", () => {
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
    // A second pass falls back to "openrouter", but the `isModelRef`
    // short-circuit means that fallback never reaches a value.
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

describe("migrateProfileForModelRefs — enabledProviders predicate", () => {
  it("attributes an untagged local Ollama model via isModelForProvider instead of dropping it", () => {
    const raw = buildRawProfile({
      provider: "openrouter",
      settings: buildSettings({
        models: [{ id: "llama3.2:3b", name: "llama", created: 2, local: { path: "/x" } }],
        enabledProviders: [],
      }),
    });

    const migrated = migrateProfileForModelRefs(raw);

    // Kills `model.provider === provider`, which seeds only ["openrouter"] here.
    expect(migrated.settings.enabledProviders).toEqual(["openrouter", "ollama"]);
  });
});

describe("migrateProfileForModelRefs — total over malformed shapes", () => {
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

describe("migrateProfileForModelRefs — second pass stays inert for a fresh (post-migration) profile", () => {
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

    // Kills the non-empty-only heuristic, which recomputes ["openai", "openrouter"]
    // here — enabling a provider this user never connected.
    expect(migrated.settings.enabledProviders).toEqual([]);
  });
});

describe("migrateProfileForModelRefs — fifth model field: settingsTranslate.model", () => {
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
