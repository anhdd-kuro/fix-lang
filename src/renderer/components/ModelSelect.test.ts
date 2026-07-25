/**
 * @file ModelSelect.test.ts
 * @description Regression test for the Finding-1 fix: `fetchModels`'s
 * dependency array must stay `[]` (it built an English error string via `t`,
 * which forced switching languages to re-run `fetchAIModels()` for every
 * mounted `<ModelSelect>` — including the always-mounted tray instance, and
 * to tear down/re-register the `onSettingsUpdated` IPC listener). Verifies
 * the error state is a locale-free descriptor — it renders differently in en
 * vs ja after a locale change — and that the switch itself triggers no
 * second `fetchAIModels()` call.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component directly via
 * `react-dom/client` + `act` — the same technique already used in
 * `SettingUpdates.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messageLabel } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import { ModelSelect } from "./ModelSelect";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";

// Expected copy is derived through the real translator kernel so a catalog
// reword can't silently break this file, and an English-fallback regression
// still fails a test that asserts the JA text.
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
      getActiveProvider: vi.fn().mockResolvedValue(null),
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
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and `fetchModels()`'s rejection needs a further tick to land in state
    // (mirrors `SettingUpdates.test.ts`).
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

    // Prove the locale actually changed: the JA-derived text is returned,
    // and it differs from the EN-derived text.
    expect(alert()?.textContent).toBe(tJa(key));
    expect(tJa(key)).not.toBe(tEn(key));
    // Switching locale must not re-run `fetchAIModels()` — `fetchModels`'s
    // dependency array must stay `[]` (it no longer closes over `t`), and it
    // is itself a dependency of the mount effect and the
    // `onSettingsUpdated` subscription effect.
    expect(fetchAIModels).toHaveBeenCalledTimes(1);
  });

  it("passes an app-authored IPC error Label straight through to tl(), re-rendering it translated after a locale switch", async () => {
    // Simulates the real `fetch-provider-models`/`fetch-ai-models` IPC shape
    // post-migration: `result.error` already arrives as a `Label` (a
    // `messageLabel` descriptor for app-authored validation copy, or a
    // `textLabel` for opaque provider/exception text) — never a bare string.
    // If `ModelSelect.tsx` regressed to the pre-migration
    // `result.error ? textLabel(result.error) : …` pattern, this would wrap
    // the `Label` *object* itself as if it were raw text and render garbage
    // instead of translated copy.
    fetchAIModels = vi.fn().mockResolvedValue({
      success: false,
      error: messageLabel("models.providerSetup.error.apiKeyNotVerified"),
    });
    const api = {
      fetchAIModels,
      getActiveProvider: vi.fn().mockResolvedValue(null),
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
});
