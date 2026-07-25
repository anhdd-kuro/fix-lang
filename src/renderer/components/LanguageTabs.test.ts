/**
 * @file LanguageTabs.test.ts
 * @description Behaviour of the shared language segmented control.
 *
 * Vitest only collects `.test.ts` and `@testing-library/react` is not
 * installed, so the component is driven with `react-dom/client` + `act`,
 * matching `TrayToolbar.test.ts`.
 *
 * Expected copy is derived through the real translator kernel and the real
 * locale registry — never hand-restated — so a catalog reword or a new locale
 * can't silently break this file.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_OPTIONS } from "~/shared/i18n/registry";
import { createTranslator } from "~/shared/i18n/translate";
import { LanguageTabs } from "./LanguageTabs";
import { I18nProvider } from "../i18n/I18nProvider";

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

const buttons = (container: HTMLElement): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll("button"));

const group = (container: HTMLElement): HTMLElement => {
  const el = container.querySelector<HTMLElement>('[role="group"]');
  if (!el) throw new Error("no role=group container rendered");
  return el;
};

describe("LanguageTabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  let setLocale: ReturnType<typeof vi.fn>;
  let localeListeners: ((locale: string) => void)[];

  const mount = async (initialLocale: "en" | "ja") => {
    setLocale = vi.fn(async () => ({ success: true }));
    localeListeners = [];

    // Minimal `LocaleBridge` (see ~/renderer/i18n/localeState.ts). `setLocale`
    // deliberately does NOT flip state directly — main persists and
    // re-broadcasts, and that broadcast is the only thing that moves the
    // provider. Tests drive it via `broadcast()` below.
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getLocale: async () => ({ locale: initialLocale }),
      setLocale,
      onLocaleChanged: (cb: (locale: string) => void) => {
        localeListeners.push(cb);
        return () => {
          localeListeners = localeListeners.filter((l) => l !== cb);
        };
      },
    };

    await act(async () => {
      root.render(
        createElement(I18nProvider, null, createElement(LanguageTabs)),
      );
    });
    await waitForUi();
  };

  const broadcast = async (locale: string) => {
    await act(async () => {
      localeListeners.forEach((cb) => {
        cb(locale);
      });
    });
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders one button per registered locale, labelled natively", async () => {
    await mount("en");

    // Driven off the registry, not a hardcoded list: adding a third locale
    // must surface here automatically rather than silently failing to render.
    expect(buttons(container).map((b) => b.textContent)).toEqual(
      LOCALE_OPTIONS.map((o) => o.nativeLabel),
    );
  });

  it("marks only the active locale as pressed", async () => {
    await mount("ja");

    const pressed = buttons(container)
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);

    expect(pressed).toEqual(["日本語"]);
  });

  it("requests a locale change when an inactive option is clicked", async () => {
    await mount("en");

    const japanese = buttons(container).find((b) => b.textContent === "日本語");
    if (!japanese) throw new Error("Japanese button not rendered");
    await click(japanese);

    expect(setLocale).toHaveBeenCalledExactlyOnceWith("ja");
  });

  it("does not re-request the locale already active", async () => {
    await mount("en");

    const english = buttons(container).find((b) => b.textContent === "English");
    if (!english) throw new Error("English button not rendered");
    await click(english);

    expect(setLocale).not.toHaveBeenCalled();
  });

  it("follows the main-process broadcast rather than flipping optimistically", async () => {
    await mount("en");

    const japanese = buttons(container).find((b) => b.textContent === "日本語");
    if (!japanese) throw new Error("Japanese button not rendered");
    await click(japanese);

    // `setLocale` resolved, but no broadcast yet — the highlight must not have
    // moved, otherwise a rejected change would leave the UI lying about the
    // locale main actually holds.
    expect(japanese.getAttribute("aria-pressed")).toBe("false");

    await broadcast("ja");
    expect(japanese.getAttribute("aria-pressed")).toBe("true");
  });

  it("translates its accessible name, and EN and JA differ", async () => {
    await mount("en");
    expect(group(container).getAttribute("aria-label")).toBe(
      tEn("settings.general.language.label"),
    );

    await broadcast("ja");
    expect(group(container).getAttribute("aria-label")).toBe(
      tJa("settings.general.language.label"),
    );

    // Guards against an English-fallback regression passing silently.
    expect(tJa("settings.general.language.label")).not.toBe(
      tEn("settings.general.language.label"),
    );
  });

  it("tags each option with its own lang for screen-reader pronunciation", async () => {
    await mount("en");

    expect(buttons(container).map((b) => b.getAttribute("lang"))).toEqual(
      LOCALE_OPTIONS.map((o) => o.code),
    );
  });
});
