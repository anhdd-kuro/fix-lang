/**
 * @file profileMigration.edgeInputs.test.ts
 * @description Pins `migrateProfileForModelRefs` on junk and historical edge
 * inputs — the migration must stay total over whatever is on disk, degrade
 * rather than throw, and keep the stored key order it writes back.
 */
import { describe, expect, it } from "vitest";
import { migrateProfileForModelRefs } from "~/features/profiles/store/profileMigration";

const EMPTY_MIGRATED_SETTINGS = {
  selectedModel: "",
  settingsCorrect: { presets: [] },
  settingsPromptGen: { model: "" },
  settingsSummarize: { model: "" },
  enabledProviders: [],
};

describe("migrateProfileForModelRefs — non-record input degrades to an empty profile", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["NaN", Number.NaN],
    ["a string", "profile"],
    ["an array", [{ provider: "openai" }]],
    ["a function", Object.assign(() => 1, { provider: "openai" })],
  ])("%s → only the migrated settings skeleton", (_label, input) => {
    expect(migrateProfileForModelRefs(input)).toEqual({
      settings: EMPTY_MIGRATED_SETTINGS,
    });
  });

  it("a Date reads as an empty record (no own enumerable keys)", () => {
    expect(migrateProfileForModelRefs(new Date(0))).toEqual({
      settings: EMPTY_MIGRATED_SETTINGS,
    });
  });

  it("a non-record settings value reads as empty, but the legacy provider still seeds enabledProviders", () => {
    expect(
      migrateProfileForModelRefs({ provider: "openai", settings: [1] }),
    ).toEqual({
      settings: { ...EMPTY_MIGRATED_SETTINGS, enabledProviders: ["openai"] },
    });
  });

  it("a non-string or unknown provider is dropped and treated as openrouter only when something needs migrating", () => {
    expect(migrateProfileForModelRefs({ provider: 5, settings: {} })).toEqual({
      settings: EMPTY_MIGRATED_SETTINGS,
    });
    expect(
      migrateProfileForModelRefs({
        provider: "bogus",
        settings: { selectedModel: "m" },
      }),
    ).toEqual({
      settings: {
        ...EMPTY_MIGRATED_SETTINGS,
        selectedModel: "openrouter::m",
        enabledProviders: ["openrouter"],
      },
    });
  });
});

describe("migrateProfileForModelRefs — junk inside arrays and model fields", () => {
  it("keeps only record presets (skipping null, primitives, arrays and holes) and blanks a non-string model", () => {
    const presets = [
      null,
      "x",
      3,
      [1],
      { model: "gpt" },
      { model: 5 },
      { id: "a" },
    ];
    // Growing `length` leaves index 7 a hole, never assigned.
    presets.length = 8;
    const migrated = migrateProfileForModelRefs({
      provider: "openai",
      settings: { settingsCorrect: { presets } },
    });
    expect(migrated.settings.settingsCorrect).toEqual({
      presets: [
        { model: "openai::gpt" },
        { model: "" },
        { id: "a", model: "" },
      ],
    });
  });

  it("a non-string selectedModel (number, NaN) migrates to the empty string", () => {
    for (const selectedModel of [42, Number.NaN, null, { id: "m" }]) {
      expect(
        migrateProfileForModelRefs({ settings: { selectedModel } }).settings
          .selectedModel,
      ).toBe("");
    }
  });

  it("sanitizes a non-empty stored enabledProviders without recomputing it", () => {
    expect(
      migrateProfileForModelRefs({
        provider: "openai",
        settings: { enabledProviders: ["openai", "bogus", 7, "anthropic"] },
      }).settings.enabledProviders,
    ).toEqual(["openai", "anthropic"]);
  });

  it("a non-array enabledProviders on an already-migrated profile becomes []", () => {
    expect(
      migrateProfileForModelRefs({ settings: { enabledProviders: "openai" } })
        .settings.enabledProviders,
    ).toEqual([]);
  });

  it("derives enabledProviders from record models only, ignoring junk entries", () => {
    const models = [
      null,
      "m",
      { provider: "anthropic" },
      { local: {} },
      { provider: "bogus" },
      {},
      [1],
    ];
    const migrated = migrateProfileForModelRefs({
      provider: "openai",
      settings: { enabledProviders: [], models },
    });
    expect(migrated.settings.enabledProviders).toEqual([
      "openai",
      "openrouter",
      "anthropic",
      "ollama",
    ]);
    expect(migrated.settings.models).toEqual(models);
  });
});

describe("migrateProfileForModelRefs — legacy settingsCorrect / settingsTranslate shapes", () => {
  it("a junk settingsCorrect (string, array) becomes { presets: [] }", () => {
    for (const settingsCorrect of ["junk", [1, 2]]) {
      expect(
        migrateProfileForModelRefs({ settings: { settingsCorrect } }).settings
          .settingsCorrect,
      ).toEqual({ presets: [] });
    }
  });

  it("a flat string settingsCorrect.model is prefixed; a non-string one is kept as stored", () => {
    expect(
      migrateProfileForModelRefs({
        provider: "anthropic",
        settings: { settingsCorrect: { model: "c", presets: "x" } },
      }).settings.settingsCorrect,
    ).toEqual({ model: "anthropic::c", presets: [] });
    expect(
      migrateProfileForModelRefs({
        settings: { settingsCorrect: { model: 3 } },
      }).settings.settingsCorrect,
    ).toEqual({ model: 3, presets: [] });
  });

  it.each([
    ["null", null, {}],
    ["undefined", undefined, {}],
    ["a non-string model", { model: 5, x: 1 }, { model: 5, x: 1 }],
    ["a bare model", { model: "m", x: 1 }, { model: "openrouter::m", x: 1 }],
  ])(
    "a present settingsTranslate key holding %s migrates to the expected record",
    (_label, settingsTranslate, expected) => {
      const migrated = migrateProfileForModelRefs({
        settings: { settingsTranslate },
      });
      expect(migrated.settings).toHaveProperty("settingsTranslate", expected);
    },
  );
});

describe("migrateProfileForModelRefs — stored key order is preserved", () => {
  it("keeps profile and settings keys in their stored order, appends the migrated ones, and keeps undefined-valued keys", () => {
    const migrated = migrateProfileForModelRefs({
      zeta: 1,
      provider: "openai",
      settings: { zeta: 1, selectedModel: "m", alpha: 2, foo: undefined },
      alpha: 2,
    });
    expect(Object.keys(migrated)).toEqual(["zeta", "settings", "alpha"]);
    expect(Object.keys(migrated.settings)).toEqual([
      "zeta",
      "selectedModel",
      "alpha",
      "foo",
      "settingsCorrect",
      "settingsPromptGen",
      "settingsSummarize",
      "enabledProviders",
    ]);
    expect(migrated.settings.selectedModel).toBe("openai::m");
  });
});
