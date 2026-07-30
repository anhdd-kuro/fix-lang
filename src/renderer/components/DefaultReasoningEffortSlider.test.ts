/**
 * @file DefaultReasoningEffortSlider.test.ts
 * @description Coverage for the tray's global reasoning-effort control after
 * it moved from a native `<select>` (`ReasoningEffortSelect`) to the shared
 * `ReasoningEffortSlider`. Pins that it still loads the persisted default on
 * mount, reloads it on profile switch / settings update, persists a change
 * through `setDefaultReasoningEffort`, and reverts optimistic state on a
 * failed write — the exact contract `ReasoningEffortSelect` had.
 *
 * No `@testing-library/react` is installed (Vitest only collects
 * `**\/*.test.ts`), so this renders the real component directly via
 * `react-dom/client` + `act`, following `HotkeyInput.test.ts`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DefaultReasoningEffortSlider } from "./DefaultReasoningEffortSlider";
import { I18nProvider } from "../i18n/I18nProvider";

const waitForUi = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("DefaultReasoningEffortSlider", () => {
  let container: HTMLDivElement;
  let root: Root;

  type Api = {
    getDefaultReasoningEffort: ReturnType<typeof vi.fn>;
    setDefaultReasoningEffort: ReturnType<typeof vi.fn>;
    onActiveProfileChanged: ReturnType<typeof vi.fn>;
    onSettingsUpdated: ReturnType<typeof vi.fn>;
    getLocale: ReturnType<typeof vi.fn>;
    setLocale: ReturnType<typeof vi.fn>;
    onLocaleChanged: ReturnType<typeof vi.fn>;
  };

  let api: Api;
  let profileListener: (() => void) | undefined;
  let settingsListener: (() => void) | undefined;

  const render = async (
    props: { label?: string } = {},
    initialEffort = "medium",
  ) => {
    api = {
      getDefaultReasoningEffort: vi.fn().mockResolvedValue(initialEffort),
      setDefaultReasoningEffort: vi.fn().mockResolvedValue({ success: true }),
      onActiveProfileChanged: vi.fn((callback: () => void) => {
        profileListener = callback;
        return vi.fn();
      }),
      onSettingsUpdated: vi.fn((callback: () => void) => {
        settingsListener = callback;
        return vi.fn();
      }),
      getLocale: vi.fn().mockResolvedValue({ locale: "en" }),
      setLocale: vi.fn().mockResolvedValue({ success: true }),
      onLocaleChanged: vi.fn().mockReturnValue(vi.fn()),
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
          createElement(DefaultReasoningEffortSlider, props),
        ),
      );
    });
    // `<I18nProvider>` renders null until its initial `getLocale()` resolves,
    // and the mount-time `getDefaultReasoningEffort()` fetch needs a further
    // tick to land in state (mirrors `HotkeyInput.test.ts`).
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
    profileListener = undefined;
    settingsListener = undefined;
    vi.restoreAllMocks();
  });

  it("renders the shared slider (not a native select) with the persisted default step highlighted", async () => {
    await render({}, "high");

    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="range"]')).not.toBeNull();
    expect(
      container.querySelector('[data-reasoning-step="high"]')?.className,
    ).toContain("font-medium");
  });

  it("uses the given label instead of the per-preset default label", async () => {
    await render({ label: "Custom label" });

    expect(container.textContent).toContain("Custom label");
  });

  it("persists a change via setDefaultReasoningEffort and reverts on failure", async () => {
    await render({}, "medium");
    api.setDefaultReasoningEffort.mockResolvedValueOnce({ success: false });

    const slider = container.querySelector<HTMLInputElement>(
      'input[type="range"]',
    );
    if (!slider) throw new Error("Expected the reasoning slider input");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(slider, "5");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForUi();

    expect(api.setDefaultReasoningEffort).toHaveBeenCalledWith("xhigh");
    // Save failed: the optimistic update must revert to the previous step.
    expect(
      container.querySelector('[data-reasoning-step="medium"]')?.className,
    ).toContain("font-medium");
  });

  it("reloads the persisted default on profile switch and settings updates", async () => {
    await render({}, "low");
    expect(api.getDefaultReasoningEffort).toHaveBeenCalledTimes(1);

    api.getDefaultReasoningEffort.mockResolvedValueOnce("xhigh");
    await act(async () => {
      profileListener?.();
    });
    await waitForUi();
    expect(
      container.querySelector('[data-reasoning-step="xhigh"]')?.className,
    ).toContain("font-medium");

    api.getDefaultReasoningEffort.mockResolvedValueOnce("none");
    await act(async () => {
      settingsListener?.();
    });
    await waitForUi();
    expect(
      container.querySelector('[data-reasoning-step="none"]')?.className,
    ).toContain("font-medium");
  });
});
