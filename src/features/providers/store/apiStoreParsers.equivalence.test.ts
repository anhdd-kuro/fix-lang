/**
 * @file apiStoreParsers.equivalence.test.ts
 * @description Pins the exact outputs of `apiStore`'s stored-data parsers on
 * edge inputs, so swapping their hand-written `typeof` guards for zod schemas
 * is provably behavior-preserving. The snapshot was recorded against the
 * hand-written implementations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What `conf` persists: JSON, plus `undefined` for an absent key. */
type StoredJson =
  | string
  | number
  | boolean
  | null
  | undefined
  | StoredJson[]
  | { [key: string]: StoredJson };

vi.mock("electron-store", () => {
  class MockStore {
    private data: Record<string, StoredJson> = {};
    get(key: string, defaultValue?: StoredJson) {
      return key in this.data ? this.data[key] : defaultValue;
    }
    set(key: string, value: StoredJson) {
      this.data[key] = value;
    }
    delete(key: string) {
      Reflect.deleteProperty(this.data, key);
    }
    store = {};
    onDidChange = vi.fn();
    watch = vi.fn();
  }
  return { default: MockStore };
});
vi.mock("electron", () => ({
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp") },
}));

import {
  apiStore,
  getProfileSetting,
  normalizeCorrectionSettings,
} from "~/features/providers/store/apiStore";
import { DEFAULT_TRANSLATE_PRESET_ID } from "~/prompts";
import type {
  CorrectionPreset,
  CorrectionSettings,
} from "~/features/providers/store/apiStore";

/**
 * Edge inputs reach these parsers from disk with no static type at all; this
 * models that, so a narrowed parameter type cannot hide a runtime case.
 */
const viaBoundary = <Value>(value: Value): never => value as never;

const NO_RESERVED_ACCELERATORS: readonly string[] = [];

/**
 * One line per preset/combo keeps the snapshot reviewable. `keys` pins which
 * keys are present and in what order — JSON drops `undefined` values, so
 * present-but-undefined is visible only there.
 */
const projectPreset = (preset: CorrectionPreset): string =>
  JSON.stringify({
    keys: Object.keys(preset),
    ...preset,
    systemPrompt: `${preset.systemPrompt.slice(0, 24)}… (${preset.systemPrompt.length})`,
  });

const projectSettings = (settings: CorrectionSettings) => ({
  keys: Object.keys(settings),
  selectedPresetId: settings.selectedPresetId,
  presets: settings.presets.map(projectPreset),
  combos: settings.combos?.map((combo) =>
    JSON.stringify({
      keys: Object.keys(combo),
      ...combo,
      steps: combo.steps.map((step) => ({ keys: Object.keys(step), ...step })),
    }),
  ),
});

const normalizeOutcome = (input: unknown) => {
  try {
    return projectSettings(
      normalizeCorrectionSettings(
        viaBoundary(input),
        undefined,
        NO_RESERVED_ACCELERATORS,
      ),
    );
  } catch (cause) {
    return {
      threw: cause instanceof Error ? cause.constructor.name : String(cause),
    };
  }
};

const arrayWithPresets = Object.assign([], {
  presets: [{ id: "from-array", name: "From array" }],
});

const presetEntryCases: [string, unknown][] = [
  ["null entry", null],
  ["number entry", 5],
  ["string entry", "preset"],
  ["array entry", []],
  ["function entry", () => 1],
  ["empty object entry", {}],
  ["boxed string entry", new String("x")],
  [
    "custom with every optional field valid",
    {
      id: " custom-1 ",
      name: " Custom ",
      hotkey: " Control+Shift+9 ",
      systemPrompt: " Be terse. ",
      model: " openai::gpt-4o ",
      isBuiltIn: false,
      reasoning: "high",
      requiresInput: true,
      outputMode: "paste",
      markdownOutput: false,
      extraOptions: { cavemanMode: "ultra" },
    },
  ],
  [
    "custom with every optional field garbage",
    {
      id: "custom-2",
      hotkey: 7,
      isBuiltIn: "yes",
      reasoning: "warp",
      requiresInput: "yes",
      outputMode: "banana",
      markdownOutput: new Boolean(true),
      extraOptions: "ultra",
    },
  ],
  [
    "built-in Ask with stored overrides",
    {
      id: "ask",
      hotkey: "",
      requiresInput: false,
      outputMode: "inherit",
      markdownOutput: "no",
    },
  ],
  [
    "built-in prompt optimization without reasoning",
    { id: "prompt-optimization", name: "PO" },
  ],
];

