/**
 * @file HotkeyInput.test.ts
 * @description Regression test for the Finding-4 fix: the mount effect that
 * calls `getKeyBindings()` previously depended on `[hotkeyKey, t]`. A locale
 * switch would re-run it, discarding an unsaved captured combo (its cleanup
 * calls `resumeHotkeys()`, resuming global hotkeys mid-capture). Verifies the
 * load-error is a locale-free descriptor — it renders differently in en vs
 * ja after a locale change — and that the switch triggers neither a second
 * `getKeyBindings()` call nor a `resumeHotkeys()` call.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component directly via
 * `react-dom/client` + `act` — the same technique already used in
 * `SettingUpdates.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotkeyInput } from "./HotkeyInput";
import { I18nProvider } from "../i18n/I18nProvider";
import type { Locale } from "~/shared/i18n/registry";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("HotkeyInput", () => {
  let container: HTMLDivElement;
  let root: Root;
  let localeListener: ((locale: Locale) => void) | undefined;
  let getKeyBindings: ReturnType<typeof vi.fn>;
  let resumeHotkeys: ReturnType<typeof vi.fn>;

  const render = async () => {
    getKeyBindings = vi.fn().mockRejectedValue(new Error("store unavailable"));
    resumeHotkeys = vi.fn().mockResolvedValue(undefined);
    const api = {
      getKeyBindings,
      resumeHotkeys,
      pauseHotkeys: vi.fn().mockResolvedValue(undefined),
      getCorrectSettings: vi.fn().mockResolvedValue({ presets: [] }),
      setKeyBindings: vi.fn().mockResolvedValue({ success: true }),
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
        createElement(
          I18nProvider,
          null,
          createElement(HotkeyInput, { hotkeyKey: "promptGen", label: "PromptGen" }),
        ),
      );
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and `getKeyBindings()`'s rejection needs a further tick to land in
    // state (mirrors `SettingUpdates.test.ts`).
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

  it("shows a locale-free load-error descriptor that re-renders in Japanese without reloading bindings or resuming hotkeys", async () => {
    await render();

    const status = () => container.querySelector('[role="status"]');
    expect(status()?.textContent).toBe("Error loading keybindings");
    expect(getKeyBindings).toHaveBeenCalledTimes(1);

    await act(async () => {
      localeListener?.("ja");
    });
    await waitForUi();

    expect(status()?.textContent).toBe(
      "ホットキーの読み込み中にエラーが発生しました",
    );
    // Switching locale must not re-run the mount effect — it would discard
    // an unsaved captured combo and resume global hotkeys mid-capture (see
    // the effect's cleanup). `getKeyBindings` stays at 1 call, and
    // `resumeHotkeys` (only invoked by that cleanup / on unmount) is never
    // called while the component stays mounted.
    expect(getKeyBindings).toHaveBeenCalledTimes(1);
    expect(resumeHotkeys).not.toHaveBeenCalled();
  });
});
