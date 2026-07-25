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
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textLabel, type Label } from "~/shared/i18n/message";
import { createTranslator } from "~/shared/i18n/translate";
import { SettingGeneral } from "./SettingGeneral";
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

const buttonNamed = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) {
    throw new Error(`Expected a button named "${label}"`);
  }
  return button;
};

type ResetResult = { success: boolean; error?: Label };

type SettingGeneralApi = {
  getActiveProvider: ReturnType<typeof vi.fn>;
  getProviderSecretStatus: ReturnType<typeof vi.fn>;
  onProfileUpdated: ReturnType<typeof vi.fn>;
  getCorrectionOutputMode: ReturnType<typeof vi.fn>;
  setCorrectionOutputMode: ReturnType<typeof vi.fn>;
  resetProfileSettings: ReturnType<typeof vi.fn>;
  fetchProviderModels: ReturnType<typeof vi.fn>;
  applyProviderSetup: ReturnType<typeof vi.fn>;
  // `SettingGeneral` renders inside `<I18nProvider>`, which reads these off
  // `window.electronAPI` on mount (see `localeState.ts`'s `LocaleBridge`).
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
};

describe("SettingGeneral", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let api: SettingGeneralApi;
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  const render = async (resetResult: ResetResult) => {
    api = {
      getActiveProvider: vi.fn().mockResolvedValue("openrouter"),
      getProviderSecretStatus: vi
        .fn()
        .mockResolvedValue({ apiKeySet: false, provisioningKeySet: false }),
      onProfileUpdated: vi.fn().mockReturnValue(vi.fn()),
      getCorrectionOutputMode: vi.fn().mockResolvedValue("paste"),
      setCorrectionOutputMode: vi.fn().mockResolvedValue({ success: true, mode: "paste" }),
      resetProfileSettings: vi.fn().mockResolvedValue(resetResult),
      fetchProviderModels: vi.fn().mockResolvedValue({ success: true, models: [] }),
      applyProviderSetup: vi.fn().mockResolvedValue({ success: true }),
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
      root.render(createElement(I18nProvider, null, createElement(SettingGeneral)));
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
      [...container.querySelectorAll('[role="status"]')].map((el) => el.textContent),
    ).toContain(tEn("settings.general.reset.success"));

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    const jaExpected = tJa("settings.general.reset.success");
    const enExpected = tEn("settings.general.reset.success");
    expect(
      [...container.querySelectorAll('[role="status"]')].map((el) => el.textContent),
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
      [...container.querySelectorAll('[role="status"]')].map((el) => el.textContent),
    ).toContain(enWrapped);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    // Only the "Error: " wrapper itself re-translates — "disk full" is raw
    // provider text and must survive verbatim in both locales.
    const jaWrapped = tJa("settings.general.error", { message: "disk full" });
    expect(
      [...container.querySelectorAll('[role="status"]')].map((el) => el.textContent),
    ).toContain(jaWrapped);
    expect(jaWrapped).not.toBe(enWrapped);
    expect(jaWrapped).toContain("disk full");
  });
});