describe("normalizeCorrectionSettings — stored-shape edge cases", () => {
  it("whole-value shapes", () => {
    expect(
      [
        ["undefined", undefined],
        ["null", null],
        ["0", 0],
        ["empty string", ""],
        ["string", "settings"],
        ["true", true],
        ["function", () => ({ presets: [] })],
        ["boxed string", new String("x")],
        ["empty array", []],
        ["array carrying presets", arrayWithPresets],
        ["empty object", {}],
        ["presets not an array", { presets: "x" }],
        ["empty presets", { presets: [] }],
      ].map(([label, input]) => [label, normalizeOutcome(input)]),
    ).toMatchSnapshot();
  });

  it("legacy (pre-preset) fields", () => {
    expect(
      [
        [
          "all legacy strings",
          {
            userInput: " custom ",
            paraphrasePrompt: " paraphrase ",
            model: " legacy-model ",
          },
        ],
        ["blank legacy strings", { userInput: " ", model: "" }],
        ["non-string legacy model", { model: 5 }],
        ["non-string legacy userInput", { userInput: 5 }],
        ["falsy non-string legacy model", { model: 0 }],
      ].map(([label, input]) => [label, normalizeOutcome(input)]),
    ).toMatchSnapshot();
  });

  it("preset entries", () => {
    expect(
      presetEntryCases.map(([label, entry]) => [
        label,
        normalizeOutcome({ presets: [entry] }),
      ]),
    ).toMatchSnapshot();
  });

  it("preset ids, duplicates and wrong-typed strings", () => {
    expect(
      [
        ["duplicate ids", { presets: [{ id: "x" }, { id: " x " }] }],
        ["numeric id", { presets: [{ id: 5 }] }],
        ["numeric name", { presets: [{ id: "x", name: 5 }] }],
        ["falsy numeric name", { presets: [{ id: "x", name: 0 }] }],
        ["numeric model", { presets: [{ id: "x", model: 5 }] }],
        ["numeric systemPrompt", { presets: [{ id: "x", systemPrompt: 5 }] }],
        [
          "stored translate preset",
          { presets: [{ id: DEFAULT_TRANSLATE_PRESET_ID }] },
        ],
        [
          "stolen default hotkey",
          { presets: [{ id: "mine", hotkey: "Control+Shift+F" }] },
        ],
      ].map(([label, input]) => [label, normalizeOutcome(input)]),
    ).toMatchSnapshot();
  });

  it("selectedPresetId", () => {
    expect(
      [
        ["valid", { presets: [], selectedPresetId: "summarize" }],
        ["unknown id", { presets: [], selectedPresetId: "nope" }],
        ["number", { presets: [], selectedPresetId: 5 }],
        ["boxed", { presets: [], selectedPresetId: new String("summarize") }],
        ["padded", { presets: [], selectedPresetId: " summarize " }],
      ].map(([label, input]) => [label, normalizeOutcome(input)]),
    ).toMatchSnapshot();
  });

  it("combos", () => {
    const step = (
      presetId: string,
      extra: { id?: StoredJson; inlineInput?: StoredJson } = {},
    ) => ({
      presetId,
      ...extra,
    });
    expect(
      [
        ["not an array", { presets: [], combos: "x" }],
        [
          "garbage entries",
          { presets: [], combos: [null, 5, "c", [], () => 1, {}] },
        ],
        [
          "valid combo with optional fields",
          {
            presets: [],
            combos: [
              {
                id: " c1 ",
                name: " Chain ",
                hotkey: " Control+Shift+8 ",
                steps: [
                  step(" correction ", { id: " s1 " }),
                  step("ask", { inlineInput: "  why?  " }),
                ],
                outputMode: "popup",
                markdownOutput: true,
                schemaVersion: 2,
              },
            ],
          },
        ],
        [
          "garbage optional fields",
          {
            presets: [],
            combos: [
              {
                id: "c2",
                name: "C2",
                hotkey: 9,
                steps: [step("correction", { inlineInput: 5, id: 7 })],
                outputMode: "banana",
                markdownOutput: "yes",
                schemaVersion: "2",
              },
            ],
          },
        ],
        [
          "schema versions",
          {
            presets: [],
            combos: [1, 2, 3, 2.0, null].map((schemaVersion, index) => ({
              id: `v${index}`,
              name: `V${index}`,
              steps: [step("correction")],
              schemaVersion,
            })),
          },
        ],
        [
          "colliding step ids",
          {
            presets: [],
            combos: [
              {
                id: "c3",
                name: "C3",
                steps: [
                  step("a", { id: "step-2" }),
                  step("b"),
                  step("c", { id: "step-2" }),
                  step("d", { id: "step-2-2" }),
                ],
              },
            ],
          },
        ],
        [
          "one bad step drops the combo",
          {
            presets: [],
            combos: [
              { id: "c4", name: "C4", steps: [step("a"), null] },
              { id: "c5", name: "C5", steps: [step("a"), { presetId: " " }] },
              { id: "c6", name: "C6", steps: [step("a"), []] },
            ],
          },
        ],
        [
          "invalid combo identity",
          {
            presets: [],
            combos: [
              { id: " ", name: "N", steps: [] },
              { id: "x", name: 5, steps: [] },
              { id: "y", name: "Y", steps: "s" },
              { id: "z", name: "Z", steps: [] },
              { id: "z", name: "Z again", steps: [] },
            ],
          },
        ],
        [
          "array combo carrying fields",
          {
            presets: [],
            combos: [
              Object.assign([], { id: "arr", name: "Arr", steps: [step("a")] }),
            ],
          },
        ],
        [
          "array step carrying presetId",
          {
            presets: [],
            combos: [
              {
                id: "arrstep",
                name: "Arr step",
                steps: [Object.assign([], { presetId: "a" })],
              },
            ],
          },
        ],
      ].map(([label, input]) => [label, normalizeOutcome(input)]),
    ).toMatchSnapshot();
  });
});

