/**
 * @file I18nProvider.test.ts
 * @description Regression test for the stale-`resolved`-snapshot race: a
 * window's initial `getLocale()` IPC round-trip can resolve *after* a
 * `locale-changed` broadcast for a newer locale already arrived (Electron
 * does not guarantee ordering across messages from different renderers —
 * see PR #87 review). Before the fix, `localeReducer`'s `resolved` case
 * unconditionally applied the snapshot, silently reverting the window to
 * the stale locale it captured at request time.
 *
 * `localeState.test.ts` already covers the reducer in isolation, but that
 * alone would not catch a regression in `I18nProvider` itself (e.g. if it
 * stopped dispatching `resolved`/`broadcast` correctly, or dispatched them
 * in some different shape) — so this drives the real provider through
 * `react-dom/client` + `act`, exactly reproducing the async interleaving:
 * the captured `locale-changed` listener fires *before* the `getLocale()`
 * promise is resolved.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this uses the same harness technique as
 * `useI18n.test.ts` / `SettingUpdates.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { I18nProvider } from "./I18nProvider";
import { useI18n } from "./useI18n";
import type { Locale } from "~/shared/i18n/registry";

// Expected text is derived through the real translator kernel (never
// hand-written) so a catalog reword can't break this test, and an
// English-fallback regression would still be caught.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("I18nProvider — stale initial-resolve race", () => {
  let container: HTMLDivElement;
  let root: Root;

  const Harness = () => {
    const { t, locale } = useI18n();
    return createElement("div", { "data-testid": "locale-text" }, `${locale}:${t("common.loading")}`);
  };

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
    }
    container?.remove();
    vi.restoreAllMocks();
  });

  it("keeps the broadcast locale when the in-flight getLocale() snapshot resolves afterward with the old locale", async () => {
    let resolveGetLocale: ((value: { locale: Locale }) => void) | undefined;
    const getLocalePromise = new Promise<{ locale: Locale }>((resolve) => {
      resolveGetLocale = resolve;
    });

    let localeListener: ((locale: Locale) => void) | undefined;
    const api = {
      // This window's initial snapshot request — deliberately left pending
      // so we control exactly when it resolves relative to the broadcast.
      getLocale: vi.fn().mockReturnValue(getLocalePromise),
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
      root.render(createElement(I18nProvider, null, createElement(Harness)));
    });
    // `getLocale()` is still pending, so the provider is still `"loading"`
    // and renders null — nothing mounted yet.
    expect(container.textContent).toBe("");
    expect(localeListener).toBeDefined();

    // Another window changes the language first: the broadcast for "ja"
    // lands while this window's initial `getLocale()` is still in flight.
    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(container.textContent).toBe(`ja:${tJa("common.loading")}`);

    // Now the stale initial snapshot resolves, carrying the OLD locale
    // ("en") that was current when the request was originally issued.
    await act(async () => {
      resolveGetLocale?.({ locale: "en" });
      await getLocalePromise;
    });
    await waitForUi();

    // The stale snapshot must NOT revert the window back to English — the
    // broadcast is fresher and must win.
    expect(container.textContent).toBe(`ja:${tJa("common.loading")}`);
    expect(container.textContent).not.toBe(`en:${tEn("common.loading")}`);
  });
});
