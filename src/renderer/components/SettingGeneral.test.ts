/**
 * @file SettingGeneral.test.ts
 * @description Regression test for the resetStatus/outputMode/fetch/apply
 * "frozen translation" bug: `SettingGeneral` used to store the *resolved*
 * string from `t()` in `useState<string>` at the moment an action ran (e.g.
 * `setResetStatus(t("settings.general.reset.inProgress"))`). Because
 * `SettingGeneral` hosts the interface-language picker itself, a user could
 * trigger "Reset to defaults", then switch to Japanese, and watch the
 * still-English status banner sit there unchanged — the exact panel where
 * the app promises instant, restart-free language switching.
 *
 * The fix stores a locale-free descriptor (`StatusDescriptor` from
 * `./statusDescriptor`) and resolves it at render time via `tm()`/`t()`, so
 * the banner re-renders in the new locale immediately, with no re-fetch.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component directly via
 * `react-dom/client` + `act`, following `SettingUpdates.test.ts` /
 * `HotkeyInput.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messageLabel, textLabel, type Label } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import ModelManagerDialog from "./ModelManagerDialog";
import ProfileManager from "./ProfileManager";
import { SettingGeneral } from "./SettingGeneral";
import { SettingPromptGen } from "./SettingPromptGen";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";

// Expected copy is derived through the real translator kernel — never
// hand-written — so a catalog reword can't silently break this file, and an
// English-fallback regression still fails a test that asserts JA text.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const buttonNamed = (
  container: HTMLElement,
  label: string,
): HTMLButtonElement => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) {
    throw new Error(`Expected a button named "${label}"`);
  }
  return button;
};


const connectButtonNear = (
  root: HTMLElement,
  fieldId: string,
): HTMLButtonElement => {
  const field = root.querySelector(fieldId);
  const card = field?.closest("div.rounded.border");
  if (!card) {
    throw new Error(`Expected a provider card containing ${fieldId}`);
  }
  const button = [...card.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === tEn("settings.general.providers.card.connect"),
  );
  if (!button) {
    throw new Error(`Expected Connect in the card for ${fieldId}`);
  }
  return button;
};

type ResetResult = { success: boolean; error?: Label };

type SettingGeneralApi = {
  getProviderStates: ReturnType<typeof vi.fn>;
  connectProvider: ReturnType<typeof vi.fn>;
  disconnectProvider: ReturnType<typeof vi.fn>;
  onProfileUpdated: ReturnType<typeof vi.fn>;
  getCorrectionOutputMode: ReturnType<typeof vi.fn>;
  setCorrectionOutputMode: ReturnType<typeof vi.fn>;
  resetProfileSettings: ReturnType<typeof vi.fn>;
  // Read by the embedded `<ModelSelect>`.
  fetchAIModels: ReturnType<typeof vi.fn>;
  getSelectedModel: ReturnType<typeof vi.fn>;
  setSelectedModel: ReturnType<typeof vi.fn>;
  onSettingsUpdated: ReturnType<typeof vi.fn>;
  // `SettingGeneral` renders inside `<I18nProvider>`, which reads these off
  // `window.electronAPI` on mount (see `localeState.ts`'s `LocaleBridge`).
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
};

/** React ignores a direct `.value` assignment; the native setter bypasses it. */
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const providerState = (overrides: Record<string, unknown> = {}) => ({
  connected: false,
  configured: false,
  apiKeySet: false,
  provisioningKeySet: false,
  modelCount: 0,
  ...overrides,
});

const componentSource = (fileName: string) =>
  readFileSync(
    join(process.cwd(), "src/renderer/components", fileName),
    "utf8",
  );

type ButtonContract = {
  id: string;
  type: string;
  variant: string;
  handlers: Record<string, string>;
  disabled: string | null;
  aria: Record<string, string>;
  title: string | null;
  className: string | null;
};

const normalizeSourceText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const buttonContract = (
  id: string,
  overrides: Partial<Omit<ButtonContract, "id">> = {},
): ButtonContract => ({
  id,
  type: '"button"',
  variant: '"primary"',
  handlers: {},
  disabled: null,
  aria: {},
  title: null,
  className: null,
  ...overrides,
});

