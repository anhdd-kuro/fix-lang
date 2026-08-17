import { readFile } from "node:fs/promises";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAVEMAN_MODE_OPTION_KEY } from "~/features/correction/shared/presetOptions";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  DEFAULT_ASK_PRESET_ID,
  DEFAULT_CAVEMAN_FULL_DIRECTIVE,
  DEFAULT_CAVEMAN_PRESET_ID,
  DEFAULT_CAVEMAN_ULTRA_DIRECTIVE,
  DEFAULT_CORRECTION_PRESET_ID,
} from "~/prompts/correction";
import { SettingCorrection } from "./SettingCorrection";
import { I18nProvider } from "../i18n/I18nProvider";

const tEn = createTranslator("en");

describe("SettingCorrection primary actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  it("uses the shared primary button for adding and saving presets", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              id: DEFAULT_CORRECTION_PRESET_ID,
              name: "Correction",
              hotkey: "Control+Shift+F",
              systemPrompt: "Fix the text.",
              model: "",
              isBuiltIn: true,
            },
          ],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        getKeyBindings: vi.fn().mockResolvedValue({}),
        onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
        fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        getProviderStates: vi.fn().mockResolvedValue([]),
        getSelectedModel: vi.fn().mockResolvedValue(""),
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
      },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCorrection)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const buttons = [...container.querySelectorAll("button")];
    const add = buttons.find(
      (button) => button.textContent === tEn("settings.correction.addPreset"),
    );
    const save = buttons.find(
      (button) => button.textContent === tEn("settings.correction.savePresets"),
    );

    for (const button of [add, save]) {
      expect(button?.className).toContain("text-primary-foreground");
      expect(button?.className).toContain(
        "[&:where(:enabled:hover)]:bg-primary-hover",
      );
      expect(button?.className).toContain(
        "[&:where(:enabled:active)]:bg-primary-active",
      );
      expect(button?.className).toContain("focus-visible:ring-ring");
    }
    expect(add?.type).toBe("button");
    expect(save?.type).toBe("submit");
  });

  it("keeps selected and destructive preset controls on their shared variants", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              id: DEFAULT_CORRECTION_PRESET_ID,
              name: "Correction",
              hotkey: "Control+Shift+F",
              systemPrompt: "Fix the text.",
              model: "",
              isBuiltIn: true,
            },
          ],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        getKeyBindings: vi.fn().mockResolvedValue({}),
        onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
        fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        getProviderStates: vi.fn().mockResolvedValue([]),
        getSelectedModel: vi.fn().mockResolvedValue(""),
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
      },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCorrection)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const selected = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Correction"),
    );
    const reset = [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent === tEn("settings.correction.resetBuiltIn"),
    );

    expect(selected?.type).toBe("button");
    expect(selected?.className).toContain("text-primary-foreground");
    expect(selected?.className).toContain(
      "[&:where(:enabled:hover)]:bg-primary-hover",
    );
    expect(selected?.querySelector(".text-foreground")).toBeNull();
    expect(selected?.querySelector(".text-muted-foreground")).toBeNull();
    expect(reset?.disabled).toBe(false);
    expect(reset?.className).toContain("bg-destructive");
    expect(reset?.className).toContain("text-destructive-foreground");
    expect(reset?.classList.contains("text-card-foreground")).toBe(false);
    expect(reset?.className).toContain(
      "[&:where(:enabled:hover)]:bg-destructive-hover",
    );
    expect(reset?.className).toContain(
      "[&:where(:enabled:active)]:bg-destructive-active",
    );
    expect(reset?.className).not.toMatch(
      /(?:^|\s)(?:enabled:)?(?:hover|active):bg-/,
    );

    const deleteButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === tEn("common.delete"),
    );
    expect(deleteButton?.className).toContain("text-destructive-foreground");
    expect(deleteButton?.classList.contains("text-destructive")).toBe(false);
    expect(deleteButton?.className).toContain(
      "[&:where(:enabled:hover)]:bg-destructive-hover",
    );
    expect(deleteButton?.className).toContain(
      "[&:where(:enabled:active)]:bg-destructive-active",
    );
    expect(deleteButton?.className).not.toMatch(
      /(?:^|\s)(?:enabled:)?(?:hover|active):bg-/,
    );
  });
});

