import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/features/i18n/shared/translate";
import {
  DEFAULT_ASK_PRESET_ID,
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
