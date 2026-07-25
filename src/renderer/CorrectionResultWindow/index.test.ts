/**
 * @file index.test.ts
 * @description Verifies `CorrectionResultWindow` routes every user-facing
 * string through `useI18n()` instead of the hardcoded English literals it
 * shipped with (Bug A, PR #87 review — the window was wrapped in
 * `<I18nProvider>` but never actually called `useI18n()`). Drives the
 * component with `react-dom/client` + `act`, following
 * `src/renderer/components/SettingUpdates.test.ts` — Vitest only collects
 * `.test.ts`, not `.test.tsx`, and `@testing-library/react` isn't installed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "~/shared/i18n/translate";
import { I18nProvider } from "../i18n/I18nProvider";
import type { CorrectionResultPayload } from "~/shared/correctionResult";
import { CorrectionResultWindow } from "./index";

// Expected copy is derived through the real translator kernel — never
// hand-restated — so a catalog reword can't silently break this file, and an
// English-fallback regression still fails a test that asserts JA text.
const tEn = createTranslator("en");
const tJa = createTranslator("ja");

type ElectronApiMock = {
  onCorrectionResultData: ReturnType<typeof vi.fn>;
  signalCorrectionResultReady: ReturnType<typeof vi.fn>;
  closeCorrectionResultWindow: ReturnType<typeof vi.fn>;
  getTheme: ReturnType<typeof vi.fn>;
  onThemeChanged: ReturnType<typeof vi.fn>;
  setTheme: ReturnType<typeof vi.fn>;
  // `<I18nProvider>` reads these off `window.electronAPI` on mount (see
  // `localeState.ts`'s `LocaleBridge`).
  getLocale: ReturnType<typeof vi.fn>;
  setLocale: ReturnType<typeof vi.fn>;
  onLocaleChanged: ReturnType<typeof vi.fn>;
};

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("CorrectionResultWindow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payloadListener: ((payload: CorrectionResultPayload) => void) | undefined;
  let localeListener: ((locale: "en" | "ja") => void) | undefined;
  let api: ElectronApiMock;

  const render = async (initialLocale: "en" | "ja" = "en") => {
    api = {
      onCorrectionResultData: vi.fn(
        (callback: (payload: CorrectionResultPayload) => void) => {
          payloadListener = callback;
          return vi.fn();
        },
      ),
      signalCorrectionResultReady: vi.fn(),
      closeCorrectionResultWindow: vi.fn(),
      getTheme: vi.fn().mockResolvedValue({ themeId: "brand-codex-dark" }),
      onThemeChanged: vi.fn().mockReturnValue(vi.fn()),
      setTheme: vi.fn().mockResolvedValue({ success: true }),
      getLocale: vi.fn().mockResolvedValue({ locale: initialLocale }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn((callback: (locale: "en" | "ja") => void) => {
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
        createElement(I18nProvider, null, createElement(CorrectionResultWindow)),
      );
    });
    // `<I18nProvider>` resolves its initial locale via an async `getLocale()`
    // call before rendering children (renders null until "ready" to avoid an
    // EN -> JA flash), so this needs an extra tick beyond the mount effect.
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
    payloadListener = undefined;
    localeListener = undefined;
    vi.restoreAllMocks();
  });

  it("renders nothing until a correction-result payload arrives", async () => {
    await render();

    expect(container.textContent).toBe("");
    expect(api.signalCorrectionResultReady).toHaveBeenCalledTimes(1);
  });

  it("localizes the subtitle and both button labels in English", async () => {
    await render("en");

    await act(async () => {
      payloadListener?.({ title: "Correction", text: "Hello, world." });
    });

    expect(container.textContent).toContain(
      tEn("notifications.window.correctionResult.subtitle"),
    );
    const closeButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === tEn("common.close"),
    );
    expect(closeButton).toBeTruthy();
    expect(
      container.querySelector(`[aria-label="${tEn("common.copy")}"]`),
    ).toBeTruthy();

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(api.closeCorrectionResultWindow).toHaveBeenCalledTimes(1);
  });

  it("localizes the subtitle and both button labels in Japanese, distinct from English", async () => {
    await render("ja");

    await act(async () => {
      payloadListener?.({ title: "校正", text: "こんにちは。" });
    });

    const jaSubtitle = tJa("notifications.window.correctionResult.subtitle");
    const jaClose = tJa("common.close");
    const jaCopy = tJa("common.copy");

    expect(container.textContent).toContain(jaSubtitle);
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === jaClose,
      ),
    ).toBeTruthy();
    expect(container.querySelector(`[aria-label="${jaCopy}"]`)).toBeTruthy();

    // Prove the locale actually changed the wording, not just an English
    // fallback silently passing the assertions above.
    expect(jaSubtitle).not.toBe(
      tEn("notifications.window.correctionResult.subtitle"),
    );
    expect(jaClose).not.toBe(tEn("common.close"));
    expect(jaCopy).not.toBe(tEn("common.copy"));
  });

  it("re-renders in Japanese after a locale broadcast, keeping the current payload", async () => {
    await render("en");

    await act(async () => {
      payloadListener?.({ title: "Correction", text: "Hello, world." });
    });
    expect(container.textContent).toContain(tEn("common.close"));

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(container.textContent).toContain(
      tJa("notifications.window.correctionResult.subtitle"),
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === tJa("common.close"),
      ),
    ).toBeTruthy();
    // The payload itself (user data, not UI chrome) survives the locale
    // switch untouched.
    expect(container.textContent).toContain("Hello, world.");
  });
});