/**
 * The per-preset output mode is a react-select combobox (the control
 * `<ModelSelect>` uses), not a native `<select>`: there is no `.value` to set.
 * Open the menu from its input, then click the row by its label.
 */
const chooseOption = async (
  container: HTMLElement,
  input: HTMLInputElement,
  label: string,
) => {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (option) => option.textContent === label,
  );
  if (!row) {
    throw new Error(`No output-mode option labelled "${label}"`);
  }
  await act(async () => {
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const baseElectronAPI = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  getKeyBindings: vi.fn().mockResolvedValue({}),
  onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
  fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
  getProviderStates: vi.fn().mockResolvedValue([]),
  getSelectedModel: vi.fn().mockResolvedValue(""),
  getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
  setLocale: vi.fn().mockResolvedValue({ success: true }),
  onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
  ...overrides,
});

describe("SettingCorrection output-mode and markdown controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  const correctionPreset = {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: "Fix the text.",
    model: "",
    isBuiltIn: true,
  };

  const askPreset = {
    id: DEFAULT_ASK_PRESET_ID,
    name: "Ask AI",
    hotkey: "Control+Shift+A",
    systemPrompt: "Answer the question.",
    model: "",
    isBuiltIn: true,
    reasoning: "minimal" as const,
    requiresInput: true,
    outputMode: "popup" as const,
    markdownOutput: true,
  };

  const mount = async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCorrection)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  /**
   * The shared `Checkbox` owns its wrapping `<label>` and takes no `id`, so the
   * markdown toggle is addressed by its `name` instead.
   */
  const markdownInput = () =>
    container.querySelector<HTMLInputElement>(
      'input[name="preset-markdown-output"]',
    );

  const selectAskPreset = async () => {
    const askButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Ask AI"),
    );
    await act(async () => {
      askButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  /** react-select's inner text input — what `<label htmlFor>` points at. */
  const outputModeInput = (): HTMLInputElement => {
    const input = container.querySelector<HTMLInputElement>(
      "input#preset-output-mode",
    );
    if (!input) {
      throw new Error("Expected the output-mode combobox input");
    }
    return input;
  };

  /** The closed control's own text: the selected row's label. */
  const outputModeControlText = (): string =>
    container.querySelector("#preset-output-mode-control")?.textContent ?? "";

  it("round-trips a preset's output-mode select through save", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [correctionPreset],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    const input = outputModeInput();
    // `inputId`, not `id`: react-select's `htmlFor` target is the input.
    expect(input.getAttribute("role")).toBe("combobox");
    expect(
      container.querySelector<HTMLLabelElement>('label[for="preset-output-mode"]')
        ?.textContent,
    ).toBe(tEn("settings.correction.outputMode.label"));
    expect(outputModeControlText()).toContain(
      tEn("settings.correction.outputMode.inherit"),
    );

    await chooseOption(
      container,
      input,
      tEn("settings.correction.outputMode.paste"),
    );
    expect(outputModeControlText()).toContain(
      tEn("settings.correction.outputMode.paste"),
    );

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setCorrectSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        presets: [expect.objectContaining({ outputMode: "paste" })],
      }),
    );
  });

  it("shows the markdown-output control only for the requiresInput preset", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [correctionPreset, askPreset],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        setCorrectSettings: vi.fn().mockResolvedValue({ success: true }),
      }),
    });

    await mount();

    expect(markdownInput()).toBeNull();

    await selectAskPreset();

    expect(markdownInput()).not.toBeNull();
    expect(markdownInput()?.checked).toBe(true);
  });

  it("renders the markdown toggle through the shared primary-colored Checkbox", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [askPreset],
          selectedPresetId: DEFAULT_ASK_PRESET_ID,
        }),
        setCorrectSettings: vi.fn().mockResolvedValue({ success: true }),
      }),
    });

    await mount();

    const input = markdownInput();
    if (!input) {
      throw new Error("Expected the markdown toggle to be rendered.");
    }
    expect(input.className).toContain("peer");
    expect(input.className).toContain("sr-only");
    expect(input.className).not.toContain("border-control-border");

    const box = input.nextElementSibling;
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.className).toContain("peer-checked:bg-primary");
    expect(box?.className).toContain("peer-checked:border-primary");
    expect(box?.className).toContain("peer-focus-visible:ring-ring");
  });

  it("toggles markdownOutput from a label click and keeps its accessible name", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [askPreset],
          selectedPresetId: DEFAULT_ASK_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    const input = markdownInput();
    if (!input) {
      throw new Error("Expected the markdown toggle to be rendered.");
    }
    const label = input.closest("label");
    expect(label?.textContent).toContain(
      tEn("settings.correction.markdownOutput.label"),
    );
    expect(input.disabled).toBe(false);

    await act(async () => {
      label?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(markdownInput()?.checked).toBe(false);

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setCorrectSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        presets: [expect.objectContaining({ markdownOutput: false })],
      }),
    );
  });

  it("Reset to default on Ask restores requiresInput, outputMode, and markdownOutput", async () => {
    const overriddenAsk = {
      ...askPreset,
      requiresInput: false,
      outputMode: "paste" as const,
      markdownOutput: false,
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [overriddenAsk],
          selectedPresetId: DEFAULT_ASK_PRESET_ID,
        }),
        setCorrectSettings: vi.fn().mockResolvedValue({ success: true }),
      }),
    });

    await mount();

    // Before reset: requiresInput is false, so no markdown control; outputMode
    // reads the overridden "paste".
    expect(markdownInput()).toBeNull();
    expect(outputModeControlText()).toContain(
      tEn("settings.correction.outputMode.paste"),
    );

    const resetButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === tEn("settings.correction.resetBuiltIn"),
    );
    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(outputModeControlText()).toContain(
      tEn("settings.correction.outputMode.popup"),
    );
    expect(markdownInput()).not.toBeNull();
    expect(markdownInput()?.checked).toBe(true);
  });
});