const extractButtonContracts = (
  fileName: string,
  ids: readonly string[],
): ButtonContract[] => {
  const source = componentSource(fileName);
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const buttonAttributes: Record<string, string>[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(sourceFile) === "Button"
    ) {
      const attributes: Record<string, string> = {};
      for (const property of node.openingElement.attributes.properties) {
        if (!ts.isJsxAttribute(property)) continue;
        attributes[property.name.getText(sourceFile)] = property.initializer
          ? normalizeSourceText(property.initializer.getText(sourceFile))
          : "true";
      }
      buttonAttributes.push(attributes);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  expect(buttonAttributes).toHaveLength(ids.length);
  return buttonAttributes.map((attributes, index) => ({
    id: ids[index],
    type: attributes.type ?? '"button"',
    variant: attributes.variant ?? '"primary"',
    handlers: Object.fromEntries(
      Object.entries(attributes).filter(([name]) => name.startsWith("on")),
    ),
    disabled: attributes.disabled ?? null,
    aria: Object.fromEntries(
      Object.entries(attributes).filter(([name]) => name.startsWith("aria-")),
    ),
    title: attributes.title ?? null,
    className: attributes.className ?? null,
  }));
};

const expectedModelManagerContracts = [
  buttonContract("BTN-012", {
    variant: '"ghost"',
    handlers: { onClick: "{onClose}" },
    aria: { "aria-label": '{t("common.close")}' },
    className: '"text-muted-foreground hover:text-foreground"',
  }),
  buttonContract("BTN-013", {
    variant: '{activeTab === "installed" ? "primary" : "ghost"}',
    handlers: { onClick: '{() => setActiveTab("installed")}' },
    className:
      '{`px-4 py-2 ${ activeTab === "installed" ? "border-b-2 border-primary" : "text-muted-foreground hover:text-foreground" }`}',
  }),
  buttonContract("BTN-014", {
    variant: '{activeTab === "recommended" ? "primary" : "ghost"}',
    handlers: { onClick: '{() => setActiveTab("recommended")}' },
    className:
      '{`px-4 py-2 ${ activeTab === "recommended" ? "border-b-2 border-primary" : "text-muted-foreground hover:text-foreground" }`}',
  }),
  buttonContract("BTN-015", {
    variant: '"ghost"',
    handlers: { onClick: "{refreshModels}" },
    disabled: "{isRefreshing}",
    title: '{t("models.manager.refresh")}',
    className:
      '{`text-card-foreground hover:text-foreground ${ isRefreshing ? "animate-spin" : "" }`}',
  }),
  buttonContract("BTN-016", {
    variant: '"ghost"',
    handlers: { onClick: '{() => setActiveTab("recommended")}' },
    className: '"mt-2 text-primary hover:underline"',
  }),
  buttonContract("BTN-017", {
    variant: '"destructive"',
    handlers: {
      onClick:
        "{() => setDeleteConfirmation({ isOpen: true, modelName: model.local?.path, }) }",
    },
    title: '{t("models.manager.deleteTitle")}',
  }),
  buttonContract("BTN-018", {
    variant: '{ model.status === "error" ? "destructive" : "primary" }',
    handlers: { onClick: "{() => installModel(model.name)}" },
    disabled: '{model.status === "installing"}',
    className:
      '{`px-3 py-1 rounded text-sm ${ model.status === "success" ? "bg-success text-success-foreground cursor-default [&:where(:enabled:hover)]:bg-success [&:where(:enabled:active)]:bg-success" : model.status === "installing" ? "bg-primary text-primary-foreground animate-pulse cursor-wait" : model.status === "error" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground hover:bg-primary" }`}',
  }),
  buttonContract("BTN-019", {
    variant: '"secondary"',
    handlers: {
      onClick: "{() => setDeleteConfirmation({ isOpen: false })}",
    },
    className: '"px-4 py-2 rounded"',
  }),
  buttonContract("BTN-020", {
    variant: '"destructive"',
    handlers: {
      onClick:
        '{() => deleteModel(deleteConfirmation.modelName || "") }',
    },
    className: '"px-4 py-2 rounded"',
  }),
] satisfies ButtonContract[];

const expectedProfileManagerContracts = [
  buttonContract("BTN-029", {
    handlers: { onClick: "{() => setIsCreateDialogOpen(true)}" },
    disabled: "{isLoading}",
    className: '"px-3 py-1.5 text-sm font-medium rounded"',
  }),
  buttonContract("BTN-030", {
    variant: '"secondary"',
    handlers: { onClick: "{() => setIsImportDialogOpen(true)}" },
    disabled: "{isLoading}",
    className: '"px-3 py-1.5 text-sm font-medium rounded"',
  }),
  buttonContract("BTN-031", {
    handlers: { onClick: "{() => handleApplyProfile(profile.id)}" },
    className: '"px-2.5 py-1 text-xs font-medium rounded"',
  }),
  buttonContract("BTN-032", {
    variant: '"secondary"',
    handlers: { onClick: "{() => handleExportProfile(profile.id)}" },
    className: '"px-2.5 py-1 text-xs font-medium rounded"',
  }),
  buttonContract("BTN-033", {
    variant: '"destructive"',
    handlers: { onClick: "{() => handleDeleteProfile(profile.id)}" },
    className: '"px-2.5 py-1 text-xs font-medium rounded"',
  }),
  buttonContract("BTN-034", {
    variant: '"secondary"',
    handlers: { onClick: "{() => setIsCreateDialogOpen(false)}" },
    className: '"px-4 py-2 font-medium rounded"',
  }),
  buttonContract("BTN-035", {
    handlers: { onClick: "{handleCreateProfile}" },
    disabled: "{!newProfileName.trim()}",
    className: '"px-4 py-2 font-medium rounded"',
  }),
  buttonContract("BTN-036", {
    variant: '"secondary"',
    handlers: { onClick: "{() => setIsExportDialogOpen(false)}" },
    className: '"px-4 py-2 font-medium rounded"',
  }),
  buttonContract("BTN-037", {
    handlers: {
      onClick: "{() => handleCopyToClipboard(exportProfileJson)}",
    },
    className: '"px-4 py-2 font-medium rounded"',
  }),
  buttonContract("BTN-038", {
    variant: '"secondary"',
    handlers: { onClick: "{() => setIsImportDialogOpen(false)}" },
    className: '"px-4 py-2 font-medium rounded"',
  }),
  buttonContract("BTN-039", {
    handlers: { onClick: "{handleImportProfile}" },
    disabled: "{!importProfileJson.trim()}",
    className: '"px-4 py-2 font-medium rounded"',
  }),
] satisfies ButtonContract[];

const expectedPromptGenContracts = [
  buttonContract("BTN-056", {
    variant: '"ghost"',
    handlers: {
      onClick:
        "{() => setPromptGenSettings({ ...promptGenSettings, context: DEFAULT_PROMPT_GEN_PROMPT.trim(), }) }",
    },
    title: '{t("settings.promptGen.useDefaultTextTemplateTitle")}',
    className: '"text-primary hover:text-primary"',
  }),
  buttonContract("BTN-057", {
    variant: '"ghost"',
    handlers: {
      onClick:
        "{() => setPromptGenSettings({ ...promptGenSettings, context: DEFAULT_PROMPT_GEN_IMAGE_PROMPT.trim(), }) }",
    },
    title: '{t("settings.promptGen.useImageTemplateTitle")}',
    className: '"text-primary hover:text-primary"',
  }),
  buttonContract("BTN-058", {
    type: '"submit"',
    className: '"px-3 py-2 rounded"',
  }),
  buttonContract("BTN-059", {
    variant: '"secondary"',
    handlers: { onClick: "{handleReset}" },
    className: '"px-3 py-2 rounded"',
  }),
] satisfies ButtonContract[];

describe("SettingGeneral", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let api: SettingGeneralApi;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  const confirmDisconnectButton = (): HTMLButtonElement => {
    const panel = container.querySelector('[role="alertdialog"]');
    if (!panel) throw new Error("expected the disconnect confirmation panel");
    const button = [...panel.querySelectorAll("button")].find(
      (candidate) =>
        candidate.textContent ===
        tEn("settings.general.providers.card.disconnect"),
    );
    if (!button) throw new Error("expected the panel's Disconnect button");
    return button;
  };

  const render = async (
    resetResult: ResetResult,
    states: Record<string, unknown> = {
      openai: providerState({
        connected: true,
        configured: true,
        apiKeySet: true,
        modelCount: 3,
      }),
      openrouter: providerState(),
      ollama: providerState(),
    },
  ) => {
    api = {
      // Set on every render, not in a `beforeEach`: `vi.clearAllMocks()`
      // clears calls but not return values.
      getProviderStates: vi.fn().mockResolvedValue(states),
      connectProvider: vi.fn().mockResolvedValue({ success: true }),
      disconnectProvider: vi.fn().mockResolvedValue({
        success: true,
        cleared: { selectedModel: false, presetIds: [], features: [] },
      }),
      onProfileUpdated: vi.fn().mockReturnValue(vi.fn()),
      getCorrectionOutputMode: vi.fn().mockResolvedValue("paste"),
      setCorrectionOutputMode: vi
        .fn()
        .mockResolvedValue({ success: true, mode: "paste" }),
      resetProfileSettings: vi.fn().mockResolvedValue(resetResult),
      fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
      getSelectedModel: vi.fn().mockResolvedValue(""),
      setSelectedModel: vi.fn().mockResolvedValue({ success: true }),
      onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    };
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(SettingGeneral)),
      );
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and the mount-time provider/output-mode fetches need a further tick to
    // land in state (mirrors `SettingUpdates.test.ts`).
    await waitForUi();
    await waitForUi();
  };

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    localeListener = undefined;
    confirmSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("re-resolves the reset-success status in Japanese after a locale switch, with no re-fetch", async () => {
    await render({ success: true });

    await click(buttonNamed(container, tEn("settings.general.reset.button")));

    const status = () => container.querySelector('[role="status"]');
    // Only the reset status banner is non-empty text at this point.
    expect(
      [...container.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      ),
    ).toContain(tEn("settings.general.reset.success"));

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const jaExpected = tJa("settings.general.reset.success");
    const enExpected = tEn("settings.general.reset.success");
    expect(
      [...container.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      ),
    ).toContain(jaExpected);
    // Prove the locale actually changed and this isn't an English fallback.
    expect(jaExpected).not.toBe(enExpected);
    // The locale switch must not re-run `resetProfileSettings()` — the
    // banner is a locale-free descriptor resolved at render time, not
    // refetched from the action.
    expect(api.resetProfileSettings).toHaveBeenCalledTimes(1);
    void status;
  });

  it("re-resolves a wrapped provider-reported reset error in Japanese, keeping the raw error text untranslated", async () => {
    // Main now boundary-wraps `resetCurrentProfileSettings()`'s pass-through
    // error text as an opaque `textLabel` (see `wrapStoreResult` in
    // `~/main/ipc/features/ipcResultLabel.ts`) rather than a bare string —
    // mock the real preload/IPC shape, not the pre-migration one.
    await render({ success: false, error: textLabel("disk full") });

    await click(buttonNamed(container, tEn("settings.general.reset.button")));

    const enWrapped = tEn("settings.general.error", { message: "disk full" });
    expect(
      [...container.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      ),
    ).toContain(enWrapped);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    // Only the "Error: " wrapper itself re-translates — "disk full" is raw
    // provider text and must survive verbatim in both locales.
    const jaWrapped = tJa("settings.general.error", { message: "disk full" });
    expect(
      [...container.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      ),
    ).toContain(jaWrapped);
    expect(jaWrapped).not.toBe(enWrapped);
    expect(jaWrapped).toContain("disk full");
  });

  it("re-resolves an app-authored output-mode error Label directly (no double `textLabel` wrap) in Japanese", async () => {
    // PR #87 review finding: `set-correction-output-mode`'s "Invalid
    // correction output mode" used to be a raw string the renderer wrapped
    // with `textLabel(result.error)`. Main now returns a `messageLabel(...)`
    // `Label` directly — if this component still wrapped it in `textLabel`,
    // the resolved text would stay frozen in whatever locale was active at
    // the moment of the click instead of re-translating below.
    await render({ success: true });
    api.setCorrectionOutputMode.mockResolvedValueOnce({
      success: false,
      error: messageLabel("settings.general.outputMode.invalid"),
    });

    const popupRadio = [
      ...container.querySelectorAll('button[role="radio"]'),
    ].find(
      (candidate) =>
        candidate.querySelector("span")?.textContent ===
        tEn("settings.general.correctionOutput.popup.label"),
    );
    if (!popupRadio) {
      throw new Error("Expected the 'popup' output-mode radio button");
    }
    await click(popupRadio);
    await waitForUi();
    await waitForUi();

    const statuses = () =>
      [...container.querySelectorAll('[role="status"]')].map(
        (el) => el.textContent,
      );
    const enWrapped = tEn("settings.general.error", {
      message: tEn("settings.general.outputMode.invalid"),
    });
    expect(statuses()).toContain(enWrapped);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    // Only the "Error: " wrapper AND the message both re-translate — proving
    // the underlying error is a `Message` resolved via `tl()`, not raw text
    // frozen by a stray `textLabel(result.error)` wrap.
    const jaWrapped = tJa("settings.general.error", {
      message: tJa("settings.general.outputMode.invalid"),
    });
    expect(statuses()).toContain(jaWrapped);
    expect(jaWrapped).not.toBe(enWrapped);
  });

  describe("provider cards", () => {
    it("renders one card per provider, each with its own connection state", async () => {
      await render({ success: true });

      for (const key of [
        "models.select.provider.openai",
        "models.select.provider.openrouter",
        "models.select.provider.ollama",
      ] as const) {
        expect(container.textContent).toContain(tEn(key));
      }
      expect(container.textContent).toContain(
        tEn("settings.general.providers.card.connected"),
      );
      expect(container.textContent).toContain(
        tEn("settings.general.providers.card.notConnected"),
      );
      expect(container.textContent).toContain(
        tEn("settings.general.providers.card.modelCount", { count: 3 }),
      );
    });

    it("connects one provider without a modelId and without touching the others", async () => {
      await render({ success: true });

      const input = container.querySelector<HTMLInputElement>(
        "#api-key-openrouter",
      );
      if (!input) throw new Error("expected an OpenRouter API key field");
      await type(input, "sk-or-typed");

      await click(connectButtonNear(container, "#api-key-openrouter"));
      await waitForUi();

      expect(api.connectProvider).toHaveBeenCalledTimes(1);
      expect(api.connectProvider).toHaveBeenCalledWith({
        provider: "openrouter",
        apiKey: "sk-or-typed",
        provisioningKey: undefined,
      });
      // Connecting never seeds a default model — that is the picker's job.
      expect(api.setSelectedModel).not.toHaveBeenCalled();
    });

    it("requires an explicit confirm before disconnecting, and can be cancelled", async () => {
      await render({ success: true });

      await click(
        buttonNamed(
          container,
          tEn("settings.general.providers.card.disconnect"),
        ),
      );
      const panel = container.querySelector('[role="alertdialog"]');
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("aria-labelledby")).toBe(
        "disconnect-title-openai",
      );
      expect(container.textContent).toContain(
        tEn("settings.general.providers.disconnect.warning.title", {
          provider: tEn("models.select.provider.openai"),
        }),
      );
      expect(api.disconnectProvider).not.toHaveBeenCalled();
      expect(
        [...container.querySelectorAll("button")].filter(
          (button) =>
            button.textContent ===
            tEn("settings.general.providers.card.disconnect"),
        ),
      ).toHaveLength(1);

      await click(buttonNamed(container, tEn("common.cancel")));
      expect(api.disconnectProvider).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it("reports exactly what a disconnect cleared, keeping the presets fact off the default-model fact", async () => {
      await render({ success: true });
      api.disconnectProvider.mockResolvedValueOnce({
        success: true,
        cleared: {
          selectedModel: false,
          presetIds: ["p1", "p2"],
          features: [],
        },
      });

      await click(
        buttonNamed(
          container,
          tEn("settings.general.providers.card.disconnect"),
        ),
      );
      await click(confirmDisconnectButton());
      await waitForUi();

      expect(api.disconnectProvider).toHaveBeenCalledWith("openai");
      expect(container.textContent).toContain(
        tEn("settings.general.providers.disconnect.warning.cleared", {
          count: 2,
        }),
      );
      expect(container.textContent).toContain(
        tEn("settings.general.providers.disconnect.warning.key"),
      );
      expect(container.textContent).not.toContain(
        tEn("settings.general.providers.disconnect.warning.selectedModel"),
      );
    });

    it("keeps credential fields masked and out of browser autofill", async () => {
      await render({ success: true });

      for (const id of [
        "#api-key-openai",
        "#api-key-openrouter",
        "#provisioning-key-openrouter",
      ]) {
        const field = container.querySelector<HTMLInputElement>(id);
        if (!field) throw new Error(`expected ${id}`);
        expect(field.type).toBe("password");
        expect(field.getAttribute("autocomplete")).toBe("off");
      }

      // React 19 reflects a controlled input's value into the `value`
      // attribute, so a typed key is briefly present in `innerHTML` — hence
      // the next test, which pins that it is dropped from state.
    });

    it("drops the typed key from renderer state as soon as main has it", async () => {
      await render({ success: true });

      const input = () =>
        container.querySelector<HTMLInputElement>("#api-key-openrouter");
      const field = input();
      if (!field) throw new Error("expected an OpenRouter API key field");
      await type(field, "sk-or-typed");
      expect(input()?.value).toBe("sk-or-typed");

      await click(connectButtonNear(container, "#api-key-openrouter"));
      await waitForUi();

      // The secret is written once and then must not linger in the renderer.
      expect(input()?.value).toBe("");
    });

    it("drops the typed key after a disconnect too", async () => {
      await render({ success: true });

      const input = () =>
        container.querySelector<HTMLInputElement>("#api-key-openai");
      const field = input();
      if (!field) throw new Error("expected an OpenAI API key field");
      await type(field, "sk-typed");

      await click(
        buttonNamed(
          container,
          tEn("settings.general.providers.card.disconnect"),
        ),
      );
      await click(confirmDisconnectButton());
      await waitForUi();

      expect(input()?.value).toBe("");
    });

    it("keeps one provider's in-flight connect from unlocking another's button", async () => {
      await render({ success: true });

      // Hold OpenRouter's connect open.
      let settle: (value: unknown) => void = () => undefined;
      api.connectProvider.mockReturnValueOnce(
        new Promise((resolve) => {
          settle = resolve;
        }),
      );

      const field = container.querySelector<HTMLInputElement>(
        "#api-key-openrouter",
      );
      if (!field) throw new Error("expected an OpenRouter API key field");
      await type(field, "sk-or-typed");

      const connectButtons = () =>
        [...container.querySelectorAll("button")].filter(
          (button) =>
            button.textContent ===
              tEn("settings.general.providers.card.connect") ||
            button.textContent ===
              tEn("settings.general.providers.card.testing"),
        );
      await click(connectButtonNear(container, "#api-key-openrouter"));

      const testing = connectButtons().filter(
        (button) =>
          button.textContent === tEn("settings.general.providers.card.testing"),
      );
      // Kills: a single shared busy slot for every provider.
      expect(testing).toHaveLength(1);

      // Ollama needs no key and must still be connectable meanwhile.
      const ollamaConnect = connectButtons().find(
        (button) =>
          button.textContent === tEn("settings.general.providers.card.connect"),
      );
      expect(ollamaConnect?.disabled).toBe(false);

      await act(async () => {
        settle({ success: true });
      });
      await waitForUi();
    });

    it("refuses to attempt a connect with no stored and no typed key", async () => {
      await render({ success: true });

      // OpenRouter: no stored key, nothing typed.
      expect(connectButtonNear(container, "#api-key-openrouter").disabled).toBe(true);

      const field = container.querySelector<HTMLInputElement>(
        "#api-key-openrouter",
      );
      if (!field) throw new Error("expected an OpenRouter API key field");
      await type(field, "sk-or-typed");

      expect(connectButtonNear(container, "#api-key-openrouter").disabled).toBe(false);
    });

    it("renders a SUCCESS-path note verbatim, never through the Error wrapper", async () => {
      // Kills: routing `note` through `wrappedError`, which would announce a
      // connect that worked as "Error: …".
      await render(
        { success: true },
        {
          openai: providerState({
            connected: true,
            configured: true,
            apiKeySet: true,
          }),
          openrouter: providerState(),
          ollama: providerState(),
        },
      );
      api.connectProvider.mockResolvedValueOnce({
        success: true,
        note: messageLabel("settings.general.providers.ollama.noModels"),
      });

      const connectButtons = [...container.querySelectorAll("button")].filter(
        (button) =>
          button.textContent === tEn("settings.general.providers.card.connect"),
      );
      // Ollama's card is last in PROVIDER_ORDER and needs no key.
      await click(connectButtons[connectButtons.length - 1] ?? never());
      await waitForUi();

      const note = tEn("settings.general.providers.ollama.noModels");
      expect(container.textContent).toContain(note);
      expect(container.textContent).not.toContain(
        tEn("settings.general.error", { message: note }),
      );
    });

    it("reports the disconnect on its own card only", async () => {
      await render({ success: true });

      await click(
        buttonNamed(
          container,
          tEn("settings.general.providers.card.disconnect"),
        ),
      );
      await click(confirmDisconnectButton());
      await waitForUi();

      const reports = [...container.querySelectorAll('[role="status"]')].filter(
        (node) =>
          node.textContent?.includes(
            tEn("settings.general.providers.disconnect.warning.nothing"),
          ),
      );
      expect(reports).toHaveLength(1);
    });

    it("does not claim a stored key will be deleted for a provider that has none", async () => {
      await render(
        { success: true },
        {
          openai: providerState(),
          openrouter: providerState(),
          ollama: providerState({ connected: true, configured: true }),
        },
      );

      await click(
        buttonNamed(
          container,
          tEn("settings.general.providers.card.disconnect"),
        ),
      );

      expect(container.textContent).toContain(
        tEn("settings.general.providers.disconnect.warning.title", {
          provider: tEn("models.select.provider.ollama"),
        }),
      );
      expect(container.textContent).not.toContain(
        tEn("settings.general.providers.disconnect.warning.key"),
      );
    });

    it("shows the stored-secret indicator per credential slot", async () => {
      await render(
        { success: true },
        {
          openai: providerState({
            connected: true,
            configured: true,
            apiKeySet: true,
          }),
          openrouter: providerState({
            apiKeySet: true,
            provisioningKeySet: false,
          }),
          ollama: providerState(),
        },
      );

      const near = (id: string): string => {
        const field = container.querySelector(id);
        return field?.parentElement?.textContent ?? "";
      };
      expect(near("#api-key-openrouter")).toContain(
        tEn("settings.general.secret.set"),
      );
      expect(near("#provisioning-key-openrouter")).toContain(
        tEn("settings.general.secret.unset"),
      );
    });

    it("labels a stored admin key as Admin / Provisioning connected", async () => {
      await render(
        { success: true },
        {
          openai: providerState(),
          openrouter: providerState({
            apiKeySet: true,
            provisioningKeySet: true,
          }),
          ollama: providerState(),
        },
      );

      const field = container.querySelector("#provisioning-key-openrouter");
      const near = field?.parentElement?.textContent ?? "";
      expect(near).toContain(tEn("settings.general.secret.adminConnected"));
      expect(near).not.toContain(tEn("settings.general.secret.set"));
    });

    it("says nothing will be lost when the disconnect cleared nothing", async () => {
      await render({ success: true });

      await click(
        buttonNamed(
          container,
          tEn("settings.general.providers.card.disconnect"),
        ),
      );
      await click(confirmDisconnectButton());
      await waitForUi();

      expect(container.textContent).toContain(
        tEn("settings.general.providers.disconnect.warning.nothing"),
      );
    });
  });

  describe("the default-model picker is the shared component", () => {
    it("renders <ModelSelect> with the Default model copy and its own refresh", async () => {
      await render({ success: true });

      expect(container.textContent).toContain(
        tEn("settings.general.defaultModel.label"),
      );
      expect(container.textContent).toContain(
        tEn("settings.general.defaultModel.description"),
      );
      // Only `<ModelSelect>` calls `fetchAIModels`; a hand-rolled picker here
      // would call `fetchProviderModels` instead.
      expect(api.fetchAIModels).toHaveBeenCalled();
      expect(
        container.querySelector(
          '[aria-label="' + tEn("models.select.refetch") + '"]',
        ),
      ).not.toBeNull();
    });
  });

  it("uses shared selected, disabled, and destructive button variants", async () => {
    await render({ success: true });

    const selectedOutput = container.querySelector<HTMLButtonElement>(
      'button[role="radio"][aria-checked="true"]',
    );
    const disabledConnect = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (button) =>
        button.textContent === tEn("settings.general.providers.card.connect") &&
        button.disabled,
    );

    await click(
      buttonNamed(container, tEn("settings.general.providers.card.disconnect")),
    );
    const destructiveConfirm = confirmDisconnectButton();

    expect(selectedOutput?.className).toContain(
      "[&:where(:enabled:hover)]:bg-primary-hover",
    );
    expect(
      selectedOutput
        ?.querySelector("span.mt-0\\.5")
        ?.classList.contains("text-muted-foreground"),
    ).toBe(false);
    expect(
      selectedOutput
        ?.querySelector("span.mt-0\\.5")
        ?.classList.contains("text-inherit"),
    ).toBe(true);
    expect(disabledConnect?.className).toContain("disabled:cursor-not-allowed");
    expect(destructiveConfirm.type).toBe("button");
    expect(destructiveConfirm.className).toContain("bg-destructive");
  });

  it("keeps all 24 card-06 management and PromptGen controls on their classified Button contracts", () => {
    expect(
      extractButtonContracts(
        "ModelManagerDialog.tsx",
        expectedModelManagerContracts.map(({ id }) => id),
      ),
    ).toEqual(expectedModelManagerContracts);
    expect(
      extractButtonContracts(
        "ProfileManager.tsx",
        expectedProfileManagerContracts.map(({ id }) => id),
      ),
    ).toEqual(expectedProfileManagerContracts);
    expect(
      extractButtonContracts(
        "SettingPromptGen.tsx",
        expectedPromptGenContracts.map(({ id }) => id),
      ),
    ).toEqual(expectedPromptGenContracts);
  });
});

