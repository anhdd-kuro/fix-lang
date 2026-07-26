// No `@testing-library/react` is installed, so these render the real component
// via `react-dom/client` + `act`, as `SettingUpdates.test.ts` does.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messageLabel } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import { ModelSelect } from "./ModelSelect";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";

// Expected copy is derived through the real translator kernel so a catalog
// reword cannot silently pass.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("ModelSelect", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let fetchAIModels: ReturnType<typeof vi.fn>;

  const render = async () => {
    fetchAIModels = vi.fn().mockResolvedValue({ success: false });
    const api = {
      fetchAIModels,
      getProviderStates: vi.fn().mockResolvedValue({}),
      getSelectedModel: vi.fn().mockResolvedValue(""),
      getFeatureModel: vi.fn().mockResolvedValue(""),
      setSelectedModel: vi.fn().mockResolvedValue(undefined),
      setFeatureModel: vi.fn().mockResolvedValue(undefined),
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
      root.render(createElement(I18nProvider, null, createElement(ModelSelect)));
    });
    // Two ticks: `<I18nProvider>` renders null until `getLocale()` resolves,
    // and `fetchModels()`'s rejection needs a further tick to land in state.
    await waitForUi();
    await waitForUi();
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    localeListener = undefined;
    vi.restoreAllMocks();
  });

  it("shows a locale-free fetch-failure descriptor that re-renders in Japanese without refetching models", async () => {
    await render();

    const key = "models.select.error.fetchFailed";
    const alert = () => container.querySelector('[role="alert"]');
    expect(alert()?.textContent).toBe(tEn(key));
    expect(fetchAIModels).toHaveBeenCalledTimes(1);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(alert()?.textContent).toBe(tJa(key));
    expect(tJa(key)).not.toBe(tEn(key));
    // Kills: letting `fetchModels` close over `t`, which would refetch every
    // mounted picker on a locale switch.
    expect(fetchAIModels).toHaveBeenCalledTimes(1);
  });

  it("passes an app-authored IPC error Label straight through to tl(), re-rendering it translated after a locale switch", async () => {
    // Kills: re-wrapping `result.error` in `textLabel`, which would render the
    // `Label` object as raw text.
    fetchAIModels = vi.fn().mockResolvedValue({
      success: false,
      error: messageLabel("models.providerSetup.error.apiKeyNotVerified"),
    });
    const api = {
      fetchAIModels,
      getProviderStates: vi.fn().mockResolvedValue({}),
      getSelectedModel: vi.fn().mockResolvedValue(""),
      getFeatureModel: vi.fn().mockResolvedValue(""),
      setSelectedModel: vi.fn().mockResolvedValue(undefined),
      setFeatureModel: vi.fn().mockResolvedValue(undefined),
      onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
        localeListener = callback;
        return vi.fn();
      }),
    };
    Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, null, createElement(ModelSelect)));
    });
    await waitForUi();
    await waitForUi();

    const key = "models.providerSetup.error.apiKeyNotVerified";
    const alert = () => container.querySelector('[role="alert"]');
    expect(alert()?.textContent).toBe(tEn(key));

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(alert()?.textContent).toBe(tJa(key));
    expect(tJa(key)).not.toBe(tEn(key));
  });

  describe("selected-value rendering", () => {
    const MODEL = {
      id: "gpt-5-mini",
      name: "gpt-5-mini",
      created: 1_700_000_000,
      provider: "openai" as const,
      pricing: {
        prompt: "0.0000012",
        completion: "0",
        image: "0",
        request: "0",
        input_cache_read: "0",
        input_cache_write: "0",
        web_search: "0",
        internal_reasoning: "0",
      },
    };

    const OLLAMA_MODEL = {
      id: "llama3.2:3b",
      name: "llama3.2:3b",
      created: 1_700_000_000_000,
      provider: "ollama" as const,
      local: { path: "/models/llama3.2", size: 3 },
    };

    const connectedOpenAI = {
      openai: {
        connected: true,
        configured: true,
        apiKeySet: true,
        provisioningKeySet: false,
        modelCount: 1,
      },
      ollama: {
        connected: false,
        configured: false,
        apiKeySet: false,
        provisioningKeySet: false,
        modelCount: 0,
      },
    };

    const mount = async (
      props: Record<string, unknown>,
      overrides: {
        models?: unknown[];
        states?: Record<string, unknown>;
        featureModel?: string;
        selectedModel?: string;
      } = {},
    ) => {
      const api = {
        fetchAIModels: vi
          .fn()
          .mockResolvedValue({ success: true, models: overrides.models ?? [MODEL] }),
        getProviderStates: vi
          .fn()
          .mockResolvedValue(overrides.states ?? connectedOpenAI),
        getSelectedModel: vi
          .fn()
          .mockResolvedValue(overrides.selectedModel ?? "openai::gpt-5-mini"),
        getFeatureModel: vi.fn().mockResolvedValue(overrides.featureModel ?? ""),
        setSelectedModel: vi.fn().mockResolvedValue({ success: true }),
        setFeatureModel: vi.fn().mockResolvedValue(undefined),
        onSettingsUpdated: vi.fn().mockReturnValue(vi.fn()),
        getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
        setLocale: vi.fn().mockResolvedValue({ success: true }),
        onLocaleChanged: vi.fn((callback: (locale: Locale) => void) => {
          localeListener = callback;
          return vi.fn();
        }),
      };
      Object.defineProperty(window, "electronAPI", { configurable: true, value: api });

      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(async () => {
        root.render(createElement(I18nProvider, null, createElement(ModelSelect, props)));
      });
      await waitForUi();
      await waitForUi();
    };

    it('shows "use global default" for a preset whose model is the empty inherit sentinel', async () => {
      await mount({ selectedModelId: "", persistSelection: false });

      expect(container.textContent).toContain(tEn("models.select.option.inherit"));
      // The placeholder is what a missing inherit option leaves behind.
      expect(container.textContent).not.toContain(tEn("models.select.placeholder"));
    });

    it("marks a stored-but-missing model as no longer available instead of rendering blank", async () => {
      await mount({ selectedModelId: "openai::ghost", persistSelection: false });

      expect(container.textContent).toContain(
        tEn("models.select.option.unavailable", { model: "ghost" }),
      );
    });

    it("shows the plain model id for a resolvable selection", async () => {
      await mount({ selectedModelId: "openai::gpt-5-mini", persistSelection: false });

      expect(container.textContent).toContain("gpt-5-mini");
      expect(container.textContent).not.toContain(tEn("models.select.option.inherit"));
    });

    it("uses the caller's label/description override — what Settings → General passes", async () => {
      await mount({
        labelKey: "settings.general.defaultModel.label",
        descriptionKey: "settings.general.defaultModel.description",
      });

      expect(container.textContent).toContain(tEn("settings.general.defaultModel.label"));
      expect(container.textContent).not.toContain(tEn("models.select.label"));
    });

    it("keeps the generic copy for the four call sites that pass no override", async () => {
      await mount({});

      expect(container.textContent).toContain(tEn("models.select.label"));
      expect(container.textContent).toContain(tEn("models.select.description.default"));
    });

    // A feature picker reaches inherit via `getFeatureModel()`, not via the
    // `selectedModelId` prop — `offersInherit` must cover that branch too.
    it("offers the inherit row to a feature picker whose feature model is unset", async () => {
      await mount({ featureId: "settingsPromptGen", useFeatureModel: true });

      expect(container.textContent).toContain(tEn("models.select.option.inherit"));
      expect(container.textContent).toContain(tEn("models.select.description.feature"));
    });

    it("does NOT offer the inherit row to the global default picker", async () => {
      await mount({ saveOnChange: true });

      expect(container.textContent).not.toContain(tEn("models.select.option.inherit"));
      expect(container.textContent).toContain("gpt-5-mini");
    });

    it("tells a user with no connected provider to connect one", async () => {
      await mount({}, { models: [], states: {}, selectedModel: "" });

      expect(container.textContent).toContain(
        tEn("models.select.placeholder.noProviders"),
      );
      expect(container.textContent).not.toContain(tEn("models.select.placeholder"));
    });

    it("surfaces a stored default that its provider no longer serves", async () => {
      await mount({}, { models: [], states: {} });

      expect(container.textContent).toContain(
        tEn("models.select.option.unavailable", { model: "gpt-5-mini" }),
      );
    });

    it("hides a disconnected provider's cached models from the picker", async () => {
      // `fetch-ai-models` merges every provider's slice, so the picker must
      // filter on the connected set rather than trust the model list.
      await mount(
        { selectedModelId: "ollama::llama3.2:3b", persistSelection: false },
        { models: [MODEL, OLLAMA_MODEL] },
      );

      expect(container.textContent).toContain(
        tEn("models.select.option.unavailable", { model: "llama3.2:3b" }),
      );
    });
  });
});