/**
 * The registry-driven option block. Every assertion about a write inspects the
 * PAYLOAD handed to `setCorrectSettings`, never the click and never the call
 * count alone: this harness reports green on an interaction that performed no
 * write at all (see the fixlang-settings-writes skill).
 */
describe("SettingCorrection preset-scoped options", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  const correctionPreset = {
    id: DEFAULT_CORRECTION_PRESET_ID,
    name: "Correction",
    hotkey: "Control+Shift+F",
    systemPrompt: "Fix the text.",
    model: "",
    isBuiltIn: true,
  };

  const cavemanPreset = {
    id: DEFAULT_CAVEMAN_PRESET_ID,
    name: "Caveman",
    hotkey: "Control+Shift+C",
    systemPrompt: "Compress the text.",
    model: "",
    isBuiltIn: true,
    extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "full" },
  };

  const mount = async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingCorrection)),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  /**
   * The per-preset option control is a react-select combobox (the same
   * control `<ModelSelect>` and the output-mode select use), not a native
   * `<select>`: there is no `.value` to set, so it is driven and read the
   * same way `chooseOption`/`outputModeControlText` do above.
   */
  const optionInput = (optionKey: string) =>
    container.querySelector<HTMLInputElement>(
      `input#preset-option-${optionKey}`,
    );

  const requireOptionInput = (optionKey: string): HTMLInputElement => {
    const input = optionInput(optionKey);
    if (!input) {
      throw new Error(`Expected the "${optionKey}" option control`);
    }
    return input;
  };

  /** The closed control's own text: the selected choice's label. */
  const optionControlText = (optionKey: string): string =>
    container.querySelector(`#preset-option-${optionKey}-control`)
      ?.textContent ?? "";

  const submit = async () => {
    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const selectPreset = async (name: string) => {
    const button = [...container.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes(name),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  const resetBuiltIn = async () => {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) =>
        candidate.textContent === tEn("settings.correction.resetBuiltIn"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  const duplicatePreset = async () => {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) =>
        candidate.textContent === tEn("settings.correction.duplicate"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  it("renders no option control for a preset that declares none, and the declared choices for one that does", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [correctionPreset, cavemanPreset],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        setCorrectSettings: vi.fn().mockResolvedValue({ success: true }),
      }),
    });

    await mount();

    expect(optionInput(CAVEMAN_MODE_OPTION_KEY)).toBeNull();
    expect(container.textContent).not.toContain(
      tEn("settings.correction.option.cavemanMode.label"),
    );

    await selectPreset("Caveman");

    const input = requireOptionInput(CAVEMAN_MODE_OPTION_KEY);
    expect(
      container.querySelector<HTMLLabelElement>(
        `label[for="preset-option-${CAVEMAN_MODE_OPTION_KEY}"]`,
      )?.textContent,
    ).toBe(tEn("settings.correction.option.cavemanMode.label"));

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(
      [...container.querySelectorAll('[role="option"]')].map(
        (option) => option.textContent,
      ),
    ).toEqual([
      tEn("settings.correction.option.cavemanMode.lite"),
      tEn("settings.correction.option.cavemanMode.full"),
      tEn("settings.correction.option.cavemanMode.ultra"),
    ]);
    expect(optionControlText(CAVEMAN_MODE_OPTION_KEY)).toContain(
      tEn("settings.correction.option.cavemanMode.full"),
    );
    expect(container.textContent).toContain(
      tEn("settings.correction.option.cavemanMode.hint"),
    );
  });

  it("carries a changed option value into the saved payload", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [cavemanPreset],
          selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    await chooseOption(
      container,
      requireOptionInput(CAVEMAN_MODE_OPTION_KEY),
      tEn("settings.correction.option.cavemanMode.ultra"),
    );
    expect(optionControlText(CAVEMAN_MODE_OPTION_KEY)).toContain(
      tEn("settings.correction.option.cavemanMode.ultra"),
    );

    await submit();

    expect(setCorrectSettings).toHaveBeenCalledTimes(1);
    expect(setCorrectSettings.mock.calls[0][0]).toMatchObject({
      presets: [
        expect.objectContaining({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
        }),
      ],
    });
  });

  it("writes the option onto the preset that declares it, not the first preset", async () => {
    // Every other test here mounts a SINGLE-preset fixture, which cannot tell
    // `preset.id === presetId` from `index === 0` — routing the write to
    // `presets[0]` passes all of them. A real profile ships eight built-ins,
    // so writing a preset-option edit onto the wrong preset is the regression
    // that actually reaches users. Caveman is deliberately NOT first here.
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [correctionPreset, cavemanPreset],
          selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    await chooseOption(
      container,
      requireOptionInput(CAVEMAN_MODE_OPTION_KEY),
      tEn("settings.correction.option.cavemanMode.ultra"),
    );

    await submit();

    const payload = setCorrectSettings.mock.calls[0][0];
    const caveman = payload.presets.find(
      (preset: { id: string }) => preset.id === DEFAULT_CAVEMAN_PRESET_ID,
    );
    const correction = payload.presets.find(
      (preset: { id: string }) => preset.id === DEFAULT_CORRECTION_PRESET_ID,
    );

    expect(caveman?.extraOptions).toEqual({
      [CAVEMAN_MODE_OPTION_KEY]: "ultra",
    });
    expect(correction?.extraOptions).toBeUndefined();
  });

  it("merges into extraOptions rather than replacing it", async () => {
    // `updatePresetOption` spreads the existing `extraOptions` before writing
    // the changed key. Replacing the spread with a bare overwrite passes every
    // other test, because Caveman declares exactly ONE option today and no
    // other fixture carries a second key — so merge and overwrite are
    // observationally identical everywhere else.
    //
    // A second DECLARED option would be the faithful fixture, but the registry
    // has only one. An unrelated stored key stands in for it: the store's
    // `sanitizePresetOptions` would drop such a key on its own way in, so this
    // asserts the COMPONENT's merge semantics specifically, which is where the
    // data loss would occur once any preset declares two options.
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              ...cavemanPreset,
              extraOptions: {
                [CAVEMAN_MODE_OPTION_KEY]: "lite",
                unrelatedOption: "must survive",
              },
            },
          ],
          selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    await chooseOption(
      container,
      requireOptionInput(CAVEMAN_MODE_OPTION_KEY),
      tEn("settings.correction.option.cavemanMode.ultra"),
    );

    await submit();

    const payload = setCorrectSettings.mock.calls[0][0];

    expect(payload.presets[0].extraOptions).toEqual({
      [CAVEMAN_MODE_OPTION_KEY]: "ultra",
      unrelatedOption: "must survive",
    });
  });

  it("gates the option block on the registry, never on a preset id", async () => {
    // The card's central claim is that a future preset declaring an option
    // renders with ZERO changes to this file. Nothing behavioural can pin that
    // today: the registry declares exactly one preset id, so reading the
    // registry and hardcoding `activePreset.id === "caveman"` are
    // indistinguishable to every test above — the substitution was made and
    // the whole suite stayed green.
    //
    // A source guard, in the style of `ButtonSourceGuard` and the
    // `profileChange` broadcast guard. HONEST LIMIT: this pins the
    // id-comparison SHAPE, which is the substitution that actually happened,
    // not every conceivable way to reintroduce a per-preset branch. The
    // component legitimately names Caveman in `makeBuiltInPresetDefaults()` —
    // a defaults table must know its defaults — so a whole-file ban on the id
    // would be wrong and is deliberately not what this asserts.
    // Resolved from `process.cwd()`, matching `ButtonSourceGuard.test.ts`:
    // under the jsdom environment `import.meta.url` is not a file: URL, so
    // handing it to `readFile` throws "The URL must be of scheme file".
    const source = await readFile(
      path.join(
        process.cwd(),
        "src/renderer/components/SettingCorrection.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("presetOptionDefinitions(activePreset.id)");
    expect(source).not.toMatch(/activePreset\.id\s*===/);
  });

  it("restores the built-in option value on Reset to default", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              ...cavemanPreset,
              extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
            },
          ],
          selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    expect(optionControlText(CAVEMAN_MODE_OPTION_KEY)).toContain(
      tEn("settings.correction.option.cavemanMode.ultra"),
    );

    await resetBuiltIn();

    expect(optionControlText(CAVEMAN_MODE_OPTION_KEY)).toContain(
      tEn("settings.correction.option.cavemanMode.full"),
    );

    await submit();

    expect(setCorrectSettings).toHaveBeenCalledTimes(1);
    expect(setCorrectSettings.mock.calls[0][0]).toMatchObject({
      presets: [
        expect.objectContaining({
          id: DEFAULT_CAVEMAN_PRESET_ID,
          extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "full" },
        }),
      ],
    });
  });

  /**
   * NOT covered by the test above, and the reason `extraOptions` is named in
   * `handleResetBuiltIn`'s explicit key list: Caveman's built-in default HAS an
   * `extraOptions`, so the plain `...defaultPreset` spread already restores it
   * and that test stays green with the explicit key removed. Only a preset
   * whose built-in default OMITS the key exposes the leftover surviving Reset.
   */
  it("clears an extraOptions blob the built-in default does not declare", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            { ...correctionPreset, extraOptions: { strayOption: "leftover" } },
          ],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();

    await resetBuiltIn();
    await submit();

    expect(setCorrectSettings).toHaveBeenCalledTimes(1);
    expect(setCorrectSettings.mock.calls[0][0]).toMatchObject({
      presets: [
        expect.objectContaining({
          id: DEFAULT_CORRECTION_PRESET_ID,
          extraOptions: undefined,
        }),
      ],
    });
  });

  /**
   * `PRESET_OPTION_DEFINITIONS` is keyed by BUILT-IN preset id, so a
   * duplicate's fresh `custom-*` id declares no options: the intensity
   * control that produced this directive would render nothing for the copy,
   * and `withPresetOptions` would hand the raw prompt to the model with no
   * directive appended at all — even though `src/prompts/caveman.md` tells the
   * model an intensity level is coming. Duplicating must therefore bake the
   * ACTIVE choice's fragment into the copy's own `systemPrompt` and must not
   * carry `extraOptions` forward, since nothing will ever read it again.
   */
  it("duplicating Caveman at a non-default level bakes that level's directive into the copy and drops extraOptions", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [
            {
              ...cavemanPreset,
              extraOptions: { [CAVEMAN_MODE_OPTION_KEY]: "ultra" },
            },
          ],
          selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();
    await duplicatePreset();
    await submit();

    expect(setCorrectSettings).toHaveBeenCalledTimes(1);
    const payload = setCorrectSettings.mock.calls[0][0];
    expect(payload.presets).toHaveLength(2);
    const duplicate = payload.presets[1];

    expect(duplicate.systemPrompt).toContain(
      DEFAULT_CAVEMAN_ULTRA_DIRECTIVE.trim(),
    );
    expect(duplicate.systemPrompt).not.toContain(
      DEFAULT_CAVEMAN_FULL_DIRECTIVE.trim(),
    );
    expect(duplicate.extraOptions).toBeUndefined();
  });

  /**
   * Not covered by the test above: Caveman's declared DEFAULT is "full", so a
   * duplicate made while sitting on the default level must still bake that
   * default's directive into the copy rather than silently going
   * level-less. `resolvePresetOptionValue` falling back to the definition's
   * default is exactly the code path this pins.
   */
  it("duplicating Caveman at the default level still bakes the default directive into the copy", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [cavemanPreset], // extraOptions: { cavemanMode: "full" }
          selectedPresetId: DEFAULT_CAVEMAN_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();
    await duplicatePreset();
    await submit();

    const payload = setCorrectSettings.mock.calls[0][0];
    const duplicate = payload.presets[1];

    expect(duplicate.systemPrompt).toContain(
      DEFAULT_CAVEMAN_FULL_DIRECTIVE.trim(),
    );
    expect(duplicate.extraOptions).toBeUndefined();
  });

  /**
   * `withPresetOptions` returns the SAME string (not merely an equal one) for
   * a preset that declares no options, so every non-Caveman preset must
   * duplicate byte-for-byte — no trailing separator, no accidental
   * `extraOptions` key appearing where none existed before.
   */
  it("duplicating a preset with no declared options leaves systemPrompt byte-identical and adds no extraOptions", async () => {
    const setCorrectSettings = vi.fn().mockResolvedValue({ success: true });
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: baseElectronAPI({
        getCorrectSettings: vi.fn().mockResolvedValue({
          presets: [correctionPreset],
          selectedPresetId: DEFAULT_CORRECTION_PRESET_ID,
        }),
        setCorrectSettings,
      }),
    });

    await mount();
    await duplicatePreset();
    await submit();

    const payload = setCorrectSettings.mock.calls[0][0];
    const duplicate = payload.presets[1];

    expect(duplicate.systemPrompt).toBe(correctionPreset.systemPrompt);
    expect(Object.hasOwn(duplicate, "extraOptions")).toBe(false);
  });
});