describe("getProfileSetting — stored-shape edge cases", () => {
  const seedSettings = (settings: StoredJson): void => {
    apiStore.set("profiles", [
      {
        id: "profile_eq",
        name: "Equivalence",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        settings,
      },
    ]);
    apiStore.set("currentProfileId", "profile_eq");
  };

  beforeEach(() => {
    apiStore.set("profiles", []);
    apiStore.set("currentProfileId", "");
  });

  it("legacy standalone-Translate settings", () => {
    const translatePreset = (settings: CorrectionSettings) =>
      projectPreset(
        settings.presets.find(
          (preset) => preset.id === DEFAULT_TRANSLATE_PRESET_ID,
        ) ?? settings.presets[0],
      );
    const cases: [string, StoredJson][] = [
      ["absent", undefined],
      ["null", null],
      ["string", "fr"],
      ["array", ["fr"]],
      ["empty object", {}],
      [
        "all fields valid",
        { destinationLang: " French ", includeExplanation: true, model: " m " },
      ],
      [
        "all fields wrong type",
        { destinationLang: 5, includeExplanation: "yes", model: 7 },
      ],
      ["explanation only", { includeExplanation: true }],
    ];
    expect(
      cases.map(([label, settingsTranslate]) => {
        seedSettings({
          settingsCorrect: { presets: [{ id: "correction" }] },
          settingsTranslate,
        });
        return [label, translatePreset(getProfileSetting("settingsCorrect"))];
      }),
    ).toMatchSnapshot();
  });

  it("providerEndpoints", () => {
    const cases: [string, StoredJson][] = [
      ["absent", undefined],
      ["null", null],
      ["string", "ollama"],
      ["number", 5],
      ["array", [{ host: "localhost", port: 1 }]],
      ["empty", {}],
      [
        "local endpoints in stored order",
        {
          ollama: { host: " localhost ", port: "11435" },
          lmstudio: { host: "127.0.0.1", port: 1234 },
        },
      ],
      [
        "invalid local endpoints",
        {
          lmstudio: { host: "http://x", port: 1234 },
          ollama: { host: "localhost", port: 0 },
        },
      ],
      [
        "bedrock shapes",
        {
          bedrock: " US-West-2 ",
        },
      ],
      ["bedrock object", { bedrock: { host: "eu-central-1", port: 0 } }],
      ["bedrock invalid host", { bedrock: { host: "bad" } }],
      ["bedrock non-string host", { bedrock: { host: 5 } }],
      ["bedrock array", { bedrock: ["us-east-1"] }],
      ["bedrock null", { bedrock: null }],
      [
        "cloud providers and unknown keys are dropped",
        {
          openai: { host: "localhost", port: 1 },
          constructor: { host: "localhost", port: 1 },
          bogus: { host: "localhost", port: 1 },
        },
      ],
    ];
    expect(
      cases.map(([label, providerEndpoints]) => {
        seedSettings({ providerEndpoints });
        const endpoints = getProfileSetting("providerEndpoints");
        return [label, { keys: Object.keys(endpoints), endpoints }];
      }),
    ).toMatchSnapshot();
  });

  it("bedrock entry carrying a host field on an array", () => {
    seedSettings({});
    const settings = getProfileSetting("settingsCorrect");
    expect(settings.presets.length).toBeGreaterThan(0);
    // Arrays with named fields cannot round-trip through JSON, so this case is
    // driven straight through the setting reader's normalizer instead.
    apiStore.set("profiles", [
      {
        id: "profile_eq",
        name: "Equivalence",
        createdAt: "2000-01-01T00:00:00.000Z",
        updatedAt: "2000-01-01T00:00:00.000Z",
        settings: viaBoundary({
          providerEndpoints: {
            bedrock: Object.assign([], { host: "us-west-2" }),
            ollama: Object.assign([], { host: "localhost", port: 1 }),
          },
        }),
      },
    ]);
    expect(getProfileSetting("providerEndpoints")).toMatchSnapshot();
  });
});
