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