describe("Card 06 management and PromptGen Button runtime behavior", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = async (element: ReturnType<typeof createElement>, api: object) => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: api,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, element));
    });
    await waitForUi();
    await waitForUi();
    await waitForUi();
  };

  const localeApi = () => ({
    getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
    setLocale: vi.fn().mockResolvedValue({ success: true }),
    onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  it("switches model panels and keeps the install action disabled until its request settles", async () => {
    let resolveInstall: ((result: { success: boolean; error?: string }) => void) | undefined;
    const pullLocalModel = vi.fn(
      () =>
        new Promise<{ success: boolean; error?: string }>((resolve) => {
          resolveInstall = resolve;
        }),
    );
    await mount(
      createElement(ModelManagerDialog, { isOpen: true, onClose: vi.fn() }),
      {
        ...localeApi(),
        fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        getRecommendedModels: vi.fn().mockResolvedValue([
          {
            name: "Runtime model",
            description: "Exercises Button states.",
            size: 1_000,
            tags: [],
          },
        ]),
        pullLocalModel,
      },
    );

    const recommended = buttonNamed(
      container,
      tEn("models.manager.tabs.recommended"),
    );
    await click(recommended);
    expect(recommended.className).toContain("bg-primary");
    expect(container.textContent).toContain("Runtime model");

    const install = buttonNamed(
      container,
      tEn("models.manager.install.install"),
    );
    await click(install);
    expect(install.disabled).toBe(true);
    expect(pullLocalModel).toHaveBeenCalledWith("Runtime model");

    await act(async () => {
      resolveInstall?.({ success: false, error: "offline" });
    });
    await waitForUi();

    const retry = buttonNamed(container, tEn("common.retry"));
    expect(retry.disabled).toBe(false);
    expect(retry.className).toContain("bg-destructive-hover");
    expect(retry.className).toContain("bg-destructive-active");
    expect(retry.className).not.toMatch(
      /(?:^|\s)(?:enabled:)?(?:hover|active):bg-/,
    );
  });

  it("keeps ProfileManager create disabled until named and confirms destructive deletion", async () => {
    const deleteProfile = vi.fn().mockResolvedValue({ success: true });
    const getProfiles = vi.fn().mockResolvedValue({
      currentProfileId: "current",
      profiles: [
        { id: "current", name: "Current", updatedAt: "2026-07-27T00:00:00.000Z" },
        { id: "delete-me", name: "Delete me", updatedAt: "2026-07-27T00:00:00.000Z" },
      ],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await mount(
      createElement(ProfileManager),
      {
        ...localeApi(),
        getProfiles,
        deleteProfile,
        onProfileUpdated: vi.fn().mockReturnValue(vi.fn()),
        getKeyBindings: vi
          .fn()
          .mockResolvedValue({ promptGen: "Control+P", profileSwitch: "Control+Shift+P" }),
        resumeHotkeys: vi.fn().mockResolvedValue(undefined),
      },
    );

    await click(buttonNamed(container, tEn("profiles.manager.newProfile")));
    const create = buttonNamed(container, tEn("profiles.manager.create"));
    expect(create.disabled).toBe(true);
    await type(container.querySelector<HTMLInputElement>("#profileName") ?? never(), "New");
    expect(create.disabled).toBe(false);

    const deleteButton = [...container.querySelectorAll("button")].find(
      (button) =>
        button.textContent === tEn("common.delete") &&
        button.closest("div")?.parentElement?.textContent?.includes("Delete me"),
    );
    if (!deleteButton) throw new Error("Expected the Delete me destructive action");
    await click(deleteButton);
    expect(confirm).toHaveBeenCalledWith(tEn("profiles.manager.confirmDelete"));
    expect(deleteProfile).toHaveBeenCalledWith({ profileId: "delete-me" });
    expect(getProfiles).toHaveBeenCalledTimes(2);
  });

  it("submits PromptGen settings through its explicit submit Button", async () => {
    const settings = {
      minLength: 10,
      maxLength: 100,
      batchCount: 2,
      nsfw: false,
      context: "Runtime context",
      model: "",
      autoCopy: true,
    };
    const setPromptGenSettings = vi.fn().mockResolvedValue({ success: true });
    await mount(
      createElement(SettingPromptGen),
      {
        ...localeApi(),
        getPromptGenSettings: vi.fn().mockResolvedValue(settings),
        setPromptGenSettings,
        onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
        fetchAIModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
        getProviderStates: vi.fn().mockResolvedValue({}),
        getSelectedModel: vi.fn().mockResolvedValue(""),
        getFeatureModel: vi.fn().mockResolvedValue(""),
        getKeyBindings: vi
          .fn()
          .mockResolvedValue({ promptGen: "Control+P", profileSwitch: "Control+Shift+P" }),
        resumeHotkeys: vi.fn().mockResolvedValue(undefined),
      },
    );

    const form = container.querySelector("form");
    if (!form) throw new Error("Expected the PromptGen settings form");
    const save = buttonNamed(container, tEn("common.save"));
    expect(save.type).toBe("submit");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await waitForUi();

    expect(setPromptGenSettings).toHaveBeenCalledWith(settings);
    expect(container.textContent).toContain(tEn("settings.promptGen.saved"));
  });
});

/** Fails loudly instead of letting an `undefined` element silently skip a click. */
function never(): never {
  throw new Error("expected the element to be present");
}
